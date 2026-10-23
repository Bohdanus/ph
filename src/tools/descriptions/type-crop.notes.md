# Type and Crop — research notes

The `text` and `crop` family. Every Photoshop claim below traces to a URL in that tool's
`sources` array in `type-crop.ts`; anything that could not be sourced is in `## Unverified`
at the end and is deliberately absent from the data file.

The four corrections the research brief folds in do not touch this family, and the
corrections log in `01-photoshop-reference.md` §10 does not disprove anything here. One
corpus claim **is** corrected below — the crop preset list.

## What the interrupted pass changed, and what survived review

The pass before this one rewrote `type-crop.ts` (115 insertions, 62 deletions) and died
mid-write, leaving the module syntactically broken. It reported nothing, so every claim it
wrote was unverified when it arrived. Its edits were re-derived here rather than trusted, and
the tally is worth recording because the file is better for it and not worse:

**Kept, because this pass confirmed it against the working tree:**

- The **Text color** row from `missing` to `partial`, with `Text.tsx`'s text-colour `<input>` as
  its `appRef` at the time — **the same control now**, because the bar grew by five controls and
  every `appRef` in this table moved with them; see the re-derivation below. The
  colour control exists, is wired to the args, and reaches `ctx.fillStyle`; the foreground
  mirroring the previous pass described is gone. This reversed a false verdict rather than
  creating one.
- The **`commit: 'document-operation'` finding** for the crop, including the three refusals
  that make `src/tools/crop.ts`'s trim unreachable, and `COMMIT_DOCUMENT_EDIT` /
  `SET_DOCUMENT_FRAME_ACTION` / `previousFrame` as the real commit path.
- The **Enter and Esc crop bindings**, with the correction that they come from `CropToolArea`'s own
  raw `window` `keydown` effect rather than from `useKeyDownShortcut`. This file had
  concluded the opposite, and it was wrong.
- The **seven extra `shortcuts` rows** and the **`appRef` moves** (`useRect`'s handle hit-test →
  the `hideBlend` guard in `drawMask()`, the `Text.tsx` column shifted by a row). Every one of those
  anchors now resolves to the wiring it claims.
- The **`Font Style` appRef re-derivation** was right about the anchor and wrong about the
  verdict — see below. (That pass wrote a bare line number with no file beside it; the row it
  belonged to is the census's `Font Style` row, which now carries no `appRef` at all.)

**Corrected here:**

- `Font Style` went back from `partial` to `missing`: there is no style combo box in the app at
  all. The verdict-list bullet that still said `partial` was deleted rather than left to
  contradict the census — see the resolution in the census section below, which was written on a
  later pass.
- **The anti-aliasing version.** This file's heading said 27.x; the community report in the
  family says 26.10. The presets also still exist — only the bar control went.
- The **`appNotes` claim that Photoshop's auto-leading is 120 percent**, which no source in
  this file supports, is now "Photoshop's Leading defaults to Auto".
- The **three crop modifier rows** (Ctrl-alone → Straighten, Shift-rotate → 15°, Ctrl-rotate →
  no shrink) stay in the array but are filed as unverified, because `appNotes` was calling the
  same rows aspirational.

**Reversed again, later, on the clause this list says was removed for the right reason.** An
earlier pass removed the `Size` row's "0.01 to 1296 at 72 ppi" clause on the grounds
that `Unverified` item 2 said no Adobe page states a range. That reasoning was sound and its
conclusion was wrong: `CharacterStyle` **does** state the range, and the page carrying it was
already in `sources`. The clause is back, with the citation, and `Unverified` item 2 is kept
and headed **RESOLVED** rather than left reading as an open question — see that item, and the
`Size` bullet in the verdict list for the two
divergences that remain, which are the **unit** and the **presentation** and never were the
range.

**Left in place but flagged, not fixed:** four added `sources` URLs and three added verbatim
Adobe quotations that this pass did not open, including one this file had already recorded as
unverifiable and left unquoted. See `Unverified` item 20.

## Defensive input boundary

The live crop commit remains the document-frame operation described below. Its registered raster
processor is also defensive because old or hand-edited records can still reach a registry entry:
missing, non-finite and zero-area crop rectangles are treated as no-op copies instead of producing a
zero-sized bitmap or throwing while normalising the rectangle. The live document-frame commit
rejects non-finite edges before `sortRoundRect`, so an invalid record cannot publish a frame whose
size is `NaN`. Text creation follows the same platform boundary: an `OffscreenCanvas` with no 2D
context yields a blank canvas rather than an exception during replay or export. These are safety
guards, not Photoshop behaviour claims.

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

A third pass, the one this section's predecessor describes, re-resolved **every** `path:NNN`
in both files against the tree and re-read the commit and keyboard wiring end to end:
`src/contexts/useLayer.ts`, `src/contexts/history-replay.ts`,
`src/contexts/history-adapter.ts`, `src/contexts/materialization.ts`,
`src/components/Common/AppKeyboardShortcuts.tsx` and `src/util/settings.ts`. That pass is
also where the two questions the file did not answer were settled — the type layer's live-or-baked
status, and what a crop commit actually is — and both answers are below.

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
and `Shift+T` cycles the group. **The app has one entry for that four-tool group** (the type tile in `toolbar-mapping.ts`, a
single `{ label: 'Horizontal Type Tool', name: 'text' }`), and the record now says so in its
`appNotes`, because an entry that names Adobe's exact string
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
_set_ without an order; `03-ui-chrome-spec.md` §5 ("Options-bar contents per tool") gives an order
that omits the colour and the orientation toggle, so the order used here is the one above, and the
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
has the same shape: in `Text.tsx` the align `<select>`, then the B/I pair, then `Apply` and
`Clear` at the right end. The bar has since grown by five controls —
Tracking, All Caps, Small Caps, Underline and Strikethrough — which does not bear on Adobe's
order and is recorded in the census section instead.

### Options-bar control census

Twelve controls. `present` 1 · `partial` 4 · `inert` 0 · `missing` 7.

**Re-derived on this pass.** Every `appRef` below moved, because the bar grew by five controls
and every block below the font select shifted with it. The verdicts did not move with them:
**no control changed status**, and that is the finding rather than an absence of one. The
character formatting that arrived with this pass is **not** on Photoshop's type options bar at
all — tracking, the caps toggles and the two decorations are Character-panel controls, which
`formatting-characters.html` lists as one of four places characters can be formatted, and the
Character panel is a panel rather than a bar. Putting them in this table would file them under a
census whose contract is "every control Photoshop places in this tool's options bar, in bar
order", so they are documented in the Character and Paragraph panel table below instead, and
the app's placement of them on its own bar is recorded as an app-side divergence there.

| #   | Control                                   | Status    | `appRef`                                     |
| --- | ----------------------------------------- | --------- | -------------------------------------------- |
| 1   | Tool preset                               | `missing` | —                                            |
| 2   | Text Orientation (`T` + direction marker) | `missing` | —                                            |
| 3   | Font family                               | `partial` | `Text.tsx` — the `FontSelect` render         |
| 4   | Font Style                                | `missing` | —                                            |
| 5   | Size                                      | `partial` | `Text.tsx` — the `font-size-input` `<input>` |
| 6   | Text color                                | `partial` | `Text.tsx` — the `text-color` `<input>`      |
| 7   | Align Text Left / Center / Right          | `present` | `Text.tsx` — the `align-select` `<select>`   |
| 8   | Toggle the type on a path                 | `missing` | —                                            |
| 9   | Create Work Path                          | `missing` | —                                            |
| 10  | Warp Text                                 | `missing` | —                                            |
| 11  | Toggle the Character and Paragraph panels | `missing` | —                                            |
| 12  | Commit / Cancel                           | `partial` | `Text.tsx` — the `Apply` button              |

**`Font Style` is `missing`, and this file used to say both `partial` and `missing` about the same
row in two places two hundred lines apart.** Both sentences were correct about different objects,
which is what made them read as a contradiction. The verdict-list bullet said `partial` because
the B/I pair "stand[s] in for a style combo"; the census bullet below it said `missing` because
there is no style combo box anywhere in `ToolbarsRight/Text/`. The census reading is the one the
record uses, and the resolution is that a control's status describes **the control the row
names**, not the nearest thing the app happens to have: the row names a combo over the styles the
chosen family actually has, and the app renders two booleans, so the control is absent and the
booleans are not a citation for it. `partial` is right for no row here, and the `partial` bullet
is deleted rather than left to argue with the census.

**The B/I pair got closer to Photoshop on this pass anyway, and it is worth saying why that did
not move the verdict.** It used to be the app's _worst_ approximation of a style: the shorthand
built `${italic}${bold}${size}px ${family}`, which the CSS grammar rejects, so Chrome silently
kept the previous font and `64px bold Arial` and `64px italic Arial` rendered pixel-identically
to the serif fallback — the Bold and Italic buttons changed the **typeface** rather than the
weight. `fontShorthand` now emits `italic bold 64px Arial`, which the grammar accepts
(in `src/tools/text.ts`'s `fontShorthand()`), so the two buttons weight the glyphs. That is a real
fix to two buttons, and it is still not a Font Style control: a family-specific style, a faux-style choice
and a per-character style all remain unreachable, and a boolean cannot express "Semibold" any
more than it could before.

**Two of these twelve verdicts moved on this pass, and one of them reverses a row this file
previously called a false verdict.** Slot 6 is now `partial` where it was `missing`, because
the bar **does** render a colour control and did not used to — see the verdict list below.
Slot 4 is now `missing` where it was `partial`, because there is no Font Style combo box
anywhere in `ToolbarsRight/Text/`: the app's bar is Font (`FontSelect`), Font Size, Line
Height, Tracking, Color, Align, a B/I pair, an All Caps / Small Caps / Underline /
Strikethrough group and Apply/Clear. The `Text.tsx` Bold and Italic buttons are
the app's nearest analogue to Faux Bold and Faux Italic, and they reach the canvas
as CSS `bold` / `italic` prefixes rather than synthesized faces, so they are not the control
this row is about and the row carries no `appRef`. They now reach the canvas **correctly**,
which the same sentence could not have said when it was written — see the shorthand section
below — and it still does not make them a style control.

**The thirteenth control is gone, and what replaced it in the array is not a row.**
`Anti-Alias` sat at bar slot 6, between `Size` and `Text color`, while its own `detail` said
the control "is no longer on the type options bar" — a row that could not be in a bar-order
census and simultaneously say it was off the bar. The array's contract settles it, so the
row is out and the control is documented in the next section instead. Renumbering is the
only other consequence: nothing above slot 5 moved.

### Anti-aliasing: off the bar by 26.10 on a community report, and the five presets are intact

The control is real and still matters; it is simply not a bar control any more. The five
presets are **None, Sharp, Crisp, Strong, Smooth** — from the third-party mirror of the
Photoshop Scripting Reference, which is where the five `AntiAlias` static properties and
their one-line descriptions are stated
(`https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html`; Sharp renders type at
its sharpest, Crisp somewhat sharp, Strong heavier, Smooth smoother). **Sharp is the
default**, and it is still the default in the Character panel, which is where the presets went.

**Nothing was removed from Photoshop — only from the bar.** Every source reached this pass
agrees that the five values still exist and are still selectable: the Scripting Reference
still enumerates all five, and a Reddit thread on the disappearance names the routes that
replaced the bar's pull-down — `Type > Anti-Alias`, the Character panel, and the properties
for the text layer. A claim that the presets themselves were withdrawn is not supported and
is not made anywhere in the data file.

**Where it is reached from changed twice, and the file had the older of the two.** The
CC-era route is Adobe's own, in the CS-era help mirrored at
`http://www.underwaterphotography.com/photoshop/photoshop/1_16_3_4.html`: "**To apply
anti-aliasing to a type layer: Select the type layer… Choose an option from the anti-aliasing
menu in the options bar or the Character palette. Or, choose Layer > Type**." In current
versions those commands are a **top-level `Type` menu**, not a submenu of `Layer` — Adobe's
Warp Text page gives the current form of one of them, "select Type > Warp Text"
(`warp-and-unwarp-text.html`). The `Anti-Alias` row said "the Layer > Type menu" and the
same record's `purpose` said "the Type menu", so the file contradicted itself, and the
`purpose` is the one that is right. The row that carried the error is gone; the routes now
stand as: the **Character panel**, the **layer's properties**, and the **Type menu** — the
three the data file's `purpose` names.

**The version is 26.10 on a community report, and this file's own heading was wrong about
it.** The heading above used to read "off the bar in 27.x". Every piece of evidence in this
family puts it earlier: the Adobe Community bug report — which was already in the data
file's `sources` and is quoted at `Unverified` item 3 — is dated **August 2025** and says the
pull-down "is gone since Photoshop **26.10**", and the corroborating Reddit thread is from the
same removal. 26.10 is a 2025 point release of Photoshop 2025; 27.x did not exist when the
report was filed. So "27.x" was wrong twice over, and it was wrong in the heading rather than
only in a place already hedged.

**What the data file now says, and what it deliberately does not.** `purpose` states that the
pull-down "is no longer on the type options bar", that the presets are unchanged and reachable
from the Character panel, the layer's properties and the Type menu, and that the timing is
community-reported — naming 26.10 as the report's claim while not asserting it. It also
records one thing this pass read off Adobe's live help: `formatting-characters.html` still
lists **four** places characters can be formatted — the Character panel, the Type tool
options bar, the Properties panel and the Contextual Task Bar — without naming anti-aliasing
among them. That is the reason a reader of Adobe's own page would still expect the control on
the bar. No version number is asserted as fact anywhere; see `Unverified` item 3.

**Every `appRef` in this table was re-derived from the control's meaning, not from the number
the previous pass wrote.** All eight of the old numbers were off by a small amount, and all
eight pointed at a wrapper rather than at the control: at the empty `<div>` the font
select sits in rather than the select, at the `<div>` opening the bold/italic pair
rather than a button, at the block wrapper above the size slider rather than the
`input`, at the wrapper above the align control rather than the `<select>`, at the
button-row opener rather than `Apply`, and in the crop family the same three shapes —
in `Crop.tsx` at the `aspectRatios` data array rather than the rendered `<select>`, at
the button-row opener rather than `Apply`, and in `useRect` at a bare
`case 'inside':` label rather than the statements that translate the rect. A `file:line` is
followed by an agent, so a line that lands one line early is a wrong answer dressed as a
right one, and the test that checks these citations deliberately validates the path and the
bound only (the `REF_PATTERN` comment in
`scripts/__tests__/tool-descriptions.test.mjs` says so in its own comment), so nothing but
re-derivation catches it.

**Every `implementationRefs` entry was re-opened for the same reason, and four were wrong in
the way a bound check cannot see: each landed on the _previous_ entry's closing line.**
`settings.ts` was `resizeX: 100,` inside the TRANSFORM block, and the crop seed is its own
`crop` entry; it was also `color: '#000000',` inside the SHAPE block, and the text seed is
its own `text` entry. `toolProcessors.ts` was the `},` that closes the transform processor,
and the crop entry is the `crop` entry; it was also the `shape` processor, and the text entry
is the `text` entry. Every other entry was opened and confirmed to be what its record claims —
`crop.ts`'s crop creator, `rect.ts`'s `trimRect()`, `useRect`'s `hideBlend` guard in front of the
fixed 0.7 fill, `layer-renderer.ts`'s six-name `vectorToolNames` set, `toolbar-mapping.ts`'s single
crop tile and its single type tile.

**The numbers in the two paragraphs above are themselves history: they describe the pass
before this one, and the lines have moved again.** Every `path:NNN` in both files was
re-resolved against this worktree on this pass, and the current anchors are the ones in the
census tables above and in `type-crop.ts`. Where they moved, and by how much:

| Anchor before the move                                                   | Anchor now                                                                      | What moved                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------ |
| the text tile before a closing `],`                                      | the `toolbar-mapping.ts` type tile                                              | it sits after that closing `],`            |
| the `Text.tsx` textarea, font block, size block, align block and `Apply` | the same five controls in `Text.tsx`, each re-cited by unit                     | all again                                  |
| `useRect`'s handle hit-test                                              | the `hideBlend` guard in `useRect`'s `drawMask()`, with the fixed fill under it | `drawMask` grew                            |
| an older spot in `useLayer.ts`                                           | `commitDirtyTool`'s `toolName === 'text'` arm                                   | the `toolName === 'text'` branch           |
| `CropToolArea`'s pre-listener anchor                                     | `CropToolArea`'s `useRect()` call                                               | the `useRect` call, after the key listener |

The text `implementationRefs` are correct as they stand, and so is `Text.tsx`'s `applyText`,
which is the right function for the commit row. **The crop's no longer are, and the
table above is the reason this paragraph cannot simply say they still are.** Extending the crop
moved nine of them: the commit path left its old `useLayer.ts` anchor for `applyDocumentCrop()`,
`CropToolArea`'s `applyDocumentCrop` call and its `useRect()` call both moved, all four of the
crop's `useRect` anchors moved, `rect.ts`'s clamped `trimRect()` gave way to the unclamped
`sortRoundRect()` normaliser it replaced, and the frame-size cap is a new citation on
`useLayer.ts`'s `MAX_DOCUMENT_FRAME_SIDE`. `toolProcessors.ts`'s `crop` entry, `Crop.tsx`'s
aspect-ratio `<select>`, `settings.ts`'s `crop` seed, `util/settings.ts`'s `crop` arm of
`saveLastSettings()` and `toolbar-mapping.ts`'s crop tile did not move. Every one of the new
anchors was opened and confirmed to be the thing it claims; a bound check cannot catch a wrong line, which is
the failure `crop.ts` shipped twice before.

Why each verdict:

- **Font family — `partial`,** not `present`. `FontSelect` renders and writes through
  `handleFontFamilyChange` to the args, and the canvas honours it, so the control is real. But
  the `FONTS` array in `src/components/ToolbarsRight/Text/FontSelect.tsx` is a hard-coded array of
  fourteen families, not an enumeration of what the platform has, and Photoshop renders the list
  in each face.
- **Size — `partial`,** and the two ways it diverges are now **unit** and **presentation**, not
  range. The control is a number field over `0.01 … 1296`, which is Adobe's `CharacterStyle.size`
  bound (see `Unverified` item 2, now resolved), so the range matches and the verdict stays
  `partial` for the other half: Photoshop's default unit is **points** with a unit suffix
  (`pt`/`px`/`mm`/`in`/`pica`) and the app's is CSS px, because the canvas carries no document
  resolution and a point has no denominator here. It is a number field rather than a slider
  because a range input over a 1296-wide span puts one point in about a hundredth of a pixel of
  track, so a slider cannot reach the top of the range Adobe documents; the entry handler clamps
  rather than only marking the field invalid, which is the same rule applied one layer down.
- **Text color — `partial`, and this verdict reversed the one this file called the row's one
  false verdict.** The previous pass wrote that `Text.tsx` "renders **no colour control at
  all**" and that it copied the store's foreground into the args one-way, citing a range at the
  very head of `Text.tsx`'s `Text` component that is empty in this tree. That was true when it was
  written and is **false here**:
  `Text.tsx` renders `<input id="text-color" type="color">`, `handleColorChange`
  writes it into the args, and `renderText` consumes it as `ctx.fillStyle`
  (in `src/tools/text.ts`'s `renderText()`). The foreground mirroring it described is gone, and both
  the component comment above `handleColorChange` and the args type comment above `TextToolArgs`
  say so in as many words — the latter names the exact change: `color` "used to be omitted
  because the bar mirrored the store's foreground into the args on every render". So `missing`
  was the second kind of false verdict: a control that is on screen and wired, understated.
  What is genuinely still absent is narrower and is what `partial` is for: Photoshop's Color
  Picker rather than the platform's, the `Alt+Backspace` / `Ctrl+Backspace` foreground and
  background bindings (there is no `alt` registration anywhere in
  `AppKeyboardShortcuts.tsx` — `matchesShortcut()` in `useKeyboardEvents.tsx` is only the matcher),
  per-character scoping, and Photoshop's default of seeding the type colour from the foreground swatch,
  where the app's seed is a fixed `color: '#000000'` in the `text` block of
  `src/tools/settings.ts`.
- **Font Style — `missing`,** and the verdict-list bullet that said `partial` on this pass is
  deleted rather than left to contradict the census. The reason both sentences existed is that
  they were about different objects; see the resolution in the census section above. Short form:
  the row names a style combo, the app has two booleans, and a status describes the control the
  row names.
- **Align — `present`.** A `<select>` rather than three icon buttons, but the same three
  values, the same default (left), and the same effect. The Justify variants are not on the
  bar in Photoshop either. Note that this pass changed _how_ it reaches the args, not what it
  does: alignment now goes through `publishStyle` rather than `onChange` directly, because
  `calculateNewRect` has an alignment arm that re-places a **point** box the text outgrew, so a
  box moved by Left and then switched to Right is one the next measurement would move again.
  **That arm is point-type only as of the text wave** (`calculateNewRect()`'s point-box arm in
  `src/util/rect.ts`): a paragraph
  box is neither grown nor re-placed, because its width is the width the user dragged, so for
  that kind the `publishStyle` route is now a no-op rather than a guard.
- **Commit / Cancel — `partial`.** The `Apply` and `Clear` buttons in `Text.tsx` do what the
  check mark and the cross do, and the draft is also committed implicitly when the tool
  changes (`goToTool()` calls `commitDirtyTool()` in `src/hooks/useApp.ts`, whose text branch is
  the `toolName === 'text'` arm inside `commitDirtyTool()` in `src/contexts/useLayer.ts`). There is
  no keyboard commit and no Escape. The app's pair is also not edit-mode-only the way Adobe's is:
  it is always rendered, merely disabled while `text` or `rect` is empty.

**There is no `inert` control in this family, and that was checked rather than assumed.**
`TextToolSettings` is `Omit<TextToolArgs, 'text' | 'rect' | 'kind'>`
(`TextToolSettings` in `src/tools/text.ts`), so the persisted surface is **thirteen** keys,
counted off the type rather than off this prose: the eight the previous count named — `align`, `bold`, `color`,
`fontFamily`, `fontSize`, `italic`, `lineHeight` and the tool name — plus the five that arrived
with this pass, `allCaps`, `smallCaps`, `strikethrough`, `tracking` and `underline`. **Eight
became thirteen, and the growth is exactly five.** (A brief for this pass said fourteen; the type
says thirteen, and thirteen is what is written down.) `kind` was later added to the `Omit` list
rather than to the count: it is a per-draft decision made by the gesture, so it is deliberately
not remembered, and `saveLastSettings` strips it alongside `text` and `rect`
(in its `toolName === 'text'` arm in `src/util/settings.ts`). Every persisted key is rendered by
`Text.tsx` and reaches `renderText` through `resolveTextStyle()`, the single place a field missing
from an older persisted record becomes a value; `kind` has the same seam one level up,
`resolveTextKind()`, for the same reason. That seam is also why the five arrived **optional**: `saveLastSettings` persists the record verbatim
so a settings object written
before a field existed has to keep loading, and a `??` missed at one of the call sites produces a
`NaN` line coordinate rather than a visible default.

**The app puts five Character-panel controls on its options bar, which is itself a divergence
and is why the table above did not grow.** Photoshop reaches tracking, both caps toggles, the two
decorations and the style synthesis through the **Character panel** — Adobe lists the Character
panel first among the four places characters can be formatted — and the type options bar holds the
family, the style, the size, the anti-aliasing choice and the colour. The app has no Character
panel and no panel toggle for one, so it renders those five on the bar instead. That is a
placement divergence, not a census entry: `options[]` is contractually the bar's own controls, so
filing them there would describe a bar Adobe does not ship. The verdicts live in the next table.

The `inert` trap this family is usually suspected of is real but sits one level down: all
thirteen are perfectly good state that only ever reaches the screen through a raster produced
once, by the `text` creator in `src/tools/text.ts`, and is then scaled rather than re-rendered.

### Character and Paragraph panel controls

Not part of the options-bar census above, but the other half of Photoshop's type surface and
requested explicitly. **Six are `missing` and six are `partial`** — Leading was already
`partial`; what changed is that Tracking stopped being absent, and that four controls this
file previously did not enumerate now exist in the app. The app has no Character panel and no
Paragraph panel; the one control the app has that overlaps the first row, line height, is
semantically different from Photoshop's leading.

**Five of these live in the app's options bar rather than in a panel**, which is the divergence
the census section above declines to record. Tracking, All Caps, Small Caps, Underline and
Strikethrough are all rendered by `Text.tsx` — its tracking slider, its All Caps, Small Caps,
Underline and Strikethrough buttons — because the app has no panel to put them in. That is a placement difference and not a capability one, and it is why a reader of the
census above and of this table sees twelve bar controls and twelve panel controls of which five
are in both places.

| Control                                                                     | Photoshop                                                                                                                         | App                                                                                           | Status                                                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Leading                                                                     | absolute baseline-to-baseline distance in points; per-line, largest value in a line wins                                          | unitless multiplier of the font size, 0.5–2.25, applied as `index * fontSize * lineHeight`    | `partial` — `Text.tsx`'s line-height `<input>`; default now `AUTO_LEADING`                              |
| Tracking                                                                    | loose/tight in 1/1000 em, cumulative with manual kerning                                                                          | slider over −1000…1000 in 1/1000 em, applied as `ctx.letterSpacing`                           | `partial` — `Text.tsx`'s tracking slider                                                                |
| All Caps                                                                    | every character rendered as a capital                                                                                             | `ctx.fontVariantCaps = 'all-small-caps'`                                                      | `partial` — `Text.tsx`'s All Caps button                                                                |
| Small Caps                                                                  | synthesises where the font has none — "if the font does not include small caps, Photoshop generates faux small caps"              | `ctx.fontVariantCaps = 'small-caps'`; Chrome synthesises                                      | `partial` — `Text.tsx`'s Small Caps button                                                              |
| Underline                                                                   | drawn in the type colour; `Underline` is `NONE / LEFTINVERTICAL / RIGHTINVERTICAL`, no style, weight, offset or colour of its own | a rule in the type colour, 0.1em below the baseline, thickness `max(1, round(fontSize / 16))` | `partial` — `Text.tsx`'s Underline button; **the offset and the thickness are this app's, not Adobe's** |
| Strikethrough                                                               | drawn in the type colour                                                                                                          | a rule at half the rendered x-height, in the type colour                                      | `partial` — `Text.tsx`'s Strikethrough button                                                           |
| Kerning                                                                     | None / Metrics / Optical / manual, cumulative with tracking                                                                       | —                                                                                             | `missing`                                                                                               |
| Baseline shift                                                              | points, positive up                                                                                                               | —                                                                                             | `missing`                                                                                               |
| OpenType                                                                    | per-feature toggles                                                                                                               | —                                                                                             | `missing`                                                                                               |
| Indents (left / right / first line)                                         | paragraph type only                                                                                                               | —                                                                                             | `missing`                                                                                               |
| Hyphenation                                                                 | paragraph type only                                                                                                               | —                                                                                             | `missing`                                                                                               |
| Justification (Justify Last L/C/R, Justify All) + word/letter/glyph spacing | paragraph type only                                                                                                               | —                                                                                             | `missing`                                                                                               |

**Leading's verdict did not move, and the reason is the whole of it.** The default is now
`AUTO_LEADING = 1.2` (the `AUTO_LEADING` constant in `src/tools/text.ts`), which is Adobe's
figure — `JustificationProperties.autoLeadingAmount` defaults to `120`, "Percentage of type size to use for
auto leading", configured in the Paragraph panel's flyout under _Justification…_ and not in
Preferences — so the number this app draws with now matches Photoshop's default. The row stays
`partial` because **the unit is still a ratio**: Photoshop's leading is an absolute
baseline-to-baseline distance in points, per-line, where the largest value in a line wins, and
this app has one ratio for the whole box with no per-line override. A reconstruction of a
default is not a change of kind, and `AUTO_LEADING` reproducing 120% narrows the divergence
without closing it. The old "defaults to 1.1" clause is gone; nothing in either file claims
Photoshop's leading is 110% or 120% as a _hard_ default, because Auto is the default and 120% is
what Auto computes.

**Tracking is `partial` rather than `present` for two reasons, both about degradation.** The
range, the unit and the sign all match Adobe — `CharacterStyle.tracking` is −1000…1000 and
"Tracking and kerning are both measured in 1/1000 em… 100 tracking units in a 10-point font are
equivalent to 1 point" — and the readout on the bar is in Adobe's unit with no rescaling on the
way out; `trackingPx()` is the one place that converts to px. The first divergence is that Adobe's
tracking is **cumulative with manual kerning**, and the app has no
manual kerning to be cumulative with, so half the control is gone. The second is the fallback:
where `ctx.letterSpacing` exists the whole line goes down in one `fillText` and the shaper
handles it, and where it does not the app places each grapheme cluster itself — which drops
kerning and any ligature the font would have formed across the boundary, measured at 11.875px
wider than the kerned total on 'WAVE AV' at 64px. The fallback is feature-detected by
`hasLetterSpacing()` rather than by deleting the prototype property, which reports success on
Chrome 154 and leaves it working.

**Underline is `partial` and two of its numbers are this app's own.** Adobe's only rule is that
the line "is always the same color as the type color", and its `Underline` enum has no style,
weight, offset or colour of its own — the Underline Options dialog with an offset control is
InDesign's and InCopy's, not Photoshop's. So where the rule sits is a **reconstruction**: 0.1em
below the baseline (`UNDERLINE_BELOW_BASELINE_EM`, which no Adobe page states), and the thickness
`max(1, round(fontSize / 16))` (from `decorationThickness()`), which Adobe does not document at
all. The row records the control as `partial` because the drawn
thing exists, is in the right colour, and is switchable — and neither figure is claimed as
Adobe's. Strikethrough is `partial` on the same grounds without the offset problem: half the
measured x-height is where a strikethrough goes, and Adobe documents neither the position nor
the thickness there either.

**Caps needed the font assigned first, which is the kind of thing that silently eats a control.**
`ctx.fontVariantCaps` is assigned **after** `ctx.font` (in `applyTextStyle()`) because
assigning the font resets `fontVariantCaps` to `'normal'` on Chrome 154 — `letterSpacing`,
`wordSpacing` and `fontKerning` survive a font assignment and `fontVariantCaps` does not, so a
caps toggle set before the font is lost on every redraw. The same ordering reason is why the
options bar routes the caps toggles through `publishStyle` rather than calling `onChange`
directly: All Caps and Small Caps change every character's advance, so both the drawing and the
box measurement have to move together or the box is one metric out of date.

### Is the app's type layer live text or baked pixels?

**Baked pixels on the runtime path — with one durable-path exception that has to be stated,
because "the app's type layer is baked pixels" is otherwise only half true.** The chain,
re-derived in this worktree:

1. `src/tools/text.ts` — `renderText()` calls `ctx.fillText` per laid-out line onto a 2D
   context. There is no glyph outline, no font engine, and no retained text object anywhere in
   the module; the line breaks come from `layoutText()`, which splits on `\n` and wraps a
   paragraph box at spaces, and that is a string operation rather than a text engine.
2. `src/tools/text.ts` — the `text` creator allocates an `OffscreenCanvas`, calls
   `renderText` onto it and returns `[canvas]`. A creator tool's return value is a raster.
3. `src/tools/toolProcessors.ts` — the `text` processor entry is `commit: 'source'`,
   `creator: true`, so the layer source is that raster. (The whole block is the right anchor; a
   single line is a bad one here, because the one-line `shape` processor sits immediately above it
   and `'polygonal-lasso'` immediately below.)
4. `src/contexts/layer-renderer.ts` — `vectorToolNames` is a `Set` of **six** tool names:
   `shape`, `rectangle`, `ellipse`, `triangle`, `polygon`, `line`. `text` is not in it, so
   `isVectorSource` is false for a text layer and `getLayerBitmap()` returns `layer.bitmap`
   instead of re-running the creator.
5. `src/contexts/presentation-evaluator.ts` — `drawEvaluatedPresentation()` blits that bitmap
   with `ctx.drawImage(bitmap, x, y, evaluation.sourceSize.width, evaluation.sourceSize.height)`, so
   enlarging a text layer resamples it. `drawLayerSource()` reaches it through
   `drawEvaluatedPresentation` (that is the call `drawLayerSource` makes in
   `layer-renderer.ts`); the affine branch inside
   `drawEvaluatedPresentation()` is the one a transformed layer takes instead, and it
   scales to the same `sourceSize`.
6. `src/contexts/materialization.ts` — `sourceBitmap()`, **the exception.** The durable
   materializer re-runs `processor.imageProcessor` from the retained args, so on that path the
   characters are re-derivable rather than only resampled. `AGENTS.md` is explicit that the legacy
   `HistoryItem[]` path is the production replay authority and the durable document is a
   shadow projection, so the runtime path above is what a user sees.

The layer _does_ retain its `TextToolArgs` (`ToolLayerSource.args` in
`src/contexts/layer-types.ts`, populated by `createLayerFromTool()` in `src/contexts/useLayer.ts`),
so the information needed to re-render survives; on the runtime path nothing reads it. Every consumer
of the composited document — the visible canvas, undo replay, and the PSD writer in
`src/contexts/psd-utils.ts`, which calls the same `drawLayerSource()` — goes through
`getLayerBitmap`, so the raster is what is shown, replayed and exported.

The practical consequence: a text layer scaled up in the app is a resampled bitmap, where a
Photoshop type layer re-renders from the font at the new size and stays crisp.

### The font shorthand was wrong, and it changed the typeface

**This is the defect on this pass that a status table cannot express, so it gets its own
section.** `fontShorthand` built `` `${italic}${bold}${size}px ${family}` `` — `64px bold Arial`
— and the CSS grammar rejects that: `font-style` and `font-weight` come **before** the size, and
a weight after it is rejected too. Chrome does not throw on a rejected `ctx.font`; it silently
keeps the previous font. Measured on this host, `64px bold Arial` and `64px italic Arial` render
pixel-identically to the serif fallback, so **the Bold and Italic buttons changed the typeface
instead of weighting it** — the two most visible controls on the bar did the opposite of what
they said. It is now `` `${italic} ${bold} ${size}px ${family}` `` — `italic bold 64px Arial`
(in `src/tools/text.ts`'s `fontShorthand()`).

**Both renderers build it, not one, and the previous version of this file named only one.**
`applyTextStyle()` is reached from `renderText()` **and** from `getTextWidth()` in
`src/tools/text.ts`, so the shorthand is built on the drawing path and on the measurement path, and
the options bar's `calculateNewRect` measures through the second one — and since the text wave,
through a third reader, `getTextLineCount()`, which is what sizes a paragraph box and is reached on
every keystroke. A fix applied to `renderText`
alone would have left the box measured against a font the drawing never used — which is the
one-metric-out-of-date failure `publishStyle` in `Text.tsx` exists to prevent.

**The baseline moved, because `'top'` is a metric no API exposes.** `textBaseline` was `'top'`,
which is a font-dependent constant: measured across fourteen families at 64px the offset runs
0.762695em (Times New Roman) to 0.875977em (Impact), with Arial at 0.781250em and the generic
families at exactly 0.75em. Every decoration this tool draws relative to a baseline — the
underline, the strikethrough — needs a baseline it can name, and `'top'` is not one. It is now
`'alphabetic'` with the baseline placed at
`rect.y1 + TEXT_PADDING + fontBoundingBoxAscent + index * fontSize * lineHeight`
(`baselineOffset()`, with a 0.8em fallback for a context whose `measureText` reports no
ascent — the test harnesses model `measureText` as `{ width }` alone, and a real `undefined`
there puts every baseline at `NaN`). `textAlign` is `'start'` for the same reason: the anchor is
computed from the measured **ink** width, so the box and the glyphs cannot disagree.

**Ink width is not advance width, and the difference is exactly one tracking gap.** Chrome's
`letterSpacing` adds the spacing to every character's advance _including the last_, so
`measureText('H').width` at 10px of tracking is 10px wider than untracked Arial even though one
glyph has no gap in front of it — the advance grows by `n * spacing` for n = 1…10 while the ink
grows by `(n - 1) * spacing`. Every number that positions something relative to a line uses
`inkWidth()`, and `getTextWidth` uses it too, or the box grows by a gap the text never
fills. At zero tracking `inkWidth` short-circuits to `ctx.measureText(line).width`, because the
fallback measures a string one cluster at a time and there is no reason to throw away kerning
when there is no spacing to place by hand.

### Three more app divergences worth stating

**The first of the three below was false in the version this section replaced.** It opened "No
text box, and therefore no wrapping … `calculateNewRect` measures the widest line and _grows_ the
rect to fit it … A line longer than the canvas is clipped at the canvas edge rather than wrapped",
and a Text tool wave since made a paragraph box real. The bullets are rewritten against the tree
rather than deleted, because the point half of the sentence is still exactly true.

- **A paragraph box now constrains the layout; a point box still does not.**
  `TextToolArgs` carries `kind?: 'point' | 'paragraph'` — the `kind` field on `TextToolArgs`,
  typed by the `TextKind` alias in `src/tools/text.ts` — resolved in
  exactly one place, `resolveTextKind()`, which makes `point` the default
  for a record written before the field existed — the only defensible default, because a build
  that grew its box to the widest line drew point type by Adobe's own definition and resolving
  it as `paragraph` would re-flow every existing document at load. `calculateNewRect()` in
  `src/util/rect.ts` then forks: for a paragraph box it clamps the dragged rect to the
  document **before** anything is measured (its `trimRect2()` clamp, so the preview and the
  committed box wrap at the same width), lays the text out against `textWrapWidth` and derives
  **only the height** (its paragraph arm), so the box grows downward and its width is never grown
  or re-placed; for a point box it measures the widest line and grows or re-centres the width around
  the placement click (its point-box arm) and the height (its post-layout
  height step), which is what that kind of box is for. The older anchors in this section are the
  point-type arms and they moved with the fork. `layoutText()` is the single layout authority and
  `wrapLine()` the breaker under it, and `renderText` draws what they return, so the box and the ink
  cannot disagree — which is what lets the durable materializer re-run the creator and still land
  the same lines.

- **A click and a drag are distinguished, and the threshold is this app's.**
  `TextToolArea`'s `useRect` `onChangeEnd` handler reads the rect the hook hands it: a press that
  travelled no more than `POINT_TYPE_MAX_DRAG_PX` (3 px) on **either** axis is a click, collapses
  the rect to the press point and places point type; anything further is a drag and places
  paragraph type (the `kind` decision immediately below that test). **The shared `useRect` hook
  still has no movement threshold of its own and did not gain one** — the hook is also the crop's, the move's and every
  selection tool's, so the threshold belongs to the tool that needs it, applied to the rect the
  hook hands over. Adobe distinguishes the two gestures by intent and **documents no threshold,
  no minimum box size and nothing about which way a box grows**, so the 3 px, the both-axis
  measurement and the downward growth are all this app's decisions; see `Unverified` item 21.
  `kind` is omitted from `TextToolSettings` on purpose: it belongs to
  the gesture, so a remembered paragraph would wrap the next draft inside the last layer's box
  before the user has dragged anything.

- **Content is typed in the panel.** The string still comes from a `<textarea>` in the
  right-hand panel, and a canvas drag now does more than size the box
  — it decides which kind of layer the text becomes, which is what makes the wrap a wrap. There
  is still no caret, no insertion point, no selection and no per-character formatting.

**The overflow indicator is Adobe's; its size, its corner and its colour are not.** Adobe
describes the whole thing in one clause — "a small box or circle containing a plus symbol (+)
appears in place of a handle in the corner of the boundary"
(`https://helpx.adobe.com/photoshop/using/creating-type.html`) — and states neither the size nor
the corner, so `OVERFLOW_INDICATOR_PX = 8` in the bottom-right (`src/tools/text.ts`) is a
reconstruction, as is the type colour it is stroked in. It is also **box chrome rather than ink**,
which is why `renderText` takes it as an option and only the draft
overlay asks for it (that is the one `renderText` call in `TextToolArea`'s `redrawText()`, and it
passes the option): the creator's canvas _is_ the box, so every line
fits it by construction and a baked icon would paint into the image, where Photoshop has no such
thing.

**Wrapping is greedy at spaces, and a word too wide for the box overflows rather than breaking.**
That is Adobe's outcome for a family with hyphenation off, and the in-tree comment quotes Adobe
for the same outcome from the other end — converting paragraph type to point type deletes "all
characters that overflow the bounding box" (in the doc comment above `wrapLine()` in
`src/tools/text.ts`) — but it names no page
for that sentence, and the _reason_ on this side, `ParagraphStyle.hyphenation` defaulting to
false, was not re-opened either. Both are filed as `Unverified` item 22 rather than asserted. What the tree does
is fixed and measurable: `wrapLine` breaks only on `' '`, treats a no-break space as a
non-opportunity by code point (metrics cannot tell them apart), trims a trailing space before the
fit test, and emits an unfittable token alone; `layoutText` takes an **infinite** wrap width for
point type, which reduces it to a split on hard breaks — byte-for-byte what point type always
did. The composer is greedy first-fit and nothing in Adobe's documentation describes it.

### Which Photoshop type keys the app actually binds

**`T`, and only `T`.** The complete key table is
`src/components/Common/AppKeyboardShortcuts.tsx` — its `useKeyDownShortcut` registrations cover
`z`, `y`, `c`, `v`, `i`, `j`, `b`, `u`, `t`, `l`, `w`, `g`, `o`, `e`, `s`, `m`, `p`, `d` and their
shift/mod variants — plus four `Escape`/`Enter`/`Backspace`/`Delete` registrations in each of
the two lasso tool areas (`PolygonClickToolArea` and `FeatherMagneticLassoToolArea`) and one
`Escape` registration in `FontSelect`'s font popup. Those are every call site of that hook in
`src/`; the raw `onKeyDown`
handlers elsewhere (the transform box, the two dialogs, the sidebar's own fields) are not in it
— and for the crop one of those raw handlers is the point, so see the crop section below before
concluding anything from this list. Nothing else in `src/` calls `useKeyDownShortcut`. The four
Photoshop rows the previous pass carried were all unbound, and two of them contradicted a
sentence already in the same file:

- `Shift+T` "cycle the type tools in the flyout group" — the type tile in `toolbar-mapping.ts` is a
  **single entry**, and the `t` registration in `AppKeyboardShortcuts.tsx` passes no `shift`,
  so `Shift+T` simply re-selects the same tool. The
  file says so in the comment above its single-tool registrations: "there is nothing to cycle, so a
  `shift: true` twin would select the same tool twice". The data file now carries that as a
  `shortcuts` row rather than only as an omission.
- `Ctrl+Enter` / `⌘+Return`, `Enter` and `Esc` — no registration anywhere. `Enter` inside the
  focused textarea takes the textarea's own newline, and the only `Escape` handler the type
  tool would have had is inside the commented-out `handleKeyDown`
  in `TextToolArea`.

One nuance the data file now states and this pass verified: `T` itself is only live when the
textarea does **not** hold focus. `TextToolArea` focuses it as soon as the tool is
selected, and `useKeyboardEvents`' `handleKeyDown` refuses any registration that has not opted
into inputs while a field is focused — so a `T` pressed mid-edit types a letter.

### Sources

Adobe official help:

- https://helpx.adobe.com/photoshop/using/creating-type.html
- https://helpx.adobe.com/photoshop/using/editing-text.html
- https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html
- https://helpx.adobe.com/photoshop/using/formatting-characters.html
- https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html
- https://helpx.adobe.com/photoshop/using/line-character-spacing.html — the tracking unit,
  "Tracking and kerning are both measured in 1/1000 em… 100 tracking units in a 10-point font
  are equivalent to 1 point"
- https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html
- https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html
- https://helpx.adobe.com/photoshop/using/layers.html
- https://helpx.adobe.com/photoshop/desktop/text-typography/get-started-with-text/setup-paragraph-formatting.html —
  added on this pass and reached through the live crawler: Adobe's own current sentence for the
  point/paragraph distinction in paragraph settings, "You can align and justify only paragraph
  text. To manage spacing for point text, convert it to paragraph text by selecting Type >
  Convert to Paragraph Text", and its enumeration of the four justify icons (Justify last left,
  centered, right and all). It is a locale address (`/ee/`) of the current desktop help tree,
  which is how the crawler reached it.
- https://helpx.adobe.com/ph_fil/photoshop/how-to/add-text-to-image.html — added on this pass,
  Adobe help and reached through the live crawler: the click/drag distinction in Adobe's own
  words, "Click on the canvas and enter a single line of text. You can also create a paragraph of
  text by dragging out a text box and then typing inside the box." It is a locale address
  (`/ph_fil/`) and a how-to page rather than the reference tree; the reference page for this
  gesture, `…/get-started-with-text/add-text.html`, was cited by
  the doc comment above `POINT_TYPE_MAX_DRAG_PX` in `src/tools/text.ts` and **did not surface
  through the crawler**, so it is not in `sources`.
- https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle — the size
  bound (`0.01 .. 1296`, "The font size in pixels for a 72ppi document") and the tracking bound
  (`-1000 .. 1000`)
- https://developer.adobe.com/photoshop/uxp/2022/ps_reference/objects/options/justificationproperties/ —
  `autoLeadingAmount` defaults to `120`, "Percentage of type size to use for auto leading",
  configured in the Paragraph panel's flyout under _Justification…_
- https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants — the `Underline`
  enum, `NONE / LEFTINVERTICAL / RIGHTINVERTICAL`, with no style, weight, offset or colour of its
  own
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

The tracked acceptance contract for crop re-entry, retained pixels, resize rendering, and viewport
zoom is [`docs/CROP-UX.md`](../../../docs/CROP-UX.md). This research section supplies Adobe behavior
and source provenance; the app-specific requirements are called out separately in that contract.

### What the tool is

A crop is a **pending, non-destructive framing**. Selecting the Crop tool shows a crop box
over the photo. It is drawn by dragging, resized by its corner and edge handles, and rotated
by dragging just outside a corner. Adobe's own sentence for that last one, and the whole of
Adobe's text on it: "**Place the pointer a little outside the corner handles and drag to
rotate the image. A grid displays inside the crop box and the image rotates behind it.**"
(`crop-straighten-photos.html`.)

**Adobe's inside-drag instructions conflict across pages and versions.** The current desktop
Crop photos page (last updated 2026-02-23) says to drag inside to move the crop box. Adobe's
2024 Crop tool page and 2020 tutorial instead say an inside drag repositions the image. The
current Crop tool options page also lists **Use Classic Mode** as reverting to legacy behavior,
but Adobe does not explicitly map those specific page instructions to that mode. This section
and the app contract follow the current desktop page: the app's inside drag moves the pending
crop box while leaving layer pixels fixed. Preserve the source-version conflict in future
research; do not describe the older instruction as the current default. The other regions are
consistent: edge and corner handles resize, and dragging just outside a corner rotates.
Sources: `crop-photos.html` (2026-02-23), `tool-techniques/crop-tool.html` (2024-04-29),
`image-resizing-basics.html` (2020-01-13), and `crop-tool-options.html` (2026-02-23).

The current desktop page says Enter/Return or **Done** applies the crop; Adobe's 2020 tutorial
demonstrates the check mark in the options bar. Adobe's current keyboard shortcut reference labels
Crop tool + Enter/Esc as **“Accept cropping or exit cropping”** without further defining “exit”.
In this app, **Esc cancels** and restores the previous framing, as pinned by the crop-history E2E.
The crop variants are Straight Crop (the default mode of the tool) and
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
   _new document_ preset; the app already has it, as the `us-letter` entry of
   `PRESETS` in `src/constants/imagePresets.ts`, where it belongs. A user who wants a paper size in a crop makes one through **New
   Crop Preset…**, which is the last row of Adobe's own table.
2. **There are no per-preset orientation variants.** Photoshop has a **Swap Width and Height
   values** button next to the menu, which flips the active ratio, rather than a doubled list
   of portrait and landscape entries. The app instead ships both orientations as separate
   entries (`9:16` beside `16:9`, `3:4` beside `4:3`) — a different design, not a missing half
   of one.

The entry is named **Ratio**, not "Free". `01-photoshop-reference.md` §6.2 has the right
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

**What is Adobe's.** Adobe's crop-options page says Delete Cropped Pixels "**permanently removes
areas outside the crop, but allows editing when turned off**". Adobe's current desktop
non-destructive editing page adds the recovery details: with the option unchecked, hidden areas
remain available and can be restored with **`Image ▸ Reveal All`** or by dragging the Crop tool
beyond the image edge. That page also notes the option is unavailable for documents containing
only a Background layer. Those are now primary-source claims in the data row, not third-party
inferences.

**What remains third-party.** The on-by-default state, demoting a locked Background layer to keep
hidden pixels, and the resulting file growth still have no Adobe source in this research set. They
remain labeled as third-party rather than being inferred from the recovery workflow. In particular,
Adobe says the unchecked option is unavailable for a Background-only document; it does not document
a demotion as the mechanism for enabling hidden-pixel recovery.

**App consequence.** The app always implements the non-destructive frame-change case. It has no
Delete Cropped Pixels toggle or `Image ▸ Reveal All` command, but re-entering Crop after a frame
change exposes a crop box that can be expanded; retained source pixels appear immediately when the
tool is re-entered. Adobe's tutorial asks the user to click the image after selecting Crop, so the
immediate reveal is the app's chosen behavior rather than an exact interaction claim about
Photoshop. Retained source pixels are previewed at angle zero and revealed on Apply. The preview
composes a union of the current and retained frame bounds, even
when that union exceeds one crop frame. Its backing resolution is reduced to keep each surface at
or below 4096 pixels per side and the five renderer surfaces within a 16,777,216-pixel aggregate
budget; retained unions above an 8192:1 aspect ratio cannot produce a non-zero preview. These
preview limits do not modify layer source pixels. Crop commits themselves are capped at 4096 pixels
per side and 16,777,216 frame pixels. The app's transparent empty-area behavior is the separate
OVR-1 decision, not a limit on recovering retained pixels. The earlier version of this section
called the app destructive, which inverted Adobe's own delete-versus-hide contrast; see "Is the
app's crop destructive?" below.

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

Fifteen controls. `present` 1 · `partial` 4 · `inert` 0 · `missing` 10.

| #   | Control                         | Status    | `appRef`                                   |
| --- | ------------------------------- | --------- | ------------------------------------------ |
| 1   | Tool preset                     | `missing` | —                                          |
| 2   | Aspect ratio menu               | `partial` | `Crop.tsx` — the `aspect-ratio` `<select>` |
| 3   | Swap Width and Height values    | `missing` | —                                          |
| 4   | Clear                           | `partial` | `Crop.tsx` — the `Clear` button            |
| 5   | Overlay                         | `present` | `Crop.tsx` — the `crop-overlay` `<select>` |
| 6   | Straighten                      | `missing` | —                                          |
| 7   | Grid                            | `missing` | —                                          |
| 8   | Settings (gear) menu            | `missing` | —                                          |
| 9   | Delete Cropped Pixels           | `missing` | —                                          |
| 10  | Use Classic Mode                | `missing` | —                                          |
| 11  | Auto Center Preview             | `missing` | —                                          |
| 12  | Show Cropped Area               | `partial` | `useRect` — `drawMask()`                   |
| 13  | Enable Crop Shield              | `partial` | `useRect` — `drawMask()`                   |
| 14  | Fill (incl. Content-Aware Fill) | `missing` | —                                          |
| 15  | Done / Cancel                   | `partial` | `Crop.tsx` — the `Apply` button            |

**What changed on this pass, and it is structural rather than one row.** The table grew from
fourteen to fifteen and the middle of it was reordered:

- **Tool preset is added at slot 1** for both tools in the family. The bar's leftmost control
  is the tool-preset picker beside the tool icon, it is on the crop bar as well as the type
  bar, and the app has no preset picker for either tool, so it is `missing` in both records.
- **Overlay moved up to sit with the two composition controls it belongs beside** (slots 5–7
  are Overlay, Straighten, Grid — the third-party left-to-right reading in `Unverified` item
  15 puts Straighten and Grid together and names no overlay position), and **Fill moved to
  the end of the settings group**, which is the one current reading that places it: "options
  for Straighten, Grid, settings, Delete Cropped Pixels, and Fill dropdown"
  (`shotkit.com`). Neither placement is measured — see item 15 — and the order was already
  declared structural for the two rows this file added earlier.
- **Show Cropped Area and Enable Crop Shield moved inside the gear group**, from slots 8–9 to
  slots 12–13, immediately after the other three settings the gear contains. That is what
  makes the gear row mean something: the five rows it holds are now contiguous, and a reader
  counting five loose bar positions has nothing to count.

The two `appRef` anchors the crop rows share are both the fixed 0.7 dim in `drawMask`
(the `hideBlend` guard, and the fill under it), which is the finding
rather than a duplicate citation — see the argument below.

**The `Fill` row is `missing`, and that verdict did NOT move when the crop started growing the
canvas — what moved is what the row claimed the dropdown was for.** It is the one row in this
census whose app-side story had to be rewritten without its status changing, and the trap was the
direction of the error. `type-crop.ts` said that choosing Content-Aware Fill "is what lets the crop
box extend past the image edge", which made the control a **prerequisite** for extension.
**It is not one.** The crop extends the canvas with no Fill value chosen at all, because
`applyDocumentCrop()` in `src/contexts/useLayer.ts` normalises the gesture rect through
`sortRoundRect()`, which sorts and rounds each edge once without the clamp
`trimRect()` applies, so there is nothing for the control to gate. The clause is **deleted** rather
than corrected in place, because the control's Photoshop-side job is unchanged by that and only the
false app-side causal claim was wrong. **The row's Photoshop half is now narrower than either
value list**, and the narrowing is `Unverified` item 17: it carries Adobe's one sentence about the
dropdown, the one value Adobe names in it, and the statement that Adobe does not publish the list.

The app's own answer to "what fills the band" is **OVR-1 in `docs/OVERRIDES.md`**, decided by the
operator's hand. OVR-1 now explicitly applies only to source-empty growth: retained off-frame layer
pixels reappear when the frame expands. The two absent synthesis features are recorded in
`docs/TOOLS-TOO-HARD.md`; they are distinct from the preserved-pixel recovery path.

**Two rows were added and one was rewritten by the pass before this one, and the count line
above was wrong before any of that.** It said "Twelve controls · `partial` 3 · `missing` 9"
while the table beneath it listed four `partial` rows and the next heading already said "the
four `partial` verdicts"; the count line above is correct as it now stands. The two new
controls were `Clear` and the `Settings (gear) menu`; the rewritten one is the
`Straighten` row, which used to be `Straighten / Curve / Content-Aware / Default` and named
three things the current bar does not have:

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
  party. The bar's carrying neither is now **resolved and recorded in
  `docs/TOOLS-TOO-HARD.md`**: Adobe's own enumeration of the crop bar is the _Crop tool
  options_ page, which lists the aspect-ratio values and the five gear settings and no Curve,
  and the Curve Photoshop documents is the separate **Curves** adjustment. `Default` is the
  unmarked state the tool is in before you touch the bar, and the adjustable corner form is the
  separate **Perspective Crop tool** rather than a Curve row.
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
`Clear` button in `Crop.tsx` drops the draft crop rect and leaves the aspect ratio
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
- **Enable Crop Shield — `partial`,** on the one piece of code that draws the shield
  (`useRect`'s `drawMask()`, with the fixed fill just under the guard): it is always on, its
  opacity is fixed at
  0.7 rather than the adjustable figure Adobe documents, and its color is not configurable.
- **Show Cropped Area — `partial`,** on that same branch and for the reasons in the next
  paragraph, which is the long version of this bullet rather than a separate argument.
- **Done / Cancel — `partial`.** `Apply` calls `applyDocumentCrop` and `Clear` drops the
  draft rect, which is the same pair of effects as the check mark and the cross. There is no
  Enter, no Return, no double-click and no Escape.

**Show Cropped Area and Enable Crop Shield are both `partial` on the same branch, and that is the
finding, not a double-count.** Both attempts to file them separately were wrong in opposite
directions. The first pass cited `useRect`'s handle hit-test under both names, which made the app
look two
controls deep where it draws one overlay. A later pass therefore denied one of them, and wrote that
"Photoshop's Show Cropped Area shades the discarded image inside the box, and nothing in the app
draws that" — false twice over. The app does draw a dim: the mask in `useRect`'s `drawMask()`
fills the
whole canvas with `rgba(0, 0, 0, 0.7)` and then clears the crop rect, and `CropToolArea` passes no
`hideBlend`, which is the only flag `drawMask` consults (the guard itself), so that branch runs
whenever
there is a rect to draw. And the dimmed region is the one _outside_ the box, so "inside" was wrong about the
app's own drawing whatever Photoshop does. It is also wrong about Photoshop: Adobe's own sentence for
the control is "Displays the cropped-out area as a shaded overlay", with no region attached, and
Adobe's sentence for Enable Crop Shield is "Applies a color overlay outside the crop area" — so the
two cover the same region and differ in that this one is a plain shade and that one is a colour and
an opacity you choose. The `detail` no longer says "inside the crop box", for the same reason.

The correct reading is that one rendering backs two Photoshop controls, and each diverges from its
own counterpart: the app's treatment is welded on with nothing on screen to change its colour,
opacity or existence, and both its shade and its 0.7 are constants where the Crop Shield is the
control Adobe documents as adjustable. So both rows are `partial`, both cite the same branch, and
`appNotes` says why one rendering backs two. The earlier reasoning — that two distinct
Photoshop controls cannot both be `partial` on one statement — is sound as a rule about
double-counting a _control_, and wrong as applied here, because the claim being filed is the
behaviour, not the control.

**No `inert` control here either, also checked rather than assumed.** `CropToolArgs` has
three keys — `rect`, `preRatioRect`, `aspectRatio` — plus the seed in the `crop` entry of
`src/tools/settings.ts`. All three are read and written: `preRatioRect` by
`onRatioChange()` in `Crop.tsx` and cleared on both write paths, `aspectRatio` by the destructured
read in `CropToolArea` and passed into its `useRect` call as `aspectRatio`, `rect` by every writer.
The `preRatioRect` field is a
regression-repair field, not a user-facing control, so it has no Photoshop counterpart to be
`inert` about.

### Is the app's crop destructive?

**It is not — and the previous pass said the opposite.** `applyDocumentCrop()` in
`src/contexts/useLayer.ts` takes the rect **unclamped** now, converts it to the next
`documentFrame`
via `canvasRectToDocumentFrame()`, and dispatches `COMMIT_DOCUMENT_EDIT` with a
`SET_DOCUMENT_FRAME_ACTION` history entry carrying both the previous and next frame. The frame
changes immediately, **smaller or larger**; the frame origin is subtracted in
`drawEvaluatedPresentation()` in `src/contexts/presentation-evaluator.ts` and the canvas is sized
from the frame in `drawLayersToCanvas()` in
`layer-renderer.ts`, so anything outside it stops rendering.

At angle zero, nothing is destroyed or resampled: layer positions and sources are untouched, so
their bitmaps still hold the pixels, and the history entry carries `previousFrame`, so undo puts
the frame back. That is Photoshop's **Delete Cropped Pixels OFF** case — the canvas shrinks, the
pixels are kept, and the edit stays reversible — where the **ON** case permanently removes
everything outside the crop. A rotated crop is different: `applyDocumentCrop()` transforms the
layer geometry to match the requested angle before committing the frame. The earlier version of
this section called the app destructive, then contradicted itself by saying undo restores the
frame.

The route back is available through Crop itself. When the active history contains a
`SET_DOCUMENT_FRAME_ACTION`, re-entering the Crop tool starts with a box at the current frame and
composes the retained layer pixels from the prior frame bounds. That preview keeps a fixed backing
frame while the crop is resized; the layer stack is not recomposed for each pointer frame. Pixels
outside the current crop box remain visible under the same dim overlay used by the crop selection.
At angle zero, the composition guide, dashed outline, corner handles, and rotation grip are drawn
over the full crop box, including the part beyond the current frame. The crop shade is four DOM
bands around the crop window, and every unrotated composition guide and crop edge is SVG, so a
resize updates local overlay geometry without clearing or filling the frame-sized tool canvas.
Guide contrast samples the active crop from a small cached document snapshot; pointer movement does
not issue pixel readbacks or recompose the layer stack. Rotated crops keep their canvas chrome, but
they establish the dim layer once and restore only the previous rotated crop bounds on later paints;
their guide color uses the same cached sample. Each incremental repaint restores the previous
rotated crop bounds and cuts the current crop out of the dimmed base; after a DPR resize, the hook
repaints the crop chrome because resizing a canvas clears its backing store. Active pointer events
keep only the latest client coordinates until the animation frame, and a cancel from a different
touch pointer cannot undo the captured gesture. The visible top rotation grip and its hit zone
share the same location and retain a one-pixel stroke. Widening the box to the original bounds
restores the full raster at its original pixel coordinates, with no resampling. The E2E test
`reselecting Crop shows retained pixels under the dim and widening restores the original raster`
checks the actual screenshot blend and byte-compares the entire restored image with its pre-crop
pixels. `resizing a re-entered crop updates its full-frame grid and keeps the preview allocation
fixed` captures the live resize and checks all four rule-of-thirds line coordinates, screenshot
pixels for the guide, crop outline, corner handle and rotation grip, plus the stable retained-pixel
preview backing store. It also requires the grid bounds to update within two animation frames and
byte-compares the workspace raster and canvas bounds during resize, after release, and after moving
the crop box from inside.
`the visible top rotation grip rotates a re-entered crop instead of starting a new
crop` exercises the drawn grip itself rather than only the legacy corner rotation hot zone.
`re-cropping after layer edits previews and recovers retained pixels without scaling` also paints
after the first crop, changes layer visibility, and verifies that retained pixels survive those
edits before the next crop is applied. A pointer cancellation cancels the pending animation frame
and restores the crop geometry that was active before the gesture.

The retained-pixel preview and the overflow-safe crop chrome are limited to unrotated crops: their
current frame subtraction uses axis-aligned geometry, not the rotated crop polygon. Rotated crop
guides and chrome use the frame-sized canvas path. A rotated crop can still reveal retained data
when committed; the E2E test
`a rotated recrop commits retained pixels outside the prior frame` crops a 64×64 red/blue fixture,
re-enters, extends the frame to include a hidden red pixel, rotates by a quarter turn, and verifies
that Apply moves that pixel into the resulting frame. It also asserts there is no live
retained-pixel preview at nonzero rotation, so the distinction is explicit rather than an
unintended fallback.

#### View scale through crop, undo and redo

The canvas uses CSS `object-contain` to fit the current document frame in the workspace, then
applies the view's zoom multiplier. Without compensation, reducing the frame increases the fit
scale and makes the remaining pixels look enlarged; extending the frame makes them look smaller.
That is a viewport fit change, not pixel resampling, but it violates the requested Photoshop-like
UX: cropping should change the visible frame without changing the apparent size of document pixels.
Adobe's current crop sources establish that a non-destructive crop retains hidden pixels and that
ordinary cropping is distinct from resampling. They do not explicitly specify whether the desktop
viewport's zoom percentage or apparent pixel size changes immediately after Apply. The scale
invariant below is therefore an app behavior chosen to meet the requested UX, not a sourced claim
about Photoshop's post-commit viewport handling.

`StoreProvider` now detects a frame transition within the same document and adjusts an internal
fit-scale compensation by `oldContainFit / newContainFit`. The effective scale (`containFit × view
zoom × fit-scale compensation`) stays constant for crops and for frame changes replayed by undo or
redo, while the View toolbar's zoom setting remains unchanged. Replacing the document resets the
view as before. The effective view zoom obeys the existing 10%-3200% limit; an extreme frame change
can reach a limit, so exact scale preservation is bounded there. The
`preserves displayed pixel scale when a crop changes the document frame` StoreContext test and the
pure shrink/grow cases in `view-state.test.ts` pin the calculation.

The app still has no **Delete Cropped Pixels** control to offer or invert, and no
`Image ▸ Reveal All` menu item (`grep` for `Reveal All` across `src/` returns nothing outside
this notes file). Re-cropping can reveal only content still present in layer sources; flattening
or exporting to a format that drops those sources is outside this guarantee. An expanded area with
no retained source pixels stays transparent under OVR-1; the override does not affect recovery.

#### Adobe contract and source confidence

- Adobe's Photoshop crop page, last updated February 23, 2026,
  [`crop-photos.html`](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html),
  says selecting Crop displays adjustable borders, and that the corner or edge handles resize the
  crop area. Its screenshot shows a composition grid and shaded areas outside the crop. With Delete
  Cropped Pixels unchecked, the crop is non-destructive; the page also documents viewing the image
  outside the current crop border. This confirms that retained pixels should be visible on crop
  re-entry; it does not specify a fixed shade opacity.
- Adobe's desktop non-destructive editing page, last updated September 28, 2026,
  [`non-destructive-editing-techniques.html`](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html),
  explicitly says the unchecked option preserves hidden cropped areas and names both recovery
  routes: Image > Reveal All and dragging the Crop tool beyond the image edge. It also notes that
  this option is unavailable for documents containing only a Background layer. That is why this
  app's recovery guarantee is scoped to retained layer sources rather than to every flattened
  image.
- Adobe's [`crop-tool-options.html`](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html)
  distinguishes Delete Cropped Pixels from the crop shield and Show Cropped Area. The latter are
  preview/overlay settings; they do not themselves retain pixels. Photoshop lets the crop shield
  color and opacity be customized. In this app, both visual behaviors currently share the fixed
  black 0.7 overlay in `useRect`'s `drawMask()`.
- Adobe's [`crop-tool-effects-on-image-dimensions.html`](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/resize-adjust-resolution/crop-tool-effects-on-image-dimensions.html)
  explains that physical print size depends on the pixel-to-resolution ratio and that total pixels
  and file size depend on pixel dimensions. This is useful context, but the no-resampling claim for
  this app is established by `applyDocumentCrop()` and the byte-identical E2E pixel-region check,
  not inferred from that page's short dimensions summary.
- Content-Aware Fill and Generative Expand create new pixels outside the source image; they are
  distinct from recovering hidden pixels. Photoshop exposes Content-Aware Fill in the Crop tool's
  Fill dropdown and Generative Expand from the Contextual Task Bar. Neither command exists here.

This feature preserves the source bitmap only while the document model retains it. Round-trip
recovery after save/reopen has not yet been tested for every serializer or export format and is
tracked below rather than promised here.

### What kind of commit a crop is, and which handoff entries touch it

**A crop is a document-frame history entry, and the raster trim the tool declares is
unreachable.** The crop processor is registered as `commit: 'document-operation'`
(the `crop` entry in `src/tools/toolProcessors.ts`), and every layer path refuses that commit
kind:

| Refusal                                                   | What it refuses                                           |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `updateLayerByTool()` in `src/contexts/useLayer.ts`       | painting the tool onto a layer, before any history append |
| `replayHistory()` in `src/contexts/history-replay.ts`     | replaying the tool into a layer                           |
| `operationForTool()` in `src/contexts/history-adapter.ts` | converting the tool into a durable layer                  |

So the `crop` creator in `src/tools/crop.ts` — the `imageProcessor` that trims the bitmap — is
declared and never
called. What actually commits is `applyDocumentCrop`, and it is a document edit, not a layer.
This is the load-bearing reason the crop is `partial` rather than `implemented`: the tool
performs a document operation Photoshop also performs, but by a route no other tool uses, with
its own processor branch dead.

**The shape overlay fix is a separate path.** The `clears the preview after committing a shape`
regression test in `src/components/Main/__tests__/ShapeToolArea.test.tsx` pins the fix from
`29b4ec31`. The crop never paints through that overlay at all. The crop's preview is the tool
overlay drawn by `drawMask` and its commit is `applyDocumentCrop`, which converts through
`canvasRectToDocumentFrame` — a different code path.
`docs/handoffs/ps-transform-geometry-review-and-merge.md` §2.1 ("The taper changed from linear to
projective, and every pre-existing test was structurally blind to it") names the crop exactly once,
in
passing, in the sentence "Photoshop's Perspective Crop is genuinely projective"; it is a
trapezoid/projective transform review and says nothing about the crop's commit or history.
Neither entry changes a claim in `type-crop.ts`, and neither is a live crop defect.

### Five interaction divergences

- **Dragging inside the box moves the box, not the image.** The `case 'inside':` arm of
  `useRect`'s `calculateMaskRect()` translates
  the rect by the drag delta, and the `layerUnderPointer` adoption branch in `useRect`'s
  `handlePointerDown` never runs, because
  `CropToolArea`'s `useRect()` call passes the hook's handlers straight through without a
  `layerUnderPointer`. Photoshop's contract is the opposite way round.
- **Extending the crop does add canvas, without clamping.** `usePointerPosition.getLocalCoords`
  permits the rect past the image edge, and `applyDocumentCrop()` in `src/contexts/useLayer.ts`
  normalises it with `sortRoundRect()` — sorting and rounding each edge once, with no clamp — so
  the resulting `documentFrame` can be larger or have a negative origin. Photoshop hands back an
  empty canvas for a rect that overlaps nothing, and this app accepts that too. If a layer source
  already contains pixels outside the old frame, those pixels become visible when the frame grows;
  only an area absent from all retained sources stays transparent under **OVR-1** in
  `docs/OVERRIDES.md`. Photoshop's Content-Aware Fill and Generative Expand synthesize new content
  into empty space; this app has no Fill or Generative Expand control, recorded in
  `docs/TOOLS-TOO-HARD.md`.
- **The pending rect is DISCARDED by a tool switch, not written through.** The previous pass
  claimed the draft "survives a tool switch", and the file's own comment said the opposite in
  as many words. The crop arm of `saveLastSettings()` persists
  `omit(args, 'rect', 'preRatioRect')` — the draft rect and the pre-ratio rect are stripped
  before the write, with a comment saying they are "both presentation state" — so
  `lastSavedSettings.crop` holds only the aspect ratio. `goToTool()`
  in `src/hooks/useApp.ts` commits the dirty tool, and `savedArgsForTool` in
  `useCurrentTool.tsx` re-seeds
  the crop from those persisted settings, which no longer hold a rect. Switching away and back
  therefore throws the draft away. Of Photoshop's two behaviours this is much closer to
  cancel-on-Escape than to commit-on-switch, and the aspect ratio _is_ sticky, which is
  probably what the earlier reading mistook for a surviving draft.
- **Shift is honoured on any modifier.** `useRect`'s `getEdgeAtPoint()` locks the aspect ratio when
  `ctrlKey || metaKey || shiftKey` is set, and `adjustFreshPoint()` reads the lock. So the
  `Shift` row of the `modifiers` array is `present` in substance but over-broad in binding,
  and there is no Alt from-center drag anywhere — which is why the `Alt` and `Alt+Shift` rows
  of that array are aspirational and are described as Photoshop's rather than the app's.
- **The crop owns no keyboard shortcut of its own, and one piece of it is not a table
  registration.** `C` comes from the shared table (the `c` registration in
  `AppKeyboardShortcuts.tsx`), and
  `Enter`/`Esc` come from the raw `window` listener described in the next section rather than
  from `useKeyDownShortcut`. The crop-scoped `O`/`Shift+O` handlers are also local to the
  tool area; the remaining Photoshop crop bindings are absent. Detail in the next section.

### Which Photoshop crop keys the app actually binds

**`C` from the shared table, plus `Enter` and `Esc` from a raw window listener inside the tool
area.** The second clause is new on this pass and it reverses what this file previously said.
The `useKeyDownShortcut` table is the one given for the type tool above —
`AppKeyboardShortcuts.tsx` (letters only: `b c d e g i j l m o p s t u v w y z`, plus shift and mod
variants), the two lasso tool areas and the font popup, and those are every call site of that
hook in `src/`. The `d` entry is bound only as `Shift+Alt+D`; a bare `d` selects nothing.
**It is not the whole of the app's key handling**, and for the crop specifically
it is the wrong place to look: `CropToolArea`'s own raw `window` `keydown`
effect attaches its listener and handles `Enter` and `Escape` there, with the reason written out
in the doc comment above its `cropKeysRef` —
`Main` mounts the area only while the crop tool owns the gesture surface, so the binding is
scoped to the tool by construction and needs no table entry. The commit it fires is
`applyDocumentCrop()`, the same call the panel's `Apply` makes. An earlier version of
this section concluded from `CropToolArea` calling no `useKeyDownShortcut` that Enter and Esc
were unbound, which is the table's absence being read as the app's.

| Photoshop key        | What the app actually does                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Shift+C`            | The crop tile in `toolbar-mapping.ts` is a **single entry**, and the `c` registration in `AppKeyboardShortcuts.tsx` passes no `shift`, so this re-selects Crop. There is no flyout to cycle, and Perspective Crop, Slice and Slice Select are not in `ToolArgsByName` at all.                                                                                    |
| `Enter` / `Return`   | **Works, outside the table.** The `commit` arm of `CropToolArea`'s crop-keys effect commits the pending rect and clears `rect`/`preRatioRect`; the `Enter` registrations in `PolygonClickToolArea` and `FeatherMagneticLassoToolArea` own the table registrations, for the lasso tools.                                                                          |
| `Esc`                | **Works, outside the table.** The `cancel` arm of the same crop-keys effect drops the draft rect and restores the previous framing. `Escape` is also registered in the two lasso areas and in the font popup (`FontSelect`'s `Escape` registration), and handled raw by `Transform`'s own `window` `keydown` effect, the two dialogs and the layer-rename field. |
| `O`                  | **Cycles overlays.** `CropToolArea` handles `O` while the Crop tool is active and advances through the six composition guides; the global tonal-tool registration remains the behavior outside Crop.                                                                                                                                                             |
| `Shift+O`            | `CropToolArea` handles `Shift+O` while the Crop tool is active and flips Triangle or Golden Spiral orientation; other overlays ignore it. Outside Crop, the global tonal-tool registration remains unchanged.                                                                                                                                                    |
| `X`                  | Unbound. There is no `x` registration anywhere in `src/`; `matchesShortcut` is case-insensitive (`normalizeKey()` in `useKeyboardEvents.tsx`), so this is not a capitalisation miss.                                                                                                                                                                             |
| `Backspace`/`Delete` | Bound only in the two lasso tool areas (the `Backspace` and `Delete` registrations in `PolygonClickToolArea` and `FeatherMagneticLassoToolArea`), and only to remove the last draft anchor.                                                                                                                                                                      |
| `Ctrl`/`⌘` + drag    | `useRect`'s `getEdgeAtPoint()` reads Ctrl and Command to **lock the current aspect ratio** — the behaviour the `Shift` modifier row already describes. It never reaches a Straighten tool; there is none.                                                                                                                                                        |

So the data file's `shortcuts` array now carries eight rows — `C`, `Shift+C`, `Enter`, `Esc`,
`X`, `O`, `Shift+O` and `Backspace` — each naming what the app does instead, rather than
describing Photoshop's key and leaving the app's answer in `appNotes`. `appNotes` records the crop-scoped `O`/`Shift+O` handlers and the remaining absent bindings,
and Enter/Esc are called out as real rather than missing. The Photoshop-side provenance for these
keys is unchanged and still in the source list: Adobe's CS6 shortcut list for `X` and
`Shift+drag`, and the two third-party tutorials below for `Shift+C`, `O`, Alt-from-centre,
Enter and Esc.

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
- https://helpx.adobe.com/content/dam/help/en/photoshop/using/default-keyboard-shortcuts/photoshop-keyboard-shortcuts.pdf — Adobe's current Photoshop shortcut reference; labels Crop tool + Enter/Esc as "Accept cropping or exit cropping"
- https://helpx.adobe.com/ph_fil/photoshop/how-to/content-aware-crop-fill.html

Adobe product marketing:

- https://www.adobe.com/products/photoshop/crop-image.html — the Rule of Thirds overlay, the Ratio / W x H x Resolution names, the drag-inside-to-move behaviour, and the `Clear` button: "press 'clear' to remove any constraints applied to your crop preset"
- https://www.adobe.com/products/photoshop/generative-fill.html — Generative Extend's own Crop-tool sentence, re-verified this pass: it is **Adobe's own wording and it is on this product page — not on any page under `.../crop-straighten/`**, which does not carry it. It is also about **Generative Expand the feature**, not about a value in the Fill dropdown, which is why the row no longer quotes it. This file cited it correctly; the data file was the half that promoted it into a Fill-value claim.

Third party, labelled as such:

- https://www.photoshopessentials.com/basics/photoshop-crop-tool-tips-and-tricks — the Shift / Alt / Shift+Alt constraint set and the `X` swap
- https://creativepro.com/essential-tips-for-cropping-images-photoshop — `Shift+C` flyout, `O` overlay cycling, Alt from center, Enter commits and Esc cancels
- https://design.tutsplus.com/tutorials/10-things-you-should-know-about-the-crop-tool--psd-34592 — the six-entry overlay set, and the Classic Mode behaviour (the crop rectangle moves while the image stays put)
- https://shotkit.com/extend-background-photoshop-generative-fill — its `Fill` reading is **third-party and no longer asserted in the data file**: Transparent, Content-Aware and Generative Expand, off a screenshot, with no Adobe page behind any of the three. It is kept here because it is the origin of the value list, and `Unverified` item 17 is where the question now lives. Also the one left-to-right reading of the bar reached in this pass ("options for Straighten, Grid, settings, Delete Cropped Pixels, and Fill dropdown")

---

## Unverified

Listed because they could not be sourced, or could be sourced only weakly. None of these
appears as a Photoshop behavior or app capability assertion in `type-crop.ts`.

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
2. **RESOLVED — and this entry was itself the defect. Photoshop's font size range is 0.01–1296,
   and it is Adobe's.** This item was filed twice: first as an open question, then as the reason
   the `Size` row's "0.01 to 1296 at 72 ppi" clause had to be **removed** from `type-crop.ts`. Both
   halves were wrong, and the entry contradicted the file it was auditing.
   - **Adobe states the range.** `CharacterStyle.size` is documented as "The font size in pixels
     for a 72ppi document", bounded `0.01 .. 1296`
     (`https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle`).
     That page was already in the data file's `sources` when the clause was struck — the clause
     was removed for want of a citation while the citation sat unread in the same array two
     hundred lines away.
   - **The corpus figure was wrong, not just differently-shaped.** `01-photoshop-reference.md`
     §5.3
     gives `1–1296`. Adobe gives `0.01 .. 1296`. The lower bound is a float, and it is the whole
     difference between the two: a whole number from 1 is Adobe's bound with the fractional end
     rounded away. That file is not this one's to edit, so the disagreement is reported and left.
   - **What was corrected, and where.** The `Size` row carries the range again, with the
     citation, and it states the 0.01 fractional bound explicitly rather than folding it into a
     round number. `AUTO_LEADING`'s 120% and `CharacterStyle.tracking`'s -1000..1000 come from the
     same page family and the same pass, and `JustificationProperties.autoLeadingAmount` and the
     `Underline` constant enum were added to `sources` for the leading and underline claims.
   - **Why the entry is kept and headed RESOLVED rather than left as it was:** an item under
     `## Unverified` is by definition a claim this file cannot source, and this one is now
     sourced. It is kept rather than deleted because it is the only place the corpus
     disagreement (`1–1296` against Adobe's `0.01 .. 1296`) is recorded, and deleting it
     would leave the next reader to re-derive that from two files that disagree. The heading is
     what carries the status; nothing below it is asserted.
   - **One thing about the range that is still true and worth not re-deriving:** the bound is on
     the FIELD, not on rendering. Free Transform scales a type layer past it, so the app
     reproducing the field's range is not a claim that a 1296px type layer renders at 1296px in a
     smaller document.
3. **When exactly the anti-aliasing pull-down left the type options bar — community-reported
   as Photoshop 26.10, and asserted as nothing.** The evidence, re-checked on this pass and
   unchanged: an Adobe Community bug report dated **August 2025** saying the pull-down "is gone
   since Photoshop **26.10**", plus a Reddit thread from the same removal that names the
   routes that replaced it (`Type > Anti-Alias`, the Character panel, the layer's properties).
   No Adobe release note or "What's new" page was found, so no version is asserted as fact in
   `type-crop.ts`. Two things this pass added to the record:
   - **The five presets were not removed from Photoshop, only from the bar.** The Scripting
     Reference mirror still enumerates all five, and the Character panel still carries them.
     Any reading that the presets were withdrawn is refuted.
   - **Adobe's own current help is why a reader would expect the control on the bar.**
     `formatting-characters.html` lists four places characters can be formatted — Character
     panel, Type tool options bar, Properties panel, Contextual Task Bar — without naming
     anti-aliasing among them. The data file records this rather than pretending Adobe's
     documentation has caught up.
     What this file used to assert wrongly, in three places at once: the heading above said
     "off the bar in **27.x**" (the report says 26.10, and 27.x did not exist when it was filed
     in August 2025), the same section said "In 27.x those commands are a top-level `Type`
     menu", and `Unverified` item 3 said the number was already out of the data file entirely.
     The first two are corrected to 26.10-as-reported; the third stands.
     Closest: https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044
4. **The two path buttons' Photoshop names and bar positions.** "Align to Path" and "Create
   Work Path" could not be confirmed from any Adobe page. What _is_ sourced: type flows along
   an open or closed work path, and creating a work path from type is a non-destructive
   operation on a live type layer. The data file therefore names the controls
   descriptively and does not claim Adobe's exact button labels.
   Closest: https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html
5. **The crop shield's default opacity.** Adobe documents a customizable color and opacity
   and nothing about the default. The commonly cited 75% figure — repeated in
   `01-photoshop-reference.md` §6.2 — was not found in any source in this pass, so it is not
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
    `HistoryState`. Carried from `01-photoshop-reference.md` §5.4, not re-verified, and not
    asserted in the data file.
11. **Whether `W × H × Resolution` accepts a single dimension** with the other left empty, as
    a third-party tutorial describes. Only third-party; not asserted.
    Closest: https://jkost.com/blog/2017/05/essential-tips-for-cropping-in-photoshop-cc.html
12. **Three `Delete Cropped Pixels` clauses remain third-party.** The on-by-default state,
    demoting a locked Background layer, and the resulting file growth have not been found in an
    Adobe source. The recovery routes are no longer part of this item: Adobe's desktop
    non-destructive editing guidance documents both `Image ▸ Reveal All` and dragging the Crop
    tool beyond the image edge, and says the unchecked option is unavailable for a Background-only
    document. See the updated source discussion under "Delete Cropped Pixels" for the distinction.
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
    and no Adobe page reached in this pass enumerates the current crop bar: the crop-straighten
    page captions a figure ("A. Aspect Ratio menu B. Swap Width and Height values C.") and
    the options page tabulates _settings_, not _positions_. The only current left-to-right
    reading is a third-party screenshot description — "Straighten, Grid, settings, Delete
    Cropped Pixels, and Fill dropdown" — which is not a full order and does not place every
    row. The `Clear` and `Settings (gear) menu` placements are therefore **structural**: the
    first sits with the aspect-ratio group it clears, the second immediately before the five
    settings it contains — and on this pass the three moves that follow from the same reading
    (Tool preset first, Overlay beside Straighten and Grid, Fill after the gear group) are
    structural for the same reason. Do not read the table as a measured order without a source
    that measures one.
    Closest: https://shotkit.com/extend-background-photoshop-generative-fill
16. **That Ctrl (Windows) / Command (Mac OS) reaches Straighten without visiting the bar, and
    the two rotate-time modifiers beside it.** The previous `Straighten / Curve / Content-Aware
/ Default` row asserted the Ctrl clause, no source in this pass supports it, and the app
    reads those two keys for the opposite operation (aspect-ratio lock, `useRect`'s
    `getEdgeAtPoint()`).
    **The inherited pass put the clause back** into the `modifiers` array — as "held on its own
    it invokes the Straighten tool without visiting the bar", extended with "Shift while
    rotating → 15-degree increments" and "Ctrl while rotating → prevents the crop box from
    shrinking" — while `appNotes` simultaneously called those very rows aspirational. That is
    the same file asserting a modifier and disclaiming it. All three rows are **left in the
    array** because they are plausibly the modifier table on `crop-tool-options.html`, which is
    already in `sources`, and because `modifiers` documents Photoshop rather than the app; but
    **none of the three was re-opened on this pass**, so treat them as unverified rather than
    settled. Either find the table or delete the rows — do not leave them half-asserted.
17. **The `Fill` dropdown's complete value list — still open, and the row now asserts none of
    it.** Re-crawled this pass. `apply-content-aware-fill-while-cropping-images.html` (Adobe,
    last updated 23 Feb 2026) says, verbatim: "Go to the Fill dropdown in the Options bar and
    select Content-Aware Fill", and its Note reads "To use Content-Aware Fill on Crop, ensure Use
    Classic Mode is turned off". That establishes the dropdown and **one** value. It is still the
    only value any Adobe page names. `crop-tool-options.html` — Adobe's own enumeration of this
    bar, last updated the same day — tables the aspect-ratio values and the five gear settings
    and **does not list a Fill dropdown at all**, so it is not a source for the control's contents
    either. Adobe publishes no enumeration of the menu.
    - **Both lists that were in the data file are out of it.** Transparent / Content-Aware /
      Generative Expand is a third-party screenshot reading (`shotkit.com`, kept in the sources
      list under that label); the CC-era list the row carried before that (None, Content-Aware
      Fill, Background, Foreground Color, Black, 50% Gray, White) was third-party, undated here,
      and predates Generative Expand. The row's hedge — "what a current walkthrough of the bar
      reads is…" — did not repair this, because `options[].detail` is a **What Photoshop does**
      statement and a named third-party list is not one however it is labelled. What the row
      carries instead: the dropdown exists, Content-Aware Fill is a value in it, Adobe does not
      publish the list.
    - **The quote the row hung on Generative Expand is Adobe's, and it is still not a Fill
      claim.** "Just click and drag beyond the borders of an image with the Crop tool, and then
      fill the extended canvas with new content that blends with the existing image" is Adobe's
      own wording on `www.adobe.com/products/photoshop/generative-fill.html` — a **product page**,
      not one of the `.../crop-straighten/` help pages, which do not carry it. It is about
      Generative Expand the feature. Removed from the row, recorded here.
    - **What Adobe's current help does say about Generative Expand contradicts the third-party
      list's placement of it.** `explore-beyond-the-canvas-with-generative-expand.html` (Adobe,
      last updated 23 Feb 2026) puts it in the **Contextual Task Bar**: "From the Tools panel,
      select Crop tool and drag the crop handles outward to expand the canvas. Select Generative
      Expand from the Contextual Task Bar." Nothing on that page, and nothing else reached, calls
      it a value in the Fill dropdown. The OVR-1, TOOLS-TOO-HARD and generated app notes have since
      been reconciled: OVR-1 is only the empty Background-color band case, the too-hard entry names
      Content-Aware Fill and Generative Expand as distinct synthesis features, and the app notes
      distinguish synthesis from re-cropping retained pixels. This file asserts no Fill value list
      beyond the one Adobe names.
    - **What the crop's extension closed is the app-side half, and the data file had it wrong.**
      The `Fill` row claimed that choosing Content-Aware Fill is what lets the crop box extend
      past the image edge. That causal claim is deleted: the crop extends the canvas with **no**
      Fill value chosen, and the control is not rendered at all — the bar carries an Aspect
      Ratio select and two buttons, nothing else
      (the whole rendered bar in `src/components/ToolbarsRight/Crop/Crop.tsx`'s `Crop`
      component). The app's answer to what fills the
      added band is **OVR-1** in `docs/OVERRIDES.md`, recorded by hand, and both absent
      synthesis paths are recorded once in `docs/TOOLS-TOO-HARD.md`. That half is settled.
18. **How Adobe's inside-drag behavior varies across published instructions.** The current
    desktop `crop-photos.html` page (last updated 2026-02-23) says dragging inside moves the
    crop box. The 2024 `tool-techniques/crop-tool.html` page and 2020 `image-resizing-basics.html`
    tutorial say it repositions the image. The current `crop-tool-options.html` lists **Use
    Classic Mode** as reverting to legacy behavior, but none of these pages explicitly ties the
    older wording to that option. The app follows the current desktop page and moves the pending
    crop box without moving its layer pixels. Keep the version conflict documented; do not
    infer a mode mapping that Adobe has not stated.
19. **The Adobe shortcut sheet that lists all four type tools on `T`.** The revalidation
    brief cites `https://cdn.edex.adobe.com/.../08d7c4a0-….pdf` for it; `webfetch` returns raw
    PDF bytes rather than text and no search result surfaced the sheet's contents, so the URL
    is **not** in the data file's `sources` — that array takes only URLs that were opened. The
    four names are carried by Adobe's own Type-mask teaching page, by the Adobe overview table
    recorded in `AGENTS.md`, and by third-party walkthroughs. Anyone who can open the PDF
    should add it and tighten the wording.
20. **Three quotations the inherited pass added that this pass did not re-open.** The data
    file's `sources` gained four URLs and three verbatim Adobe sentences on that pass, and the
    sentences were not re-derived here:
    - the **Tool Preset picker** rows on both tools, quoting "You can also select the Tool
      Presets dropdown menu next to the tool at the upper-left of the Options bar"
      (`…/get-started/set-up-toolbars-panels/create-tool-preset.html`);
    - the **Text Orientation** row, quoting "Select a type tool, and click the Text Orientation
      button in the options bar" (`…/using/tool-techniques/horizontal-type-tool.html`);
    - the **Swap Width and Height** row, quoting "Clicking the double-arrow icon changes the
      crop orientation by swapping the Width and Height values. This replaces the Rotate Crop
      Box button." — which **the section above had already recorded as unverifiable** and
      deliberately left unquoted, with the Elements sentence carrying the same claim instead.
      The inherited pass re-quoted it and added
      `help.adobe.com/archive/en/photoshop/cs6/photoshop_reference.pdf` to `sources`.
      Each URL is a plausible Adobe address and the sentences are the kind of text those pages
      carry, but "plausible" is not "opened", and this family's own rule is that `sources` takes
      only URLs that were opened. Anyone with a crawler session should open these four and either
      confirm the quotations or drop them. The Commit/Cancel row's edit-mode quotation, by
      contrast, **is** verified: it is `creating-type.html`'s own sentence, "To determine whether
      a type tool is in edit mode, look in the options bar — if you see the Commit button and the
      Cancel button, the type tool is in edit mode."
21. **Everything about the click/drag threshold, the minimum box size and the growth direction.
    Three figures the app chose and Adobe does not publish.** The Text tool now places point type
    on a press that travelled ≤ 3 px on either axis and paragraph type beyond it
    (`POINT_TYPE_MAX_DRAG_PX`, read by the `isClick` test in `TextToolArea`'s `useRect`
    `onChangeEnd`), clamps a
    paragraph box to the document before measuring it (`calculateNewRect()`'s `trimRect2()` clamp)
    and derives only
    its height (`calculateNewRect()`'s paragraph arm), which is a downward growth. **No Adobe page reached
    states a threshold, a minimum box size or a growth direction** — Adobe documents the two
    gestures by intent only ("Click on the canvas and enter a single line of text. You can also
    create a paragraph of text by dragging out a text box and then typing inside the box",
    `https://helpx.adobe.com/ph_fil/photoshop/how-to/add-text-to-image.html`), and the in-tree
    comment above `POINT_TYPE_MAX_DRAG_PX` in `src/tools/text.ts` says the same. So all three are recorded as this app's
    decisions in the prose rather than as Photoshop's behaviour. One consequence worth knowing
    rather than fixing blind: a press of 4 px places a paragraph box 4 px wide, and
    `textWrapWidth` is that width less `TEXT_PADDING` on both sides (5 px each), so the wrap
    width is negative, every token overflows it and the overflow indicator is the only thing that
    reports it. The height side has no such edge: it is derived from the laid-out line count and
    only ever grows, exactly as a Photoshop paragraph box does not shrink to its content.
    Closest: https://helpx.adobe.com/ph_fil/photoshop/how-to/add-text-to-image.html
22. **Why a word too wide for the box is not broken: Adobe's hyphenation default, not re-opened
    here.** The app breaks greedily at spaces and lets a too-wide word overflow
    (`wrapLine()`). The justification is that Adobe's hyphenation is off
    by default — `ParagraphStyle.hyphenation` is "boolean … Default false"
    (`https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/paragraphstyle`, cited
    by the in-tree comment above `wrapLine()`) — and **that page was not opened on
    this pass**, so the claim is carried in the prose as this app's reconstruction of an
    off-by-default setting rather than as an Adobe sentence. The in-tree comment also quotes Adobe
    for the same outcome from the other end — converting paragraph type to point type deletes "all
    characters that overflow the bounding box" — in that same comment, but **that
    sentence carries no URL in the comment either**, so which page states it is unverified too.
    Hyphenation remains `missing` as a control — the app cannot
    switch hyphenation on, which is the actual gap, and it is unaffected by the breaker.
    Closest: https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/paragraphstyle
23. **UNVERIFIED — hidden crop pixels across save/reopen/export.** `applyDocumentCrop()` preserves
    layer sources in memory, and the crop-history E2E tests prove re-cropping before export. No test
    yet proves every native serializer preserves off-frame source pixels across save/reopen, or
    defines behavior after flattening to PNG/JPEG. The re-crop guarantee is therefore limited to
    source data still present in the live document model.
    Closest: `src/contexts/useLayer.ts` — `applyDocumentCrop()`; serializer round-trip coverage is
    not yet present.
24. **UNVERIFIED — automatic Crop Shield opacity adjustment.** Adobe's Crop Tool options page
    documents a customizable shield color and opacity but does not describe automatic lightening
    while the crop is dragged or promise that the shield never obscures the subject. The data row
    no longer asserts that behavior; the app itself uses a fixed black 0.7 overlay.
    Closest: https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html
