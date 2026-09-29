# Type and Crop — research notes

The `text` and `crop` family. Every Photoshop claim below traces to a URL in that tool's
`sources` array in `type-crop.ts`; anything that could not be sourced is in `## Unverified`
at the end and is deliberately absent from the data file.

The four corrections the research brief folds in do not touch this family, and the
corrections log in `01-photoshop-reference.md` §10 does not disprove anything here. One
corpus claim **is** corrected below — the crop preset list.

## Method

Two passes. First the Photoshop half: `websearch` with `livecrawl: 'preferred'` over Adobe's
user guide, Adobe's own product pages, and — only where Adobe says nothing — a small number
of third-party pages, which are labelled as such in the source lists. `webfetch` on
`helpx.adobe.com` returns HTTP 403 on essentially every path, so the live search crawler is
the only route to Adobe's help text; every Adobe URL below was reached through it and the
quoted text is that page's.

Second the code half, re-derived against the tree in this worktree rather than against the
research corpus or `.skills/photoshop-tool-creation.md`, both of which were written against
older revisions. `src/tools/settings.ts`, `src/tools/<tool>.ts`,
`src/tools/toolProcessors.ts`, `src/tools/toolsMap.ts` and the two
`src/components/ToolbarsRight/` panels were read in full, and the drag path was traced
through `src/hooks/useRect.ts`, `src/components/Main/` and
`src/contexts/layer-renderer.ts` because both tools' real behaviour lives below the panel.

---

## text — Horizontal Type Tool

### What the tool is

Photoshop's type is **live**. A type layer holds vector glyph outlines that are re-rendered
from the font, which is what makes the edges resolution-independent; rasterizing is the
explicit, user-invoked destroy step (`Layer ▸ Rasterize ▸ Type`) and it warns first. The
operations a type layer supports **without** rasterizing are Adobe's own list, and they are
the load-bearing part of the tool's behaviour. Adobe's bullets verbatim: "You can make the
following changes to a type layer and still edit the type: **Change the orientation of type. /
Apply anti-aliasing. / Convert between point type and paragraph type. / Create a work path
from type. / Apply transformation commands from the Edit menu, except for Perspective and
Distort. / Use layer styles.**" — with one Note that matters as much as the list: "**To
transform part of the type layer, you must first rasterize the type layer.**"

That is deliberately more precise than "most transforms survive", and the precision is in
three places. It is the **Edit menu's transformation commands**, not transforms in general —
so a filter, a content-aware scale or a perspective warp is not what this sentence is about.
The **exceptions are named**: Perspective and Distort, and only those two. And the part-type
limiter is Adobe's own Note, not an inference: transforming _part_ of a live type layer
requires rasterizing first, which is a different and stronger restriction than the exception
list.

There are three ways to enter type, and the difference between the first two is the one that
matters most:

- **Point type** — click. Each line is independent, expands and shrinks with the text, and
  **never wraps**.
- **Paragraph type** — drag a bounding box. Lines wrap to the box and reflow when you resize
  it; an overflow icon appears on the box when the text no longer fits.
- **Type on a path** — type flows along an open or closed work path, following the direction
  the anchor points were added in. Clicking _inside_ a closed shape instead fills the shape,
  giving a custom-shaped text box.

Paragraph settings — alignment, justification, indents, hyphenation — are paragraph-type
only, because with point type every line _is_ a paragraph.

The type tool has a flyout: the four tools Photoshop 2024–2026 ships are Horizontal Type,
Vertical Type, Horizontal Type Mask and Vertical Type Mask, with the mask variants creating
a selection outline in the shape of the type instead of a type layer. `T` selects the tool
and `Shift+T` cycles the group. **The app has one entry for that four-tool group**
(`toolbar-mapping.ts:107`, a single `{ label: 'Horizontal Type Tool', name: 'text' }`), and
the record now says so in its `appNotes`, because an entry that names Adobe's exact string
for one of four tools otherwise reads as a complete stand-in. Vertical Type sets type
top-to-bottom, and the two mask variants are not a variant of the entry the app has at all —
they produce a selection, not a layer. Adobe's own sentence for the mask tools, from its
teaching-resources page: "When you use the Horizontal Type Mask tool or Vertical Type Mask
tool, you create a selection in the shape of the type."
(`https://edex.adobe.com/teaching-resources/photoshop-type-mask-tool`, Adobe, reached through
the live crawler.) The Adobe shortcut sheet that lists all four on `T` is cited by the
revalidation brief but **could not be opened in this pass** — `webfetch` returns the raw PDF
bytes, not text — so it is not in the data file's `sources`, and the four names rest on that
Adobe page, on Adobe's Type overview table as recorded in `AGENTS.md`, and on third-party
walkthroughs that all name the same four.

### Bar order

Adobe's left-to-right account of the type options bar
(`photoshopforphotographers.com`, a third-party Adobe-training site, which is the only page
found that enumerates the order) is: tool preset, orientation toggle, font family, font
style, size, anti-aliasing, colour, alignment, warp, panels toggle. The two path buttons
appear only once a work path is selected. `01-photoshop-reference.md` §5.3 lists the option
_set_ without an order; `03-ui-chrome-spec.md:193` gives an order that omits the colour and
the orientation toggle, so the order used here is the one above, and the
Character/Paragraph panel settings are listed separately below rather than folded in.

**This is a CC-era enumeration and one of its ten slots no longer holds.** That page is
`/CC_2013/`, and the anti-aliasing pull-down it places between Size and colour is, by every
source in this file, no longer there. That is a statement about the passage of time rather
than a contradiction of the page, and it is why the data file's `purpose` no longer says
"this describes Photoshop 2024-2026" — the version claim was doing work the bar-order claim
cannot do. The control no longer holds a bar position either, and that is the load-bearing
half of the correction: `options[]` is contractually "every control Photoshop places in this
tool's options bar, in bar order", so a control whose own row says it is off the bar cannot
occupy a slot in it. **The row is out of the census** and the control is documented in its
own section below instead. What stays in the data file is the part that is true of the
current bar — that the pull-down is no longer on it, the five presets, and the routes that
replaced it — which `purpose` now carries.

**The enumeration also stops before the bar's end, which is what made one row wrong.** The
CC-era page ends at the panels toggle, and the Commit / Cancel pair is the row the data file
puts after it. "The last button in the bar" was an inference that enumeration does not
support, so the row no longer claims a position at all: the panel toggle is the last of the
bar's settings controls, and the Commit / Cancel pair sits after it — a pair the same record
says "appear only while a type layer is in edit mode". The app's own bar is a different
surface and is not evidence for Adobe's order, but it is what this worktree can read, and it
has the same shape: `Text.tsx:175` the align control, `:189` the B/I pair, then `Apply` at
`:210` and `Clear` at `:213` at the right end.

### Options-bar control census

Twelve controls. `present` 1 · `partial` 4 · `inert` 0 · `missing` 7.

| #   | Control                                   | Status    | `appRef`                                         |
| --- | ----------------------------------------- | --------- | ------------------------------------------------ |
| 1   | Tool preset                               | `missing` | —                                                |
| 2   | Text Orientation (`T` + direction marker) | `missing` | —                                                |
| 3   | Font family                               | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:123` |
| 4   | Font Style                                | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:189` |
| 5   | Size                                      | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:136` |
| 6   | Text color                                | `missing` | —                                                |
| 7   | Align Text Left / Center / Right          | `present` | `src/components/ToolbarsRight/Text/Text.tsx:175` |
| 8   | Toggle the type on a path                 | `missing` | —                                                |
| 9   | Create Work Path                          | `missing` | —                                                |
| 10  | Warp Text                                 | `missing` | —                                                |
| 11  | Toggle the Character and Paragraph panels | `missing` | —                                                |
| 12  | Commit / Cancel                           | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:210` |

**The thirteenth control is gone, and what replaced it in the array is not a row.**
`Anti-Alias` sat at bar slot 6, between `Size` and `Text color`, while its own `detail` said
the control "is no longer on the type options bar" — a row that could not be in a bar-order
census and simultaneously say it was off the bar. The array's contract settles it, so the
row is out and the control is documented in the next section instead. Renumbering is the
only other consequence: nothing above slot 5 moved.

### Anti-aliasing: off the bar in 27.x, and where the five presets went

The control is real and still matters; it is simply not a bar control any more. The five
presets are **None, Sharp, Crisp, Strong, Smooth** — from the third-party mirror of the
Photoshop Scripting Reference, which is where the five `AntiAlias` static properties and
their one-line descriptions are stated
(`https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html`; Sharp renders type at
its sharpest, Crisp somewhat sharp, Strong heavier, Smooth smoother).

**Where it is reached from changed twice, and the file had the older of the two.** The
CC-era route is Adobe's own, in the CS-era help mirrored at
`http://www.underwaterphotography.com/photoshop/photoshop/1_16_3_4.html`: "**To apply
anti-aliasing to a type layer: Select the type layer… Choose an option from the anti-aliasing
menu in the options bar or the Character palette. Or, choose Layer > Type**." In 27.x those
commands are a **top-level `Type` menu**, not a submenu of `Layer` — Adobe's Warp Text page
gives the current form of one of them, "select Type > Warp Text"
(`warp-and-unwarp-text.html`). The `Anti-Alias` row said "the Layer > Type menu" and the
same record's `purpose` said "the Type menu", so the file contradicted itself, and the
`purpose` is the one that is right. The row that carried the error is gone; the routes now
stand as: the **Character panel**, the **layer's properties**, and the **Type menu** — the
three the data file's `purpose` names.

**When it left the bar is still not sourced, and no version number is asserted.** See
`Unverified` item 3; the timing is community-reported and stays out of the data file.

**Every `appRef` in this table was re-derived from the control's meaning, not from the number
the previous pass wrote.** All eight of the old numbers were off by a small amount, and all
eight pointed at a wrapper rather than at the control: `:122` at the empty `<div>` the font
select sits in rather than the select, `:188` at the `<div>` opening the bold/italic pair
rather than a button, `:128` at the block wrapper above the size slider rather than the
`input`, `:167` at the wrapper above the align control rather than the `<select>`, `:209` at
the button-row opener rather than `Apply`, and in the crop family the same three shapes —
`Crop.tsx:8` at the `aspectRatios` data array rather than the rendered `<select>`,
`Crop.tsx:78` at the button-row opener rather than `Apply`, and `useRect.ts:254` at a bare
`case 'inside':` label rather than the statements that translate the rect. A `file:line` is
followed by an agent, so a line that lands one line early is a wrong answer dressed as a
right one, and the test that checks these citations deliberately validates the path and the
bound only (`scripts/__tests__/tool-descriptions.test.mjs:26-33` says so in its own
comment), so nothing but re-derivation catches it.

**Every `implementationRefs` entry was re-opened for the same reason, and four were wrong in
the way a bound check cannot see: each landed on the _previous_ entry's closing line.**
`settings.ts:62` was `resizeX: 100,` inside the TRANSFORM block, and the crop seed is `:67`;
`settings.ts:77` was `color: '#000000',` inside the SHAPE block, and the text seed is `:82`;
`toolProcessors.ts:145` was the `},` that closes the transform processor, and the crop entry
begins at `:146`; `toolProcessors.ts:159` was the `shape` processor, and the text entry
begins at `:160`. Every other entry was opened and confirmed to be what its record claims —
`crop.ts:26` the crop creator, `rect.ts:36` `trimRect`, `useRect.ts:167` the 0.7 fill,
`layer-renderer.ts:32` the six-name `vectorToolNames` set, `toolbar-mapping.ts:59` the
single crop entry, `toolbar-mapping.ts:107` the single type entry.

Why each verdict:

- **Font family — `partial`,** not `present`. `FontSelect` renders and writes through
  `handleFontFamilyChange` to the args, and the canvas honours it, so the control is real. But
  `src/components/ToolbarsRight/Text/FontSelect.tsx:5-20` is a hard-coded array of fourteen
  families, not an enumeration of what the platform has, and Photoshop renders the list in
  each face.
- **Font Style — `partial`.** Two toggle buttons stand in for a style combo. They reach the
  canvas as the `bold ` / `italic ` prefixes of the CSS font shorthand, so faux styles are
  never synthesized the way Photoshop synthesizes them for a family that lacks a weight.
- **Size — `partial`.** A range slider over 8–500, labelled in **px**, applied as
  `${fontSize}px`. Photoshop's default unit is points, the field is typed rather than slid,
  and it accepts a unit suffix.
- **Text color — `missing`, not `present`.** This was the row's one false verdict, and it was
  false in the direction that hides a defect: `Text.tsx` renders **no colour control at all**.
  What it does is the opposite — `Text.tsx:16-20` copies the store's foreground `color` into
  the tool args, one-way, so the bar is a _slave_ to the global foreground swatch in the left
  rail (`SidebarLeft.tsx:515-522`) rather than a control of its own. There is no Color Picker
  on the bar, and nothing here sets a per-layer type colour; a Photoshop user who expects the
  swatch in the options bar will not find one.
- **Align — `present`.** A `<select>` rather than three icon buttons, but the same three
  values, the same default (left), and the same effect. The Justify variants are not on the
  bar in Photoshop either.
- **Commit / Cancel — `partial`.** `Apply` and `Clear` do what the check mark and the cross
  do, and the draft is also committed implicitly when the tool changes (`goToTool` calls
  `commitDirtyTool`, `src/hooks/useApp.ts:169`, whose text branch is
  `src/contexts/useLayer.ts:349`). There is no keyboard commit and no Escape.

**There is no `inert` control in this family, and that was checked rather than assumed.**
`TextToolSettings` is `Omit<TextToolArgs, 'color' | 'text' | 'rect'>`, so the persisted
surface is exactly six keys — `align`, `bold`, `fontFamily`, `fontSize`, `italic`,
`lineHeight` — and all six are rendered by `Text.tsx` and all six reach
`src/tools/text.ts:43` or `:49`. Nothing is declared and unrendered. The `inert` trap this
family is usually suspected of is real but sits one level down: `fontSize` is a perfectly good
state that only ever reaches the screen through a raster that was produced once, at
`src/tools/text.ts:69-74`, and is then scaled rather than re-rendered.

### Character and Paragraph panel controls

Not part of the options-bar census above, but the other half of Photoshop's type surface and
requested explicitly. **All eight are `missing`** in the app; there is no Character panel and
no Paragraph panel, and the one control the app has that overlaps this set, line height, is
semantically different from Photoshop's leading.

| Control                                                                     | Photoshop                                                                                | App                                                                                        | Status                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Leading                                                                     | absolute baseline-to-baseline distance in points; per-line, largest value in a line wins | unitless multiplier of the font size, 0.5–2.25, applied as `index * fontSize * lineHeight` | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:155` |
| Tracking                                                                    | loose/tight in 1/1000 em, cumulative with manual kerning                                 | —                                                                                          | `missing`                                                    |
| Kerning                                                                     | None / Metrics / Optical / manual, cumulative with tracking                              | —                                                                                          | `missing`                                                    |
| Baseline shift                                                              | points, positive up                                                                      | —                                                                                          | `missing`                                                    |
| OpenType                                                                    | per-feature toggles                                                                      | —                                                                                          | `missing`                                                    |
| Indents (left / right / first line)                                         | paragraph type only                                                                      | —                                                                                          | `missing`                                                    |
| Hyphenation                                                                 | paragraph type only                                                                      | —                                                                                          | `missing`                                                    |
| Justification (Justify Last L/C/R, Justify All) + word/letter/glyph spacing | paragraph type only                                                                      | —                                                                                          | `missing`                                                    |

### Is the app's type layer live text or baked pixels?

**Baked pixels.** The chain, re-derived in this worktree:

1. `src/tools/text.ts:22-51` — `renderText` splits the string on `\n` and calls
   `ctx.fillText` per line onto a 2D context. There is no glyph outline, no font engine, and
   no retained text object anywhere in the module.
2. `src/tools/text.ts:66-75` — the `text` creator allocates an `OffscreenCanvas`, calls
   `renderText` onto it and returns `[canvas]`. A creator tool's return value is a raster.
3. `src/tools/toolProcessors.ts:160-166` — the `text` processor is `commit: 'source'`,
   `creator: true`, so the layer source is that raster.
4. `src/contexts/layer-renderer.ts:32` — `vectorToolNames` is a `Set` of **six** tool names:
   `shape`, `rectangle`, `ellipse`, `triangle`, `polygon`, `line`. `text` is not in it, so
   `isVectorSource` is false for a text layer and `getLayerBitmap` returns `layer.bitmap`
   instead of re-running the creator.
5. `src/contexts/layer-renderer.ts:81` — that bitmap is drawn with
   `ctx.drawImage(bitmap, x, y, position.width, position.height)`, so enlarging a text layer
   resamples it.

The layer _does_ retain its `TextToolArgs` (`ToolLayerSource.args`,
`src/contexts/layer-types.ts:21-24`, populated at `src/contexts/useLayer.ts:285`), so the
information needed to re-render survives; nothing reads it. Every consumer of the composited
document — the visible canvas, undo replay, and the PSD writer at
`src/contexts/psd-utils.ts:245`, which calls the same `drawLayerSource` — goes through
`getLayerBitmap`, so the raster is what is shown, replayed and exported.

The practical consequence: a text layer scaled up in the app is a resampled bitmap, where a
Photoshop type layer re-renders from the font at the new size and stays crisp.

### Two more app divergences worth stating

- **No text box, and therefore no wrapping.** `src/util/rect.ts:116-166`
  (`calculateNewRect`) measures the widest line and _grows_ the rect to fit it, then trims the
  result to the document. A line longer than the canvas is clipped at the canvas edge rather
  than wrapped. Photoshop's paragraph type does the opposite: the box is fixed and the text
  reflows inside it, with an overflow icon when it no longer fits.
- **Content is typed in the panel.** The string comes from a `<textarea>` in the right-hand
  panel, and a canvas drag only sizes the box (`TextToolArea.tsx:24-39`). There is no caret,
  no insertion point, no selection and no per-character formatting.

### Which Photoshop type keys the app actually binds

**`T`, and only `T`.** The complete key table is
`src/components/Common/AppKeyboardShortcuts.tsx` — the registrations at `:159-398` cover
`z`, `y`, `c`, `v`, `i`, `j`, `b`, `u`, `t`, `l`, `w`, `g`, `o`, `e`, `s`, `m`, `p` and their
shift/mod variants — plus three `Escape`/`Enter`/`Backspace`/`Delete` registrations in each of
the two lasso tool areas (`PolygonClickToolArea.tsx:914-948`,
`FeatherMagneticLassoToolArea.tsx:534-568`) and one `Escape` in the font popup
(`FontSelect.tsx:54-62`). Those are every call site of that hook in `src/`; the raw `onKeyDown`
handlers elsewhere (the transform box, the two dialogs, the sidebar's own fields) are not in it.
Nothing else in `src/` calls `useKeyDownShortcut`. The four
Photoshop rows the previous pass carried were all unbound, and two of them contradicted a
sentence already in the same file:

- `Shift+T` "cycle the type tools in the flyout group" — the type tile is a **single entry**
  (`toolbar-mapping.ts:107`), and the `t` registration passes no `shift`, so `Shift+T` simply
  re-selects the same tool.
- `Ctrl+Enter` / `⌘+Return`, `Enter` and `Esc` — no registration anywhere. `Enter` inside the
  focused textarea takes the textarea's own newline, and the only `Escape` handler the type
  tool would have had is inside the commented-out `handleKeyDown`
  (`TextToolArea.tsx:89-137`).

One nuance the data file now states and this pass verified: `T` itself is only live when the
textarea does **not** hold focus. `TextToolArea.tsx:41-43` focuses it as soon as the tool is
selected, and `useKeyboardEvents.tsx:136` refuses any registration that has not opted into
inputs while a field is focused — so a `T` pressed mid-edit types a letter.

### Sources

Adobe official help:

- https://helpx.adobe.com/photoshop/using/creating-type.html
- https://helpx.adobe.com/photoshop/using/editing-text.html
- https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html
- https://helpx.adobe.com/photoshop/using/formatting-characters.html
- https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html
- https://helpx.adobe.com/photoshop/using/line-character-spacing.html
- https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html
- https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html
- https://helpx.adobe.com/photoshop/using/layers.html
- https://www.adobe.com/learn/photoshop/web/rasterize-type-shape-layer
- https://www.adobe.com/products/photoshop/rasterize.html
- https://edex.adobe.com/teaching-resources/photoshop-type-mask-tool — Adobe's own teaching-resources page, and the source for the mask tools: "When you use the Horizontal Type Mask tool or Vertical Type Mask tool, you create a selection in the shape of the type." Reached through the live crawler; `webfetch` returns the page's empty app shell, so the quotation is the crawler's.

Adobe Community (a user report, not a specification):

- https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044

Adobe-authored, mirrored (the CS-era help text; the source of the `Layer > Type` anti-aliasing
route and the only place Adobe itself shows anti-aliasing applied to a live type layer):

- http://www.underwaterphotography.com/photoshop/photoshop/1_16_3_4.html — "To apply anti-aliasing to a type layer: Select the type layer… Choose an option from the anti-aliasing menu in the options bar or the Character palette. Or, choose Layer > Type"

Third party, labelled as such:

- http://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Character_palette.html — the only page found that enumerates the options bar left to right; an Adobe-training site, not Adobe
- https://www.dummies.com/article/technology/software/adobe-products/photoshop/text-options-for-photoshop-cc-163691 — names the Orientation button and the panel-toggle icon
- https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html — a third-party mirror of the Photoshop Scripting Reference, which is where the five `AntiAlias` static properties (`NONE`, `SHARP`, `CRISP`, `STRONG`, `SMOOTH`) and their one-line descriptions are stated

---

## crop — Crop Tool

### What the tool is

A crop is a **pending, non-destructive framing**. Selecting the Crop tool shows a crop box
over the photo. It is drawn by dragging, resized by its corner and edge handles, and rotated
by dragging just outside a corner. Adobe's own sentence for that last one, and the whole of
Adobe's text on it: "**Place the pointer a little outside the corner handles and drag to
rotate the image. A grid displays inside the crop box and the image rotates behind it.**"
(`crop-straighten-photos.html`.)

**There is no drag that moves the box, and this file used to say there was.** The previous
version of this section — and of the data file's `purpose` — claimed that the crop box "can
be moved without touching the image by dragging outside the box", in the same breath as the
correct first clause. Two clauses, one gesture, and the second one is false: dragging outside
a corner **rotates**. The distinction that does exist is between the three regions — handles
resize, outside a corner rotates, and inside the box moves the **image** while the box stays
put, which is the interaction everyone gets wrong. That last half is Adobe's too, from a
different page: "Select inside the crop border and drag to reposition the image"
(`tool-techniques/crop-tool.html`). Adobe's product FAQ covers the same region with a
sentence whose object is not named unambiguously — "click inside the crop area and drag to
move it", inside an answer about repositioning a crop area (`crop-image.html`) — so the one
unambiguous Adobe sentence about the inside drag is the one the data file uses, and what the
other page means by "it" is filed as `Unverified`.

Nothing is committed until you confirm: Enter (Windows) / Return (Mac OS), the check mark
below the box, or a double-click inside the box. **Esc cancels** and restores the previous
framing. The crop variants are Straight Crop (the default mode of the tool) and
**Perspective Crop** — a _separate tool_ in the same flyout, reached by holding the Crop tool
in the Tools panel or by `Shift+C`, which also holds Slice and Slice Select. `Straighten` is
the one crop-variant button on the bar, and **Content-Aware is not a bar control at all**:
it is a value inside the `Fill` dropdown. See the census below; the previous version of this
paragraph described "the Straighten and Content-Aware variants reachable from the options
bar", which is half wrong.

Modifiers, as a set: **Shift** constrains the box to the proportions it already has, **Alt**
draws and resizes from the center, and **Shift+Alt** does both. `X` swaps the box between
portrait and landscape.

### A correction to the research corpus and to the brief

The task brief asked me to verify the preset list "Ratio, W x H x Resolution, 1 x 1 (Square),
2 x 3, 4 x 5, 5 x 7, 8.5 x 11, and the orientation variants". Adobe's own table
(`crop-tool-options.html`, last updated 2026-02-23) is:

| Preset                 | What it does                                            |
| ---------------------- | ------------------------------------------------------- |
| **Ratio**              | Crops freely without a fixed ratio                      |
| **W × H × Resolution** | Crops to a defined width, height and resolution         |
| **Original Ratio**     | Maintains the image's original aspect ratio             |
| **1 : 1 (Square)**     | Crops to a perfect square                               |
| **4 : 5 (8 : 10)**     | Crops to a portrait ratio for print or social media     |
| **5 : 7**              | Crops to a standard photo print ratio                   |
| **2 : 3 (4 : 6)**      | Crops to a standard 4 × 6 print ratio                   |
| **16 : 9**             | Crops to a widescreen video ratio                       |
| **Front Image**        | Uses the dimensions and resolution of the current image |
| **New Crop Preset…**   | Saves a custom crop size and resolution for future use  |

Two premises in the brief are wrong, and both matter for how the app's control is described:

1. **There is no `8.5 x 11` crop preset — now established against the current Adobe list, not
   inferred from its absence.** The correction below was originally filed as a settled
   observation from the brief, which is the wrong kind of evidence: `grep 8.5` over the data
   files returned nothing, so the data file neither claimed nor sourced the absence, and one
   third-party page hints Adobe offers "a list of some commonly used specific sizes for
   prints". Re-read on this pass, Adobe's own table is an **enumeration of the menu's
   contents**, not a passing mention: the ten rows above, and no paper sizes among them
   (`crop-tool-options.html`, last updated Feb 23, 2026). That is a different kind of claim
   from "no page mentions 8.5 x 11" — the page is claiming to list the menu. US Letter is a
   _new document_ preset; the app already has it, in `src/constants/imagePresets.ts:21`,
   where it belongs. A user who wants a paper size in a crop makes one through **New
   Crop Preset…**, which is the last row of Adobe's own table.
2. **There are no per-preset orientation variants.** Photoshop has a **Swap Width and Height
   values** button next to the menu, which flips the active ratio, rather than a doubled list
   of portrait and landscape entries. The app instead ships both orientations as separate
   entries (`9:16` beside `16:9`, `3:4` beside `4:3`) — a different design, not a missing half
   of one.

The entry is named **Ratio**, not "Free". `01-photoshop-reference.md:568-569` has the right
list; the brief's version does not. The data file's row said `Ratio (free)`, which welded a
behaviour onto the name: Adobe's table gives `Ratio` as a **name** and "Crops freely without a
fixed ratio" as its **function**, and what actually returns the tool to unconstrained is
clearing the two Width and Height fields, not the item's name. The row now says both halves
separately.

**The swap button, and where its citation comes from.** An adversarial review noted that the
file has the control but a description rather than a source. It does now, and the source is
Adobe rather than the third party that was carrying it:
`https://helpx.adobe.com/photoshop-elements/using/cropping.html` — "**To swap Width and Height
values, click the Swap icon in the options bar.**" That is a different product, so it is
labelled as one; the control is the same, and Adobe's CS6 shortcut list independently gives
the same operation as a key: "**X | Switch crop box orientation between portrait and
landscape**" (`new-shortcuts-cs6.html`). The review also quoted a CS6-era Adobe reference
captioning its own screenshot "B. Swap Width and Height values" with the sentence "Clicking
the double-arrow icon changes the crop orientation by swapping the Width and Height values" —
**that exact caption could not be re-verified through the crawler in this pass**, so it is not
quoted in either file; the Elements sentence above carries the same claim and is verified.
`https://helpx.adobe.com/photoshop/using/tool-techniques/crop-tool.html` names the adjacent
fields ("setting the aspect ratio or width and height values") without naming the button.

### Delete Cropped Pixels

The one setting that decides whether a committed crop is reversible, and the app has no
counterpart for it at all.

**What is Adobe's.** One sentence, and it is the whole of Adobe's text on the setting: the
options page describes Delete Cropped Pixels as "**Permanently removes areas outside the
crop, but allows editing when turned off**" (`crop-tool-options.html`). That establishes the
delete-versus-hide contrast, which is the part of the row that is well attested, and it is
what the data file now leads with.

**What is not Adobe's — and was asserted anyway.** Four clauses were in the data file's row
and all four are third-party:

- that the setting is **on by default**;
- that the **Background layer is demoted** to a regular layer so Photoshop can keep the
  hidden pixels (this is the most specific and the most checkable of the four);
- that the pixels come back through **`Image ▸ Reveal All`** or by dragging the crop box out
  again;
- that **the file grows**.

None of the four was reached at Adobe in this pass, so all four are now marked third-party in
the row's own `detail` rather than presented as the setting's behaviour. They are plausible,
they are consistently reported, and `01-photoshop-reference.md` may well carry Adobe text for
some of them — but "consistently reported" is what they are, and the row now says so. What is
_not_ claimed anywhere is the app-side consequence, which is unaffected either way: the app
implements the **OFF** case — the canvas shrinks and the pixels stay in the layer bitmaps —
and offers neither the setting nor an `Image ▸ Reveal All` to change that. The earlier
version of this section said the app implemented the ON case, which inverted Adobe's own
delete-versus-hide contrast; see "Is the app's crop destructive?" below.

### Use Classic Mode, and the version boundary that was not Adobe's

The row used to open "Reverts the tool to the legacy behavior from **before Creative Cloud
2019**", stated as fact, with no source behind the boundary — while the sibling
`Delete Cropped Pixels` row went to real trouble to label its four unsourced clauses as
third-party. Same table, two different disciplines, and the unsourced one was the version
claim.

Adobe states the boundary itself, and it is not the one the row used: "**Enable this option
if you want to use the Crop tool like it was in previous versions of Photoshop (CS5 and
earlier).**" (`crop-straighten-photos.html`; a third-party walkthrough of the same bar
independently says "Classic Mode reverts the Crop tool to its Photoshop CS5 (and older)
self", which is corroboration rather than the reason.) The row now leads with Adobe's
sentence.

What the legacy behaviour _is_ — the crop box moving while the image stays put — is not on
that page and not on any other Adobe page reached; it is a consistent third-party
description, and the row says so in the same breath, which is the discipline the
`Delete Cropped Pixels` row already followed. The Creative Cloud 2019 boundary is not
reasserted anywhere: it may well be a true reading of when the behaviour changed, but no
source in this file supports it, and an unsourced version number is the exact failure
`Unverified` item 3 exists to prevent on the type side.

### Options-bar control census

Fourteen controls. `present` 0 · `partial` 4 · `inert` 0 · `missing` 10.

| #   | Control                          | Status    | `appRef`                                        |
| --- | -------------------------------- | --------- | ----------------------------------------------- |
| 1   | Aspect ratio menu                | `partial` | `src/components/ToolbarsRight/Crop/Crop.tsx:61` |
| 2   | Swap Width and Height values     | `missing` | —                                               |
| 3   | Clear                            | `missing` | —                                               |
| 4   | Straighten                       | `missing` | —                                               |
| 5   | Fill (incl. Content-Aware Fill)  | `missing` | —                                               |
| 6   | Settings (gear) menu             | `missing` | —                                               |
| 7   | Delete Cropped Pixels            | `missing` | —                                               |
| 8   | Show Cropped Area                | `partial` | `src/hooks/useRect.ts:167`                      |
| 9   | Enable Crop Shield               | `partial` | `src/hooks/useRect.ts:167`                      |
| 10  | Use Classic Mode                 | `missing` | —                                               |
| 11  | Auto Center Preview              | `missing` | —                                               |
| 12  | Overlay (Rule of Thirds default) | `missing` | —                                               |
| 13  | Grid                             | `missing` | —                                               |
| 14  | Done / Cancel                    | `partial` | `src/components/ToolbarsRight/Crop/Crop.tsx:79` |

**Two rows were added and one was rewritten, and the count line above was wrong before any of
that.** It said "Twelve controls · `partial` 3 · `missing` 9" while the table beneath it
listed four `partial` rows and the next heading already said "the four `partial` verdicts".
The two new controls are `Clear` and the `Settings (gear) menu`; the rewritten one is the
`Straighten` row, which used to be `Straighten / Curve / Content-Aware / Default` and named
three things the 27.x bar does not have:

- **`Straighten` is a button, and Adobe says so on the page the revalidation turned up**:
  "Click Straighten in the control bar and then using the Straighten tool, draw a reference
  line to straighten the photo" (`crop-straighten-photos.html`).
- **`Content-Aware` is a value, not a control.** The current Adobe instruction is "Go to the
  Fill dropdown in the Options bar and select Content-Aware Fill"
  (`apply-content-aware-fill-while-cropping-images.html`), and the page's own Note is "To use
  Content-Aware Fill on Crop, ensure Use Classic Mode is turned off". The bar-row version of
  it belongs to CC 2015.5 through the CC-era walkthroughs, which is where the old row's
  confidence came from.
- **`Curve` and `Default` appear in no source at all** — not an Adobe page, not a third
  party. `Curve` is the shape the separate **Perspective Crop tool** covers, and `Default`
  is the unmarked state the tool is in before you touch the bar.
- The old row also claimed that holding Ctrl (Windows) or Command (Mac OS) "reaches
  Straighten without visiting the bar". No source in this pass supports it, and the app's own
  reading of those two keys is the opposite operation (aspect-ratio lock), so the clause is
  out of the data file and filed as `Unverified`.

**`Clear` — Adobe's own FAQ, and what it collides with in the app.** Adobe's crop product
page answers its own "How do I crop freely?" question with the control:
"Select the Crop tool (C) and set the crop preset to 'Ratio' or 'W x H x Resolution' in the
upper setting bar. Next, **press 'clear' to remove any constraints applied to your crop
preset**." (`crop-image.html`.) That is also the source `Unverified` item 13 wanted for the
Aspect-ratio row's clause about clearing the two Width and Height fields: the button is the
mechanism, and the row now says so instead of leaving the behaviour unattributed.

The app is `missing` this control, and the name collision is the trap: the panel's own
`Clear` button (`Crop.tsx:89-95`) drops the draft crop rect and leaves the aspect ratio
alone, which is Photoshop's cancel, not its `Clear`. The data file's new row says so, because
a reader who sees "Clear" in both places would otherwise read the verdict as a name match.

**The `Settings (gear) menu` is a container, and it is what the census was missing.** Adobe's
crop-straighten page introduces the crop's own fly-out with one sentence — "**Click the
Settings (gear) menu to specify additional crop options**" — and the five settings the
options page tabulates (Delete Cropped Pixels, Use Classic Mode, Auto Center Preview, Show
Cropped Area, Enable Crop Shield) are its contents. The census listed all five and never
listed the thing that holds them, which is how a reader ends up expecting five bar
positions that do not exist as five bar positions.

**Where the two new rows sit, and how far that is from a verified order.** `options[]` is
"in bar order", and no Adobe page found in this pass enumerates the crop bar left to right —
`crop-straighten-photos.html` captions a figure ("A. Aspect Ratio menu B. Swap Width and
Height values C.") and the options page tabulates settings, not positions. So the two
placements are **structural, not measured**: `Clear` goes with the aspect-ratio group it acts
on (slots 1–3), and the gear goes immediately before the five rows it contains (slot 6,
ahead of slot 7). The one current left-to-right enumeration that was reachable is a
third-party screenshot description — "options for Straighten, Grid, settings, Delete Cropped
Pixels, and Fill dropdown" (`shotkit.com`, in the sources list) — and it puts the gear to the
right of Grid, which is consistent with the structural placement and **not** with a full
ordering of the bar. What is filed as `Unverified` is the bar's exact order, not the two
controls.

Why the four `partial` verdicts:

- **Aspect ratio — `partial`,** not `present`. The mechanism is right: a choice constrains the
  rect during the drag through `useRect`, and it is wired end to end. The set is wrong. The
  app has six entries — `Free`, `Square (1:1)`, `3:4`, `4:3`, `16:9`, `9:16` — against
  Photoshop's ten plus two preset commands. `Free` is the app's name for `Ratio`, `1:1`
  matches, and `16:9` matches; **`4:5 (8:10)`, `5:7`, `2:3 (4:6)`, `Original Ratio`,
  `W × H × Resolution`, `Front Image`, `New Crop Preset` and `Delete Crop Preset` are all
  absent**, and `3:4` and `9:16` are entries Photoshop does not have.
- **Enable Crop Shield — `partial`,** on the one line of code that draws the shield
  (`useRect.ts:167`): it is always on, its opacity is fixed at 0.7 rather than the adjustable
  figure Adobe documents, and its color is not configurable.
- **Show Cropped Area — `partial`,** on that same line and for the reasons in the next
  paragraph, which is the long version of this bullet rather than a separate argument.
- **Done / Cancel — `partial`.** `Apply` calls `applyDocumentCrop` and `Clear` drops the
  draft rect, which is the same pair of effects as the check mark and the cross. There is no
  Enter, no Return, no double-click and no Escape.

**Show Cropped Area and Enable Crop Shield are both `partial` on the same line, and that is the
finding, not a double-count.** Both attempts to file them separately were wrong in opposite
directions. The first pass cited `useRect.ts:167` under both names, which made the app look two
controls deep where it draws one overlay. A later pass therefore denied one of them, and wrote that
"Photoshop's Show Cropped Area shades the discarded image inside the box, and nothing in the app
draws that" — false twice over. The app does draw a dim: the mask at `useRect.ts:164-172` fills the
whole canvas with `rgba(0, 0, 0, 0.7)` and then clears the crop rect, and `CropToolArea` passes no
`hideBlend`, which is the only flag `drawMask` consults (`useRect.ts:164`), so that branch runs whenever
there is a rect to draw. And the dimmed region is the one _outside_ the box, so "inside" was wrong about the
app's own drawing whatever Photoshop does. It is also wrong about Photoshop: Adobe's own sentence for
the control is "Displays the cropped-out area as a shaded overlay", with no region attached, and
Adobe's sentence for Enable Crop Shield is "Applies a color overlay outside the crop area" — so the
two cover the same region and differ in that this one is a plain shade and that one is a colour and
an opacity you choose. The `detail` no longer says "inside the crop box", for the same reason.

The correct reading is that one rendering backs two Photoshop controls, and each diverges from its
own counterpart: the app's treatment is welded on with nothing on screen to change its colour,
opacity or existence, and both its shade and its 0.7 are constants where the Crop Shield is the
control Adobe documents as adjustable. So both rows are `partial`, both cite the same line, and
`appNotes` says why one rendering backs two. The earlier reasoning — that two distinct
Photoshop controls cannot both be `partial` on one statement — is sound as a rule about
double-counting a _control_, and wrong as applied here, because the claim being filed is the
behaviour, not the control.

**No `inert` control here either, also checked rather than assumed.** `CropToolArgs` has
three keys — `rect`, `preRatioRect`, `aspectRatio` — plus the seed in
`src/tools/settings.ts:67`. All three are read and written: `preRatioRect` by
`Crop.tsx:40,48` and cleared on both write paths, `aspectRatio` by `CropToolArea.tsx:19,26`
and passed into `useRect`, `rect` by every writer. The `preRatioRect` field is a
regression-repair field, not a user-facing control, so it has no Photoshop counterpart to be
`inert` about.

### Is the app's crop destructive?

**It is not — and the previous pass said the opposite.** `src/contexts/useLayer.ts:612-640`
(`applyDocumentCrop`) trims the rect to the canvas, converts it to the next `documentFrame`
via `canvasRectToDocumentFrame`, and dispatches `COMMIT_DOCUMENT_EDIT` with a
`SET_DOCUMENT_FRAME_ACTION` history entry carrying both the previous and next frame. The
document shrinks immediately; `layer-renderer.ts:78-81` subtracts the frame origin and the
canvas is sized to the frame, so anything outside it stops rendering.

But nothing is destroyed. Layer positions and sources are untouched, so the bitmaps still hold
the pixels, and the history entry carries `previousFrame`, so undo puts the frame back. That
is Photoshop's **Delete Cropped Pixels OFF** case — the canvas shrinks, the pixels are kept,
the edit stays reversible — where the **ON** case permanently removes everything outside the
crop. The earlier version of this section had it backwards, called the app "destructive",
and then contradicted itself two sentences later by saying undo restores the frame.

What the app really lacks is the **setting** and the route back: there is no Delete Cropped
Pixels control to offer or invert, and no `Image ▸ Reveal All` menu item (`grep` for
`Reveal All` across `src/` returns nothing outside this notes file). Undo is the only way to
see the discarded area again, and undo is not a control on the bar.

### Five interaction divergences

- **Dragging inside the box moves the box, not the image.** `useRect.ts:254-262` translates
  the rect by the drag delta for its `inside` edge, and the branch at `useRect.ts:347-354`
  that would instead adopt the layer under the pointer never runs, because
  `CropToolArea.tsx:21-41` passes `useRect`'s handlers straight through without a
  `layerUnderPointer`. Photoshop's contract is the opposite way round.
- **Extending the crop cannot add canvas.** `usePointerPosition.getLocalCoords` does not
  clamp, so the rect can be dragged past the image edge — but `trimRect`
  (`src/util/rect.ts:36-60`) clamps every edge to the document, so the extra area is simply
  cut off. In Photoshop, dragging a handle outward past the photo grows the canvas, and what
  fills it is what the `Fill` control selects.
- **The pending rect is DISCARDED by a tool switch, not written through.** The previous pass
  claimed the draft "survives a tool switch", and the file's own comment said the opposite in
  as many words. The crop arm of `saveLastSettings` (`src/util/settings.ts:33-38`) persists
  `omit(args, 'rect', 'preRatioRect')` — the draft rect and the pre-ratio rect are stripped
  before the write, with a comment saying they are "both presentation state" — so
  `lastSavedSettings.crop` holds only the aspect ratio. `goToTool`
  (`src/hooks/useApp.ts:169`) commits the dirty tool, and `useCurrentTool.tsx:49-50` re-seeds
  the crop from those persisted settings, which no longer hold a rect. Switching away and back
  therefore throws the draft away. Of Photoshop's two behaviours this is much closer to
  cancel-on-Escape than to commit-on-switch, and the aspect ratio _is_ sticky, which is
  probably what the earlier reading mistook for a surviving draft.
- **Shift is honoured on any modifier.** `useRect.ts:96-99` locks the aspect ratio when
  `ctrlKey || metaKey || shiftKey` is set, and reads the lock at `useRect.ts:249`. So the
  `Shift` row of the `modifiers` array is `present` in substance but over-broad in binding,
  and there is no Alt from-center drag anywhere — which is why the `Alt` and `Alt+Shift` rows
  of that array are aspirational and are described as Photoshop's rather than the app's.
- **The crop registers no keyboard shortcut of its own.** The only crop key is `C`
  (`AppKeyboardShortcuts.tsx:255-260`); everything else Photoshop binds for the crop is
  absent, and two of them are actively harmful to repeat. Detail in the next section.

### Which Photoshop crop keys the app actually binds

**`C`, and only `C`.** The `useKeyDownShortcut` table is the one given for the type tool above —
`AppKeyboardShortcuts.tsx` (letters only: `b c e g i j l m o p s t u v w y z`, plus shift and mod
variants), the two lasso tool areas and the font popup, and those are every call site of that hook in
`src/`. It is not the whole of the app's key handling: the transform box, the two dialogs and the
sidebar's own fields each attach a raw `onKeyDown`, which is why the `Esc` and `Enter` rows below
name those rather than claiming the table is exhaustive. Against it, every non-`C` row the previous
pass carried is false:

| Photoshop key        | What the app actually does                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Shift+C`            | The crop tile is a **single entry** (`toolbar-mapping.ts:59`), and the `c` registration passes no `shift`, so this re-selects Crop. There is no flyout to cycle, and Perspective Crop, Slice and Slice Select are not in `ToolArgsByName` at all. |
| `Enter` / `Return`   | Unbound for the crop. `Enter` is registered in `PolygonClickToolArea.tsx:922` and `FeatherMagneticLassoToolArea.tsx:542`, and handled raw in the sidebar's own fields; `CropToolArea` calls no `useKeyDownShortcut`.                              |
| `Esc`                | Unbound for the crop. `Escape` is registered in those two lasso areas and in `FontSelect.tsx:54`, and handled raw by the transform box (`Transform.tsx:37`), the two dialogs and the layer-rename field.                                          |
| `O`                  | **Switches tools.** `AppKeyboardShortcuts.tsx:329-334` binds `o` to `selectTonalTool`, whose group is `['dodge', 'burn']` (`:31`). Pressing it while cropping leaves the crop for the Dodge tool, which is the opposite of cycling an overlay.    |
| `Shift+O`            | Same handler with `shift: true` (`:336-342`), so it also leaves the crop — it toggles between Dodge and Burn.                                                                                                                                     |
| `X`                  | Unbound. There is no `x` registration anywhere in `src/`; `matchesShortcut` is case-insensitive, so this is not a capitalisation miss.                                                                                                            |
| `Backspace`/`Delete` | Bound only in the two lasso tool areas (`PolygonClickToolArea.tsx:936-952`, `FeatherMagneticLassoToolArea.tsx:556-572`), and only to remove the last draft anchor.                                                                                |
| `Ctrl`/`⌘` + drag    | `useRect.ts:96-99` reads Ctrl and Command to **lock the current aspect ratio** — the behaviour the `Shift` modifier row already describes. It never reaches a Straighten tool; there is none.                                                     |

So the data file's `shortcuts` array now carries `C` alone, and `appNotes` states the absence
of the other eight, with `O`/`Shift+O` called out as tool switches rather than as no-ops. The
Photoshop-side provenance for these keys is unchanged and still in the source list: Adobe's
CS6 shortcut list for `X` and `Shift+drag`, and the two third-party tutorials below for
`Shift+C`, `O`, Alt-from-centre, Enter and Esc.

### Sources

Adobe official help:

- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html — the preset table and the Delete Cropped Pixels / Classic Mode / Auto Center Preview / Show Cropped Area / Crop Shield table
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/apply-content-aware-fill-while-cropping-images.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html
- https://helpx.adobe.com/photoshop/using/tool-techniques/crop-tool.html
- https://helpx.adobe.com/photoshop/using/crop-straighten-photos.html
- https://helpx.adobe.com/photoshop-elements/using/cropping.html — Adobe, but Elements: "To swap Width and Height values, click the Swap icon in the options bar", the control the current Photoshop pages do not name
- https://helpx.adobe.com/in/photoshop/using/new-shortcuts-cs6.html — Adobe's crop shortcut list; **note it is the CS6 list**, and it is the oldest source used in this family
- https://helpx.adobe.com/ph_fil/photoshop/how-to/content-aware-crop-fill.html

Adobe product marketing:

- https://www.adobe.com/products/photoshop/crop-image.html — the Rule of Thirds overlay, the Ratio / W x H x Resolution names, the drag-inside-to-move behaviour, and the `Clear` button: "press 'clear' to remove any constraints applied to your crop preset"
- https://www.adobe.com/products/photoshop/generative-fill.html — Generative Extend's own Crop-tool sentence: "Just click and drag beyond the borders of an image with the Crop tool, and then fill the extended canvas with new content that blends with the existing image"

Third party, labelled as such:

- https://www.photoshopessentials.com/basics/photoshop-crop-tool-tips-and-tricks — the Shift / Alt / Shift+Alt constraint set and the `X` swap
- https://creativepro.com/essential-tips-for-cropping-images-photoshop — `Shift+C` flyout, `O` overlay cycling, Alt from center, Enter commits and Esc cancels
- https://design.tutsplus.com/tutorials/10-things-you-should-know-about-the-crop-tool--psd-34592 — the six-entry overlay set, and the Classic Mode behaviour (the crop rectangle moves while the image stays put)
- https://shotkit.com/extend-background-photoshop-generative-fill — the current `Fill` dropdown as read off the bar: **Transparent**, Content-Aware and **Generative Expand**; also the one left-to-right reading of the bar reached in this pass ("options for Straighten, Grid, settings, Delete Cropped Pixels, and Fill dropdown")

---

## Unverified

Listed because they could not be sourced, or could be sourced only weakly. None of these
appears as an assertion in `type-crop.ts`.

1. **REFUTED, not open: "Anti-aliasing takes effect only on rasterization."** This was filed here
   as merely unsourced, and the available evidence already pointed the _other_ way. It is now
   closed. Two independent Adobe texts put anti-aliasing on a **live, un-rasterized** type layer:
   - `https://helpx.adobe.com/photoshop/using/creating-type.html` lists "**Apply anti-aliasing**"
     among the changes "You can make … to a type layer and **still edit the type**", in the same
     list as point/paragraph conversion and work-path creation.
   - The CS-era Adobe help (mirrored at
     `http://www.underwaterphotography.com/photoshop/photoshop/1_16_3_4.html`) gives the
     procedure: "**To apply anti-aliasing to a type layer: Select the type layer… Choose an option
     from the anti-aliasing menu in the options bar or the Character palette. Or, choose
     Layer > Type**."
     The third-party tutorial that showed a visible Crisp-versus-Sharp difference in the
     document, rather than only in a rasterized result, is corroboration rather than the reason.
     **Do not re-raise this.** The claim is wrong, not unverified, and the data file never made it.
     The one thing that _is_ still open is item 3 below, which is a different question — when the
     control left the bar, not whether it works on live type.
2. **Photoshop's font size range.** The research corpus gives 1–1296 pt. No Adobe page
   states a range, and none was found in this pass. The _default unit being points_ is
   sourced (a Photoshop community answer notes "the default unit for type layers in Points");
   the range is not. The app's 8–500 px is therefore described as diverging without claiming
   what Photoshop's bounds are.
3. **When exactly the anti-aliasing pull-down left the type options bar — and the version number
   is now out of the data file entirely.** The only evidence was an Adobe Community bug report
   dated August 2025 saying it is "gone since Photoshop 26.10", corroborated by a Reddit thread.
   No Adobe release note or "What's new" page was found. A version boundary asserted from a bug
   report is the most likely thing in this file to be wrong, and it was wrong twice: the data file
   asserted "removed in 26.10" in **both** the `purpose` prose and the `Anti-Alias` control's
   `detail`, and the notes here simultaneously conceded that the boundary is community-reported.
   That is the file's own rule broken — an unsourced claim in the data file, a concession in the
   notes — so **the number is gone from both places**. What the data file says now is only what
   every source agrees on: the pull-down is no longer on the type options bar, and it is reached
   from the Character panel, the layer's properties and the **Type menu**. The menu moved:
   `Layer > Type` is Adobe's own route in the **CS-era** help quoted in item 1, and in 27.x the
   same commands are a top-level `Type` menu ("select Type > Warp Text",
   `warp-and-unwarp-text.html`). The `Anti-Alias` row used to say `Layer > Type` while the
   record's own `purpose` said `Type menu`, so the file contradicted itself; the row is out of
   the census now (see "Anti-aliasing: off the bar in 27.x") and the routes in `purpose` name
   the current menu. Where the data file mentions timing at all it
   says "community-reported only". Do not reintroduce a version number without an Adobe release
   note.
   Closest: https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044
4. **The two path buttons' Photoshop names and bar positions.** "Align to Path" and "Create
   Work Path" could not be confirmed from any Adobe page. What _is_ sourced: type flows along
   an open or closed work path, and creating a work path from type is a non-destructive
   operation on a live type layer. The data file therefore names the controls
   descriptively and does not claim Adobe's exact button labels.
   Closest: https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html
5. **The crop shield's default opacity.** Adobe documents a customizable color and opacity
   and nothing about the default. The commonly cited 75% figure — repeated in
   `01-photoshop-reference.md:566` — was not found in any source in this pass, so it is not
   asserted anywhere.
   Closest: https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html
6. **Whether Shift, in Photoshop's crop, also swaps portrait and landscape** in addition to
   constraining proportions. Adobe's CS6 list gives `X` for the swap and "Shift + drag corner
   handle → Constrain proportions" separately, which is what the data file says, but the
   CS6 list is old and was not cross-checked against a current shortcut reference.
   Closest: https://helpx.adobe.com/in/photoshop/using/new-shortcuts-cs6.html
7. **Default states for Auto Center Preview, Show Cropped Area and Enable Crop Shield.**
   Adobe lists the three settings but not which are on by default.
8. **Photoshop's type fill modes** (solid / gradient / stroke fill on a type layer). Not
   researched; the data file claims only the solid color swatch.
9. **Photoshop's OpenType feature set for the type tool** (`liga`, `dlig`, `calt`, `smcp`,
   `swsh`, `salt`, `tnum`, `ordn`, `frac`), and the claim that Photoshop has no stylistic
   sets. Carried over from the research corpus and not re-verified; the data file names the
   control without enumerating features.
10. **"Each committed type edit is a separate history state,"** and the shape of Photoshop's
    `HistoryState`. Carried from `01-photoshop-reference.md:497-498`, not re-verified, and not
    asserted in the data file.
11. **Whether `W × H × Resolution` accepts a single dimension** with the other left empty, as
    a third-party tutorial describes. Only third-party; not asserted.
    Closest: https://jkost.com/blog/2017/05/essential-tips-for-cropping-in-photoshop-cc.html
12. **The four `Delete Cropped Pixels` clauses that are not Adobe's.** The setting's on-by-default
    state, the Background layer being demoted so the hidden pixels can be kept, the `Image ▸
Reveal All` route back, and the file growth are third-party throughout; Adobe's own options
    page gives one sentence, "Permanently removes areas outside the crop, but allows editing when
    turned off". All four were asserted in the data file's row and all four are now marked
    third-party inside that row. They are not deleted, because they are consistently reported and
    the delete-versus-hide contrast built on them is the well-attested part — but they are
    **not** Adobe text and the row no longer implies that they are. See the section under "Delete
    Cropped Pixels" for the split.
    Closest: https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html
13. **Partly resolved since this was filed: what returns the crop to unconstrained.** Adobe's
    options table defines `Ratio` as "Crops freely without a fixed ratio" and still does not
    describe the Clear button, but Adobe's own product FAQ now names the control and its
    effect — "press 'clear' to remove any constraints applied to your crop preset" — so the
    **button** is sourced and is a row of its own. What remains unverified is the narrower
    claim the Aspect-ratio row still makes, that _clearing the two Width and Height fields_ is
    the same act; the two are consistent, but consistency is not the same claim, and the
    field-level description is still third-party walkthrough wording. The "free" half of the
    old `Ratio (free)` gloss — which attached the behaviour to the item's _name_ — is what was
    taken out, and it stays out. Closest:
    https://www.photoshopessentials.com/basics/how-to-crop-images-photoshop-cc
14. **Any runtime measurement.** No browser was executed and no test was run for this family.
    Every claim about the app's behaviour above is read off the source in this worktree, not
    observed at runtime.
15. **The crop bar's exact left-to-right order.** `options[]` is contractually "in bar order"
    and no Adobe page reached in this pass enumerates the 27.x crop bar: the crop-straighten
    page captions a figure ("A. Aspect Ratio menu B. Swap Width and Height values C.") and
    the options page tabulates _settings_, not _positions_. The only current left-to-right
    reading is a third-party screenshot description — "Straighten, Grid, settings, Delete
    Cropped Pixels, and Fill dropdown" — which is not a full order and does not place every
    row. The `Clear` and `Settings (gear) menu` placements are therefore **structural**: the
    first sits with the aspect-ratio group it clears, the second immediately before the five
    settings it contains. Do not read the table as a measured order without a source that
    measures one.
    Closest: https://shotkit.com/extend-background-photoshop-generative-fill
16. **That Ctrl (Windows) / Command (Mac OS) reaches Straighten without visiting the bar.**
    The previous `Straighten / Curve / Content-Aware / Default` row asserted it, no source in
    this pass supports it, and the app reads those two keys for the opposite operation
    (aspect-ratio lock, `useRect.ts:96-99`). The clause is out of the data file; it is not
    asserted to be false either, only unsourced here.
17. **The `Fill` dropdown's complete value list.** No Adobe page enumerates it. The
    Transparent / Content-Aware / Generative Expand set in the data file is a third-party
    reading of the current bar; the CC-era list the row used to give (None, Content-Aware
    Fill, Background, Foreground Color, Black, 50% Gray, White) is third-party, undated in
    this file, and predates Generative Expand. The data file now says which is which rather
    than presenting either as the menu's contents. Adobe's own text establishes only that
    Content-Aware Fill is a value in it and that Generative Expand is what the crop flow is
    built around.
18. **Which of the two an inside drag moves.** `tool-techniques/crop-tool.html` is
    unambiguous — "Select inside the crop border and drag to reposition the image" — and is
    what the data file uses. `crop-image.html` covers the same region with "click inside the
    crop area and drag to move **it**", inside an answer about repositioning a crop area, and
    the pronoun's object is not stated. Both are Adobe; they cannot both be a description of
    the same product's behaviour, so one of them is loose, and which one is not determinable
    from the pages.
19. **The Adobe shortcut sheet that lists all four type tools on `T`.** The revalidation
    brief cites `https://cdn.edex.adobe.com/.../08d7c4a0-….pdf` for it; `webfetch` returns raw
    PDF bytes rather than text and no search result surfaced the sheet's contents, so the URL
    is **not** in the data file's `sources` — that array takes only URLs that were opened. The
    four names are carried by Adobe's own Type-mask teaching page, by the Adobe overview table
    recorded in `AGENTS.md`, and by third-party walkthroughs. Anyone who can open the PDF
    should add it and tighten the wording.
