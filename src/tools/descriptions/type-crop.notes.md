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

The type tool has a flyout: the three tools Photoshop 2024–2026 ships are Horizontal Type,
Vertical Type, Horizontal Type Mask and Vertical Type Mask, with the mask variants creating
a selection outline in the shape of the type instead of a type layer. `T` selects the tool
and `Shift+T` cycles the group.

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
cannot do. The control stays in the census with the routes that replaced it, because the
control is a real Photoshop control; what changed is where it lives. See `Unverified` item 3.

### Options-bar control census

Thirteen controls. `present` 2 · `partial` 4 · `inert` 0 · `missing` 7.

| #   | Control                                   | Status    | `appRef`                                         |
| --- | ----------------------------------------- | --------- | ------------------------------------------------ |
| 1   | Tool preset                               | `missing` | —                                                |
| 2   | Text Orientation (`T` + direction marker) | `missing` | —                                                |
| 3   | Font family                               | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:122` |
| 4   | Font Style                                | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:188` |
| 5   | Size                                      | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:128` |
| 6   | Anti-Alias                                | `missing` | —                                                |
| 7   | Text color                                | `present` | `src/components/ToolbarsRight/Text/Text.tsx:16`  |
| 8   | Align Text Left / Center / Right          | `present` | `src/components/ToolbarsRight/Text/Text.tsx:167` |
| 9   | Toggle the type on a path                 | `missing` | —                                                |
| 10  | Create Work Path                          | `missing` | —                                                |
| 11  | Warp Text                                 | `missing` | —                                                |
| 12  | Toggle the Character and Paragraph panels | `missing` | —                                                |
| 13  | Commit / Cancel                           | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:209` |

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
- **Text color — `present`.** The panel itself has no swatch: `Text.tsx:16-20` syncs the
  args' `color` from the store's foreground color, and `TextToolArea` repaints the overlay
  with it. That is the same effect Photoshop's swatch has.
- **Align — `present`.** A `<select>` rather than three icon buttons, but the same three
  values, the same default (left), and the same effect. The Justify variants are not on the
  bar in Photoshop either.
- **Commit / Cancel — `partial`.** `Apply` and `Clear` do what the check mark and the cross
  do, and the draft is also committed implicitly when the tool changes. There is no keyboard
  commit and no Escape.

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
| Leading                                                                     | absolute baseline-to-baseline distance in points; per-line, largest value in a line wins | unitless multiplier of the font size, 0.5–2.25, applied as `index * fontSize * lineHeight` | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:147` |
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
3. `src/tools/toolProcessors.ts:159-165` — the `text` processor is `commit: 'source'`,
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
over the photo. It is drawn by dragging, resized by its corner and edge handles, rotated by
dragging outside a corner, and the crop box can be moved without touching the image by
dragging outside the box. Dragging _inside_ the box moves the **image** while the box stays
put — the distinction between those two drags is the interaction everyone gets wrong.

Nothing is committed until you confirm: Enter (Windows) / Return (Mac OS), the check mark
below the box, or a double-click inside the box. **Esc cancels** and restores the previous
framing. The three variants are Straight Crop (the default mode of the tool), **Perspective
Crop** — a _separate tool_ in the same flyout, reached by holding the Crop tool in the Tools
panel or by `Shift+C`, which also holds Slice and Slice Select — and the Straighten and
Content-Aware variants reachable from the options bar.

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
implements the ON case and offers neither the setting nor a route back.

### Options-bar control census

Twelve controls. `present` 0 · `partial` 4 · `inert` 0 · `missing` 8.

| #   | Control                                      | Status    | `appRef`                                        |
| --- | -------------------------------------------- | --------- | ----------------------------------------------- |
| 1   | Aspect ratio menu                            | `partial` | `src/components/ToolbarsRight/Crop/Crop.tsx:8`  |
| 2   | Swap Width and Height values                 | `missing` | —                                               |
| 3   | Straighten / Curve / Content-Aware / Default | `missing` | —                                               |
| 4   | Fill (incl. Content-Aware Fill)              | `missing` | —                                               |
| 5   | Delete Cropped Pixels                        | `missing` | —                                               |
| 6   | Show Cropped Area                            | `partial` | `src/hooks/useRect.ts:167`                      |
| 7   | Enable Crop Shield                           | `partial` | `src/hooks/useRect.ts:167`                      |
| 8   | Use Classic Mode                             | `missing` | —                                               |
| 9   | Auto Center Preview                          | `missing` | —                                               |
| 10  | Overlay (Rule of Thirds default)             | `missing` | —                                               |
| 11  | Grid                                         | `missing` | —                                               |
| 12  | Done / Cancel                                | `partial` | `src/components/ToolbarsRight/Crop/Crop.tsx:78` |

Why the four `partial` verdicts:

- **Aspect ratio — `partial`,** not `present`. The mechanism is right: a choice constrains the
  rect during the drag through `useRect`, and it is wired end to end. The set is wrong. The
  app has six entries — `Free`, `Square (1:1)`, `3:4`, `4:3`, `16:9`, `9:16` — against
  Photoshop's ten plus two preset commands. `Free` is the app's name for `Ratio`, `1:1`
  matches, and `16:9` matches; **`4:5 (8:10)`, `5:7`, `2:3 (4:6)`, `Original Ratio`,
  `W × H × Resolution`, `Front Image`, `New Crop Preset` and `Delete Crop Preset` are all
  absent**, and `3:4` and `9:16` are entries Photoshop does not have.
- **Show Cropped Area — `partial`.** `useRect.drawMask` fills the whole image with
  `rgba(0, 0, 0, 0.7)` and then clears the crop rect, so the area outside is always dimmed
  and the area inside always shows the image. The behaviour is right; there is no toggle, and
  the value is hard-coded rather than chosen.
- **Enable Crop Shield — `partial`,** same line of code and the same reason: the shield is
  always on, its opacity is fixed at 0.7 rather than the adjustable figure Adobe documents,
  and its color is not configurable.
- **Done / Cancel — `partial`.** `Apply` calls `applyDocumentCrop` and `Clear` drops the
  draft rect, which is the same pair of effects as the check mark and the cross. There is no
  Enter, no Return, no double-click and no Escape.

**No `inert` control here either, also checked rather than assumed.** `CropToolArgs` has
three keys — `rect`, `preRatioRect`, `aspectRatio` — plus the seed in
`src/tools/settings.ts:62`. All three are read and written: `preRatioRect` by
`Crop.tsx:40,48` and cleared on both write paths, `aspectRatio` by `CropToolArea.tsx:19,26`
and passed into `useRect`, `rect` by every writer. The `preRatioRect` field is a
regression-repair field, not a user-facing control, so it has no Photoshop counterpart to be
`inert` about.

### Is the app's crop destructive?

Yes, and there is no off switch. `src/contexts/useLayer.ts:612-640` (`applyDocumentCrop`)
trims the rect to the canvas, converts it to the next `documentFrame` via
`canvasRectToDocumentFrame`, and dispatches `COMMIT_DOCUMENT_EDIT` with a
`SET_DOCUMENT_FRAME_ACTION` history entry carrying both the previous and next frame. The
document shrinks immediately; `layer-renderer.ts:78-81` subtracts the frame origin and the
canvas is sized to the frame, so anything outside it stops rendering.

The pixels are not actually gone — layer positions and sources are untouched, so the bitmaps
still hold them, and undo restores the frame through the history entry. But that is precisely
Photoshop's **Delete Cropped Pixels ON** case, and the app offers neither the setting nor
`Image ▸ Reveal All` (`grep` for `Reveal All` across `src/` returns nothing). There is no
route back except undo.

### Four interaction divergences

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
- **The pending rect survives a tool switch.** It lives on the tool args, which
  `useCurrentTool` writes through to the persisted settings, so switching tools and coming
  back restores the draft. Photoshop commits on a tool switch. The app neither commits nor
  discards.
- **Shift is honoured on any modifier.** `useRect.ts:96-99` locks the aspect ratio when
  `ctrlKey || metaKey || shiftKey` is set, and reads the lock at `useRect.ts:249`. So the
  `Shift` row of the `modifiers` array is `present` in substance but over-broad in binding,
  and there is no Alt from-center drag anywhere — which is why the `Alt` and `Alt+Shift` rows
  of that array are aspirational and are described as Photoshop's rather than the app's.

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

- https://www.adobe.com/products/photoshop/crop-image.html — the Rule of Thirds overlay, the Ratio / W x H x Resolution names, and the drag-inside-to-move behaviour

Third party, labelled as such:

- https://www.photoshopessentials.com/basics/photoshop-crop-tool-tips-and-tricks — the Shift / Alt / Shift+Alt constraint set and the `X` swap
- https://creativepro.com/essential-tips-for-cropping-images-photoshop — `Shift+C` flyout, `O` overlay cycling, Alt from center, Enter commits and Esc cancels
- https://design.tutsplus.com/tutorials/10-things-you-should-know-about-the-crop-tool--psd-34592 — the six-entry overlay set

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
   from the Character panel, the layer's properties and the `Layer > Type` menu — the last of
   which is Adobe's own route, quoted in item 1. Where the data file mentions timing at all it
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
13. **Whether clearing the two Width and Height fields is what returns the crop to unconstrained.**
    The data file says so, on the strength of third-party walkthroughs describing the CLEAR
    button; Adobe's own table defines `Ratio` as "Crops freely without a fixed ratio" and does not
    describe the CLEAR button's effect. The two are consistent but they are not the same claim,
    and the "free" half of the old `Ratio (free)` gloss — which attached the behaviour to the
    item's _name_ — is what has been taken out. Closest:
    https://www.photoshopessentials.com/basics/how-to-crop-images-photoshop-cc
14. **Any runtime measurement.** No browser was executed and no test was run for this family.
    Every claim about the app's behaviour above is read off the source in this worktree, not
    observed at runtime.
