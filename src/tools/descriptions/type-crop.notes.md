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

- The **Text color** row from `missing` to `partial`, with `Text.tsx:184` as its `appRef` at
  the time — **now `:219`**, because the bar gained four controls above it and every `appRef` in
  this table moved with them; see the re-derivation above. The
  colour control exists, is wired to the args, and reaches `ctx.fillStyle`; the foreground
  mirroring the previous pass described is gone. This reversed a false verdict rather than
  creating one.
- The **`commit: 'document-operation'` finding** for the crop, including the three refusals
  that make `src/tools/crop.ts`'s trim unreachable, and `COMMIT_DOCUMENT_EDIT` /
  `SET_DOCUMENT_FRAME_ACTION` / `previousFrame` as the real commit path.
- The **Enter and Esc crop bindings**, with the correction that they come from a raw `window`
  listener at `CropToolArea.tsx:51-59` rather than from `useKeyDownShortcut`. This file had
  concluded the opposite, and it was wrong.
- The **seven extra `shortcuts` rows** and the **`appRef` moves** (`useRect.ts:167` → `:223`,
  the `Text.tsx` column shifted by a row). Every one of those line numbers now resolves to the
  wiring it claims.
- The **`Font Style` appRef re-derivation to `:209`** was right about the line and wrong about
  the verdict — see below.

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

**Reversed again, later, on the clause this list says was removed for the right reason.** The
bullet above this one removed the `Size` row's "0.01 to 1296 at 72 ppi" clause on the grounds
that `Unverified` item 2 said no Adobe page states a range. That reasoning was sound and its
conclusion was wrong: `CharacterStyle` **does** state the range, and the page carrying it was
already in `sources`. The clause is back, with the citation, and `Unverified` item 2 is deleted
rather than annotated — see that item, and the `Size` bullet in the verdict list for the two
divergences that remain, which are the **unit** and the **presentation** and never were the
range.

**Left in place but flagged, not fixed:** four added `sources` URLs and three added verbatim
Adobe quotations that this pass did not open, including one this file had already recorded as
unverifiable and left unquoted. See `Unverified` item 20.

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
and `Shift+T` cycles the group. **The app has one entry for that four-tool group**
(`toolbar-mapping.ts:108`, a single `{ label: 'Horizontal Type Tool', name: 'text' }`), and
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
has the same shape: `Text.tsx:230` the align control, `:250` the B/I pair, then `Apply` at
`:325` and `Clear` at `:328` at the right end. The bar has since grown by four controls — Line
Height, Tracking and the caps/decorations pair — between the size field and the colour, which
does not bear on Adobe's order and is recorded in the census section instead.

### Options-bar control census

Twelve controls. `present` 1 · `partial` 4 · `inert` 0 · `missing` 7.

**Re-derived on this pass.** Every `appRef` below moved, because the bar grew by four controls
and every block below the font select shifted with it. The verdicts did not move with them:
**no control changed status**, and that is the finding rather than an absence of one. The
character formatting that arrived with this pass is **not** on Photoshop's type options bar at
all — tracking, the caps toggles and the two decorations are Character-panel controls, which
`formatting-characters.html` lists as one of four places characters can be formatted, and the
Character panel is a panel rather than a bar. Putting them in this table would file them under a
census whose contract is "every control Photoshop places in this tool's options bar, in bar
order", so they are documented in the Character and Paragraph panel table below instead, and
the app's placement of them on its own bar is recorded as an app-side divergence there.

| #   | Control                                   | Status    | `appRef`                                         |
| --- | ----------------------------------------- | --------- | ------------------------------------------------ |
| 1   | Tool preset                               | `missing` | —                                                |
| 2   | Text Orientation (`T` + direction marker) | `missing` | —                                                |
| 3   | Font family                               | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:139` |
| 4   | Font Style                                | `missing` | —                                                |
| 5   | Size                                      | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:158` |
| 6   | Text color                                | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:219` |
| 7   | Align Text Left / Center / Right          | `present` | `src/components/ToolbarsRight/Text/Text.tsx:230` |
| 8   | Toggle the type on a path                 | `missing` | —                                                |
| 9   | Create Work Path                          | `missing` | —                                                |
| 10  | Warp Text                                 | `missing` | —                                                |
| 11  | Toggle the Character and Paragraph panels | `missing` | —                                                |
| 12  | Commit / Cancel                           | `partial` | `src/components/ToolbarsRight/Text/Text.tsx:325` |

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
(`src/tools/text.ts:150`), so the two buttons weight the glyphs. That is a real fix to two
buttons, and it is still not a Font Style control: a family-specific style, a faux-style choice
and a per-character style all remain unreachable, and a boolean cannot express "Semibold" any
more than it could before.

**Two of these twelve verdicts moved on this pass, and one of them reverses a row this file
previously called a false verdict.** Slot 6 is now `partial` where it was `missing`, because
the bar **does** render a colour control and did not used to — see the verdict list below.
Slot 4 is now `missing` where it was `partial`, because there is no Font Style combo box
anywhere in `ToolbarsRight/Text/`: the app's bar is Font (`FontSelect`), Font Size, Line
Height, Color, Align, a B/I pair and Apply/Clear — and, as of the later pass, Tracking and a
caps/decorations group as well. The B/I buttons at `Text.tsx:250` and
`:261` are the app's nearest analogue to Faux Bold and Faux Italic, and they reach the canvas
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
`crop.ts:26` the crop creator, `rect.ts:36` `trimRect`, `useRect.ts:223` the 0.7 fill,
`layer-renderer.ts:32` the six-name `vectorToolNames` set, `toolbar-mapping.ts:59` the
single crop entry, `toolbar-mapping.ts:107` the single type entry.

**The numbers in the two paragraphs above are themselves history: they describe the pass
before this one, and the lines have moved again.** Every `path:NNN` in both files was
re-resolved against this worktree on this pass, and the current anchors are the ones in the
census tables above and in `type-crop.ts`. Where they moved, and by how much:

| Was                                                | Is                                         | What moved                                       |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| `toolbar-mapping.ts:107`                           | `toolbar-mapping.ts:108`                   | the text tile sits after a closing `],`          |
| `Text.tsx:123` / `:136` / `:189` / `:175` / `:210` | `:136` / `:149` / `:195` / `:195` / `:230` | the textarea and five control rows all shifted   |
| `useRect.ts:167`                                   | `useRect.ts:223` (fill at `:226`)          | `drawMask` grew; `:167` is now a handle hit-test |
| `useLayer.ts:349`                                  | `useLayer.ts:369`                          | the `toolName === 'text'` branch                 |
| `CropToolArea.tsx:21`                              | `CropToolArea.tsx:61`                      | the `useRect` call, after the key listener       |

The crop `implementationRefs` are all correct as they stand (`toolProcessors.ts:146`,
`CropToolArea.tsx:40,61`, `useRect.ts:156,223,342,454`, `rect.ts:36`, `useLayer.ts:644`,
`settings.ts:39,67`, `toolbar-mapping.ts:59`, `crop.ts:26`), and so are the text ones except
`Text.tsx:95`, which is `applyText` and is the right function for the commit row.

Why each verdict:

- **Font family — `partial`,** not `present`. `FontSelect` renders and writes through
  `handleFontFamilyChange` to the args, and the canvas honours it, so the control is real. But
  `src/components/ToolbarsRight/Text/FontSelect.tsx:5-20` is a hard-coded array of fourteen
  families, not an enumeration of what the platform has, and Photoshop renders the list in
  each face.
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
  all**" and that it copied the store's foreground into the args one-way from
  `Text.tsx:16-20`. That was true when it was written and is **false in this tree**:
  `Text.tsx:219` renders `<input id="text-color" type="color">`, `handleColorChange`
  (`Text.tsx:94-96`) writes it into the args, and `renderText` consumes it as `ctx.fillStyle`
  (`src/tools/text.ts:295`). The foreground mirroring it described is gone, and both the
  component comment (`Text.tsx:83-93`) and the args type comment (`src/tools/text.ts:130-135`)
  say so in as many words — the latter names the exact change: `color` "used to be omitted
  because the bar mirrored the store's foreground into the args on every render". So `missing`
  was the second kind of false verdict: a control that is on screen and wired, understated.
  What is genuinely still absent is narrower and is what `partial` is for: Photoshop's Color
  Picker rather than the platform's, the `Alt+Backspace` / `Ctrl+Backspace` foreground and
  background bindings (there is no `alt` registration anywhere in
  `AppKeyboardShortcuts.tsx` — `useKeyboardEvents.tsx:76` is only the matcher), per-character
  scoping, and Photoshop's default of seeding the type colour from the foreground swatch,
  where the app's seed is a fixed `color: '#000000'` (`src/tools/settings.ts:88`).
- **Font Style — `missing`,** and the verdict-list bullet that said `partial` on this pass is
  deleted rather than left to contradict the census. The reason both sentences existed is that
  they were about different objects; see the resolution in the census section above. Short form:
  the row names a style combo, the app has two booleans, and a status describes the control the
  row names.
- **Align — `present`.** A `<select>` rather than three icon buttons, but the same three
  values, the same default (left), and the same effect. The Justify variants are not on the
  bar in Photoshop either. Note that this pass changed _how_ it reaches the args, not what it
  does: alignment now goes through `publishStyle` rather than `onChange` directly, because
  `calculateNewRect` has an alignment arm that re-places a box the text outgrew, so a box
  moved by Left and then switched to Right is one the next measurement would move again.
- **Commit / Cancel — `partial`.** `Apply` (`Text.tsx:325`) and `Clear` (`:328`) do what the
  check mark and the cross do, and the draft is also committed implicitly when the tool
  changes (`goToTool` calls `commitDirtyTool`, `src/hooks/useApp.ts:169`, whose text branch is
  `src/contexts/useLayer.ts:369`). There is no keyboard commit and no Escape. The app's pair
  is also not edit-mode-only the way Adobe's is: it is always rendered, merely disabled while
  `text` or `rect` is empty.

**There is no `inert` control in this family, and that was checked rather than assumed.**
`TextToolSettings` is `Omit<TextToolArgs, 'text' | 'rect'>`
(`src/tools/text.ts:136`), so the persisted surface is **thirteen** keys, counted off the type
rather than off this prose: the eight the previous count named — `align`, `bold`, `color`,
`fontFamily`, `fontSize`, `italic`, `lineHeight` and the tool name — plus the five that arrived
with this pass, `allCaps`, `smallCaps`, `strikethrough`, `tracking` and `underline`. **Eight
became thirteen, and the growth is exactly five.** (A brief for this pass said fourteen; the type
says thirteen, and thirteen is what is written down.) Every one is rendered by `Text.tsx` and
reaches `renderText` through `resolveTextStyle` (`src/tools/text.ts:113`), the single place a
field missing from an older persisted record becomes a value. That seam is also why the five
arrived **optional**: `saveLastSettings` persists the record verbatim
(`src/util/settings.ts:31`, which strips only `text` and `rect`), so a settings object written
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
once, by `text` (`src/tools/text.ts:353`), and is then scaled rather than re-rendered.

### Character and Paragraph panel controls

Not part of the options-bar census above, but the other half of Photoshop's type surface and
requested explicitly. **Six are `missing` and two arrived on this pass** — Tracking and Leading
were already `partial` and `missing` respectively; what changed is that Tracking stopped being
absent, and that four controls this file previously did not enumerate now exist in the app. The
app has no Character panel and no Paragraph panel; the one control the app has that overlaps the
first row, line height, is semantically different from Photoshop's leading.

**Five of these live in the app's options bar rather than in a panel**, which is the divergence
the census section above declines to record. Tracking, All Caps, Small Caps, Underline and
Strikethrough are all rendered by `Text.tsx` — `:203` the tracking slider, `:278` All Caps,
`:289` Small Caps, `:300` Underline, `:311` Strikethrough — because the app has no panel to put
them in. That is a placement difference and not a capability one, and it is why a reader of the
census above and of this table sees twelve bar controls and thirteen panel controls of which five
are in both places.

| Control                                                                     | Photoshop                                                                                                                         | App                                                                                           | Status                                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Leading                                                                     | absolute baseline-to-baseline distance in points; per-line, largest value in a line wins                                          | unitless multiplier of the font size, 0.5–2.25, applied as `index * fontSize * lineHeight`    | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:178`; default now `AUTO_LEADING`                                   |
| Tracking                                                                    | loose/tight in 1/1000 em, cumulative with manual kerning                                                                          | slider over −1000…1000 in 1/1000 em, applied as `ctx.letterSpacing`                           | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:203`                                                               |
| All Caps                                                                    | every character rendered as a capital                                                                                             | `ctx.fontVariantCaps = 'all-small-caps'`                                                      | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:278`                                                               |
| Small Caps                                                                  | synthesises where the font has none — "if the font does not include small caps, Photoshop generates faux small caps"              | `ctx.fontVariantCaps = 'small-caps'`; Chrome synthesises                                      | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:289`                                                               |
| Underline                                                                   | drawn in the type colour; `Underline` is `NONE / LEFTINVERTICAL / RIGHTINVERTICAL`, no style, weight, offset or colour of its own | a rule in the type colour, 0.1em below the baseline, thickness `max(1, round(fontSize / 16))` | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:300`; **the offset and the thickness are this app's, not Adobe's** |
| Strikethrough                                                               | drawn in the type colour                                                                                                          | a rule at half the rendered x-height, in the type colour                                      | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:311`                                                               |
| Kerning                                                                     | None / Metrics / Optical / manual, cumulative with tracking                                                                       | —                                                                                             | `missing`                                                                                                                  |
| Baseline shift                                                              | points, positive up                                                                                                               | —                                                                                             | `missing`                                                                                                                  |
| OpenType                                                                    | per-feature toggles                                                                                                               | —                                                                                             | `missing`                                                                                                                  |
| Indents (left / right / first line)                                         | paragraph type only                                                                                                               | —                                                                                             | `missing`                                                                                                                  |
| Hyphenation                                                                 | paragraph type only                                                                                                               | —                                                                                             | `missing`                                                                                                                  |
| Justification (Justify Last L/C/R, Justify All) + word/letter/glyph spacing | paragraph type only                                                                                                               | —                                                                                             | `missing`                                                                                                                  |

**Leading's verdict did not move, and the reason is the whole of it.** The default is now
`AUTO_LEADING = 1.2` (`src/tools/text.ts:34`), which is Adobe's figure —
`JustificationProperties.autoLeadingAmount` defaults to `120`, "Percentage of type size to use for
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
way out; `trackingPx` (`src/tools/text.ts:155`) is the one place that converts to px. The first
divergence is that Adobe's tracking is **cumulative with manual kerning**, and the app has no
manual kerning to be cumulative with, so half the control is gone. The second is the fallback:
where `ctx.letterSpacing` exists the whole line goes down in one `fillText` and the shaper
handles it, and where it does not the app places each grapheme cluster itself — which drops
kerning and any ligature the font would have formed across the boundary, measured at 11.875px
wider than the kerned total on 'WAVE AV' at 64px. The fallback is feature-detected with
`'letterSpacing' in ctx` (`src/tools/text.ts:165`) rather than by deleting the prototype
property, which reports success on Chrome 154 and leaves it working.

**Underline is `partial` and two of its numbers are this app's own.** Adobe's only rule is that
the line "is always the same color as the type color", and its `Underline` enum has no style,
weight, offset or colour of its own — the Underline Options dialog with an offset control is
InDesign's and InCopy's, not Photoshop's. So where the rule sits is a **reconstruction**: 0.1em
below the baseline (`UNDERLINE_BELOW_BASELINE_EM`, `src/tools/text.ts:47`), which no Adobe page
states, and the thickness `max(1, round(fontSize / 16))` (`decorationThickness`, `:283`), which
Adobe does not document at all. The row records the control as `partial` because the drawn
thing exists, is in the right colour, and is switchable — and neither figure is claimed as
Adobe's. Strikethrough is `partial` on the same grounds without the offset problem: half the
measured x-height is where a strikethrough goes, and Adobe documents neither the position nor
the thickness there either.

**Caps needed the font assigned first, which is the kind of thing that silently eats a control.**
`ctx.fontVariantCaps` is assigned **after** `ctx.font` (`applyTextStyle`, `:191`) because
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

1. `src/tools/text.ts:287` — `renderText` splits the string on `\n` and calls
   `ctx.fillText` per line onto a 2D context. There is no glyph outline, no font engine, and
   no retained text object anywhere in the module.
2. `src/tools/text.ts:353` — the `text` creator allocates an `OffscreenCanvas`, calls
   `renderText` onto it and returns `[canvas]`. A creator tool's return value is a raster.
3. `src/tools/toolProcessors.ts:160` — the `text` processor is `commit: 'source'`,
   `creator: true`, so the layer source is that raster. (The block runs `:160-166`; an earlier
   note in this file put it at `:170-176`, which is `'freehand-lasso'`.)
4. `src/contexts/layer-renderer.ts:32` — `vectorToolNames` is a `Set` of **six** tool names:
   `shape`, `rectangle`, `ellipse`, `triangle`, `polygon`, `line`. `text` is not in it, so
   `isVectorSource` is false for a text layer and `getLayerBitmap` returns `layer.bitmap`
   instead of re-running the creator (`layer-renderer.ts:53`).
5. `src/contexts/layer-renderer.ts:81` — that bitmap is drawn with
   `ctx.drawImage(bitmap, x, y, position.width, position.height)`, so enlarging a text layer
   resamples it.
6. `src/contexts/materialization.ts:171` — **the exception.** The durable materializer
   re-runs `processor.imageProcessor` from the retained args, so on that path the characters
   are re-derivable rather than only resampled. `AGENTS.md` is explicit that the legacy
   `HistoryItem[]` path is the production replay authority and the durable document is a
   shadow projection, so the runtime path above is what a user sees.

The layer _does_ retain its `TextToolArgs` (`ToolLayerSource.args`,
`src/contexts/layer-types.ts:21-24`, populated at `src/contexts/useLayer.ts:300`), so the
information needed to re-render survives; on the runtime path nothing reads it. Every consumer
of the composited document — the visible canvas, undo replay, and the PSD writer at
`src/contexts/psd-utils.ts:245`, which calls the same `drawLayerSource` — goes through
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
(`src/tools/text.ts:150`).

**Both renderers build it, not one, and the previous version of this file named only one.**
`applyTextStyle` (`:191`) is reached from `renderText` (`:287`) **and** from `getTextWidth`
(`:331`), so the shorthand is built on the drawing path and on the measurement path, and the
options bar's `calculateNewRect` measures through the second one. A fix applied to `renderText`
alone would have left the box measured against a font the drawing never used — which is the
one-metric-out-of-date failure `publishStyle` in `Text.tsx` exists to prevent.

**The baseline moved, because `'top'` is a metric no API exposes.** `textBaseline` was `'top'`,
which is a font-dependent constant: measured across fourteen families at 64px the offset runs
0.762695em (Times New Roman) to 0.875977em (Impact), with Arial at 0.781250em and the generic
families at exactly 0.75em. Every decoration this tool draws relative to a baseline — the
underline, the strikethrough — needs a baseline it can name, and `'top'` is not one. It is now
`'alphabetic'` with the baseline placed at
`rect.y1 + TEXT_PADDING + fontBoundingBoxAscent + index * fontSize * lineHeight`
(`baselineOffset`, `:222`, with a 0.8em fallback for a context whose `measureText` reports no
ascent — the test harnesses model `measureText` as `{ width }` alone, and a real `undefined`
there puts every baseline at `NaN`). `textAlign` is `'start'` for the same reason: the anchor is
computed from the measured **ink** width, so the box and the glyphs cannot disagree.

**Ink width is not advance width, and the difference is exactly one tracking gap.** Chrome's
`letterSpacing` adds the spacing to every character's advance _including the last_, so
`measureText('H').width` at 10px of tracking is 10px wider than untracked Arial even though one
glyph has no gap in front of it — the advance grows by `n * spacing` for n = 1…10 while the ink
grows by `(n - 1) * spacing`. Every number that positions something relative to a line uses
`inkWidth` (`:248`), and `getTextWidth` uses it too, or the box grows by a gap the text never
fills. At zero tracking `inkWidth` short-circuits to `ctx.measureText(line).width`, because the
fallback measures a string one cluster at a time and there is no reason to throw away kerning
when there is no spacing to place by hand.

### Two more app divergences worth stating

- **No text box, and therefore no wrapping.** `src/util/rect.ts:116`
  (`calculateNewRect`) measures the widest line and _grows_ the rect to fit it — the width grows
  at `:145-160` and the height at `:168-170`, and neither branch fires when the text is narrower
  than the box already is — then trims the result to the document. A line longer than the canvas
  is clipped at the canvas edge rather than wrapped. Photoshop's paragraph type does the
  opposite: the box is fixed and the text reflows inside it, with an overflow icon when it no
  longer fits.

- **Content is typed in the panel.** The string comes from a `<textarea>` in the right-hand
  panel, and a canvas drag only sizes the box (`TextToolArea.tsx:24-39`). There is no caret,
  no insertion point, no selection and no per-character formatting.

### Which Photoshop type keys the app actually binds

**`T`, and only `T`.** The complete key table is
`src/components/Common/AppKeyboardShortcuts.tsx` — the registrations at `:159-551` cover
`z`, `y`, `c`, `v`, `i`, `j`, `b`, `u`, `t`, `l`, `w`, `g`, `o`, `e`, `s`, `m`, `p` and their
shift/mod variants — plus three `Escape`/`Enter`/`Backspace`/`Delete` registrations in each of
the two lasso tool areas (`PolygonClickToolArea.tsx:923-957`,
`FeatherMagneticLassoToolArea.tsx:544-578`) and one `Escape` in the font popup
(`FontSelect.tsx:54-62`). Those are every call site of that hook in `src/`; the raw `onKeyDown`
handlers elsewhere (the transform box, the two dialogs, the sidebar's own fields) are not in it
— and for the crop one of those raw handlers is the point, so see the crop section below before
concluding anything from this list. Nothing else in `src/` calls `useKeyDownShortcut`. The four
Photoshop rows the previous pass carried were all unbound, and two of them contradicted a
sentence already in the same file:

- `Shift+T` "cycle the type tools in the flyout group" — the type tile is a **single entry**
  (`toolbar-mapping.ts:108`), and the `t` registration passes no `shift`
  (`AppKeyboardShortcuts.tsx:384-389`), so `Shift+T` simply re-selects the same tool. The
  file says so in its own comment at `:451-452`: "there is nothing to cycle, so a
  `shift: true` twin would select the same tool twice". The data file now carries that as a
  `shortcuts` row rather than only as an omission.
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
- https://helpx.adobe.com/photoshop/using/line-character-spacing.html — the tracking unit,
  "Tracking and kerning are both measured in 1/1000 em… 100 tracking units in a 10-point font
  are equivalent to 1 point"
- https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html
- https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html
- https://helpx.adobe.com/photoshop/using/layers.html
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

Fifteen controls. `present` 0 · `partial` 4 · `inert` 0 · `missing` 11.

| #   | Control                         | Status    | `appRef`                                        |
| --- | ------------------------------- | --------- | ----------------------------------------------- |
| 1   | Tool preset                     | `missing` | —                                               |
| 2   | Aspect ratio menu               | `partial` | `src/components/ToolbarsRight/Crop/Crop.tsx:61` |
| 3   | Swap Width and Height values    | `missing` | —                                               |
| 4   | Clear                           | `missing` | —                                               |
| 5   | Overlay                         | `missing` | —                                               |
| 6   | Straighten                      | `missing` | —                                               |
| 7   | Grid                            | `missing` | —                                               |
| 8   | Settings (gear) menu            | `missing` | —                                               |
| 9   | Delete Cropped Pixels           | `missing` | —                                               |
| 10  | Use Classic Mode                | `missing` | —                                               |
| 11  | Auto Center Preview             | `missing` | —                                               |
| 12  | Show Cropped Area               | `partial` | `src/hooks/useRect.ts:223`                      |
| 13  | Enable Crop Shield              | `partial` | `src/hooks/useRect.ts:223`                      |
| 14  | Fill (incl. Content-Aware Fill) | `missing` | —                                               |
| 15  | Done / Cancel                   | `partial` | `src/components/ToolbarsRight/Crop/Crop.tsx:79` |

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

The two `appRef` numbers the crop rows share are both the fixed 0.7 dim in `drawMask`
(`useRect.ts:223` is the `hideBlend` guard, `:226` the fill itself), which is the finding
rather than a duplicate citation — see the argument below.

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
  (`useRect.ts:223`, with the fixed fill at `:226`): it is always on, its opacity is fixed at
  0.7 rather than the adjustable figure Adobe documents, and its color is not configurable.
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
draws that" — false twice over. The app does draw a dim: the mask at `useRect.ts:223-231` fills the
whole canvas with `rgba(0, 0, 0, 0.7)` and then clears the crop rect, and `CropToolArea` passes no
`hideBlend`, which is the only flag `drawMask` consults (`useRect.ts:223`), so that branch runs whenever
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
`Crop.tsx:40,48` and cleared on both write paths, `aspectRatio` by `CropToolArea.tsx:21`
and passed into `useRect`, `rect` by every writer. The `preRatioRect` field is a
regression-repair field, not a user-facing control, so it has no Photoshop counterpart to be
`inert` about.

### Is the app's crop destructive?

**It is not — and the previous pass said the opposite.** `src/contexts/useLayer.ts:644`
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

### What kind of commit a crop is, and which handoff entries touch it

**A crop is a document-frame history entry, and the raster trim the tool declares is
unreachable.** The crop processor is registered as `commit: 'document-operation'`
(`src/tools/toolProcessors.ts:146-151`), and every layer path refuses that commit kind:

| Refusal                               | What it refuses                                           |
| ------------------------------------- | --------------------------------------------------------- |
| `src/contexts/useLayer.ts:335`        | painting the tool onto a layer, before any history append |
| `src/contexts/history-replay.ts:215`  | replaying the tool into a layer                           |
| `src/contexts/history-adapter.ts:549` | converting the tool into a durable layer                  |

So `src/tools/crop.ts:26` — the `imageProcessor` that trims the bitmap — is declared and never
called. What actually commits is `applyDocumentCrop`, and it is a document edit, not a layer.
This is the load-bearing reason the crop is `partial` rather than `implemented`: the tool
performs a document operation Photoshop also performs, but by a route no other tool uses, with
its own processor branch dead.

**Two handoff entries were checked against the crop, and neither bears on it.** `HANDOFF.md`
§68 ("A committed shape is painted twice, and its preview and its commit use different
coordinate spaces", `HANDOFF.md:1575`) names `src/components/Main/ShapeToolArea.tsx` in its
first sentence and its last: it is about the shape tool's overlay and its canvas-versus-document
coordinate space, and the crop never paints through that overlay. The crop's preview is the
tool overlay drawn by `drawMask` and its commit is `applyDocumentCrop`, which converts through
`canvasRectToDocumentFrame` — a different code path from the one §68 describes.
`docs/handoffs/ps-transform-geometry-review-and-merge.md` mentions the crop exactly once, in
passing, about Perspective Crop being genuinely projective; it is a trapezoid/projective
transform review and says nothing about the crop's commit or history. Neither entry changes a
claim in `type-crop.ts`, and neither is a live crop defect.

### Five interaction divergences

- **Dragging inside the box moves the box, not the image.** `useRect.ts:342-350` translates
  the rect by the drag delta for its `inside` edge, and the branch at `useRect.ts:454-461`
  that would instead adopt the layer under the pointer never runs, because
  `CropToolArea.tsx:61-81` passes `useRect`'s handlers straight through without a
  `layerUnderPointer`. Photoshop's contract is the opposite way round.
- **Extending the crop cannot add canvas.** `usePointerPosition.getLocalCoords` does not
  clamp, so the rect can be dragged past the image edge — but `trimRect`
  (`src/util/rect.ts:36-60`) clamps every edge to the document, so the extra area is simply
  cut off. In Photoshop, dragging a handle outward past the photo grows the canvas, and what
  fills it is what the `Fill` control selects.
- **The pending rect is DISCARDED by a tool switch, not written through.** The previous pass
  claimed the draft "survives a tool switch", and the file's own comment said the opposite in
  as many words. The crop arm of `saveLastSettings` (`src/util/settings.ts:39`) persists
  `omit(args, 'rect', 'preRatioRect')` — the draft rect and the pre-ratio rect are stripped
  before the write, with a comment saying they are "both presentation state" — so
  `lastSavedSettings.crop` holds only the aspect ratio. `goToTool`
  (`src/hooks/useApp.ts:169`) commits the dirty tool, and `useCurrentTool.tsx:49-50` re-seeds
  the crop from those persisted settings, which no longer hold a rect. Switching away and back
  therefore throws the draft away. Of Photoshop's two behaviours this is much closer to
  cancel-on-Escape than to commit-on-switch, and the aspect ratio _is_ sticky, which is
  probably what the earlier reading mistook for a surviving draft.
- **Shift is honoured on any modifier.** `useRect.ts:156` locks the aspect ratio when
  `ctrlKey || metaKey || shiftKey` is set, and reads the lock at `useRect.ts:337`. So the
  `Shift` row of the `modifiers` array is `present` in substance but over-broad in binding,
  and there is no Alt from-center drag anywhere — which is why the `Alt` and `Alt+Shift` rows
  of that array are aspirational and are described as Photoshop's rather than the app's.
- **The crop owns no keyboard shortcut of its own, and one line of it is not a table
  registration.** `C` comes from the shared table (`AppKeyboardShortcuts.tsx:362-367`), and
  `Enter`/`Esc` come from the raw `window` listener described in the next section rather than
  from `useKeyDownShortcut`. Everything else Photoshop binds for the crop is absent, and two of
  them are actively harmful to repeat. Detail in the next section.

### Which Photoshop crop keys the app actually binds

**`C` from the shared table, plus `Enter` and `Esc` from a raw window listener inside the tool
area.** The second clause is new on this pass and it reverses what this file previously said.
The `useKeyDownShortcut` table is the one given for the type tool above —
`AppKeyboardShortcuts.tsx` (letters only: `b c e g i j l m o p s t u v w y z`, plus shift and mod
variants), the two lasso tool areas and the font popup, and those are every call site of that
hook in `src/`. **It is not the whole of the app's key handling**, and for the crop specifically
it is the wrong place to look: `CropToolArea.tsx:51-59` attaches its own `window` `keydown`
listener and handles `Enter` and `Escape` there, with the reason written out at `:23-34` —
`Main` mounts the area only while the crop tool owns the gesture surface, so the binding is
scoped to the tool by construction and needs no table entry. The commit it fires is
`applyDocumentCrop` (`:40`), the same call the panel's `Apply` makes. An earlier version of
this section concluded from `CropToolArea` calling no `useKeyDownShortcut` that Enter and Esc
were unbound, which is the table's absence being read as the app's.

| Photoshop key        | What the app actually does                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Shift+C`            | The crop tile is a **single entry** (`toolbar-mapping.ts:59`), and the `c` registration passes no `shift` (`AppKeyboardShortcuts.tsx:362-367`), so this re-selects Crop. There is no flyout to cycle, and Perspective Crop, Slice and Slice Select are not in `ToolArgsByName` at all.                             |
| `Enter` / `Return`   | **Works, outside the table.** `CropToolArea.tsx:53` commits the pending rect and clears `rect`/`preRatioRect`; `PolygonClickToolArea.tsx:931` and `FeatherMagneticLassoToolArea.tsx:552` own the table registrations, for the lasso tools.                                                                         |
| `Esc`                | **Works, outside the table.** `CropToolArea.tsx:54` drops the draft rect and restores the previous framing. `Escape` is also registered in the two lasso areas and in the font popup (`FontSelect.tsx:54`), and handled raw by the transform box (`Transform.tsx:37`), the two dialogs and the layer-rename field. |
| `O`                  | **Switches tools.** `AppKeyboardShortcuts.tsx:436-441` binds `o` to `selectTonalTool`, whose group is `['dodge', 'burn']` (the fallback at `:185`). Pressing it while cropping leaves the crop for the Dodge tool, which is the opposite of cycling an overlay.                                                    |
| `Shift+O`            | Same handler with `shift: true` (`:443-449`), so it also leaves the crop — it toggles between Dodge and Burn.                                                                                                                                                                                                      |
| `X`                  | Unbound. There is no `x` registration anywhere in `src/`; `matchesShortcut` is case-insensitive (`useKeyboardEvents.tsx:29`), so this is not a capitalisation miss.                                                                                                                                                |
| `Backspace`/`Delete` | Bound only in the two lasso tool areas (`PolygonClickToolArea.tsx:945,953`, `FeatherMagneticLassoToolArea.tsx:566,574`), and only to remove the last draft anchor.                                                                                                                                                 |
| `Ctrl`/`⌘` + drag    | `useRect.ts:156` reads Ctrl and Command to **lock the current aspect ratio** — the behaviour the `Shift` modifier row already describes. It never reaches a Straighten tool; there is none.                                                                                                                        |

So the data file's `shortcuts` array now carries eight rows — `C`, `Shift+C`, `Enter`, `Esc`,
`X`, `O`, `Shift+O` and `Backspace` — each naming what the app does instead, rather than
describing Photoshop's key and leaving the app's answer in `appNotes`. `appNotes` still states
the absence of the rest, with `O`/`Shift+O` called out as tool switches rather than as no-ops,
and Enter/Esc called out as real rather than missing. The Photoshop-side provenance for these
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
   - **The corpus figure was wrong, not just differently-shaped.** `01-photoshop-reference.md:480`
     gives `1–1296`. Adobe gives `0.01 .. 1296`. The lower bound is a float, and it is the whole
     difference between the two: a whole number from 1 is Adobe's bound with the fractional end
     rounded away. That file is not this one's to edit, so the disagreement is reported and left.
   - **What was corrected, and where.** The `Size` row carries the range again, with the
     citation, and it states the 0.01 fractional bound explicitly rather than folding it into a
     round number. `AUTO_LEADING`'s 120% and `CharacterStyle.tracking`'s -1000..1000 come from the
     same page family and the same pass, and `JustificationProperties.autoLeadingAmount` and the
     `Underline` constant enum were added to `sources` for the leading and underline claims.
   - **Why the entry is deleted rather than rewritten:** an item under `## Unverified` is by
     definition a claim this file cannot source, and this one is now sourced. Leaving a resolved
     item in the list teaches the next reader that `sources` is not load-bearing.
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
    reads those two keys for the opposite operation (aspect-ratio lock, `useRect.ts:156`).
    **The inherited pass put the clause back** into the `modifiers` array — as "held on its own
    it invokes the Straighten tool without visiting the bar", extended with "Shift while
    rotating → 15-degree increments" and "Ctrl while rotating → prevents the crop box from
    shrinking" — while `appNotes` simultaneously called those very rows aspirational. That is
    the same file asserting a modifier and disclaiming it. All three rows are **left in the
    array** because they are plausibly the modifier table on `crop-tool-options.html`, which is
    already in `sources`, and because `modifiers` documents Photoshop rather than the app; but
    **none of the three was re-opened on this pass**, so treat them as unverified rather than
    settled. Either find the table or delete the rows — do not leave them half-asserted.
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
    from the pages. **The inherited pass noticed this and then asserted the loose page anyway**,
    quoting `crop-image.html` — "hover outside a corner to rotate the crop box … To move the
    crop box, drag it from inside" — inside `purpose`, while `appNotes` said the divergence was
    "not settled". `purpose` now quotes both Adobe pages and states that the bar-page
    behaviour is the one asserted and the product-page reading left open.
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
