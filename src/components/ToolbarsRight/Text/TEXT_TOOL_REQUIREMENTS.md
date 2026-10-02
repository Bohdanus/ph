# Text Tool — Requirements

What the Adobe Photoshop Type tool does, and what this editor must do to be faithful to it. This
is a **requirements** document: it states target behaviour and marks what exists today. It is not
an implementation plan and it ships no code.

**Part of this has shipped.** This document opened by saying nothing in it was implemented. That
sentence was true of the commit that added the file and is false of the tree now. The short
version:

- **Shipped** — the Adobe range and unit for the Size field and for Tracking; a default leading
  that reproduces Adobe's 120% auto-leading; tracking, All Caps, Small Caps, Underline and
  Strikethrough on the bar and in the renderer; and the rewrite of the renderer that made them
  possible (a corrected `ctx.font` shorthand, `textBaseline: 'alphabetic'`, and ink-width
  anchoring). §19 is the item-by-item record; §20 is the measured Canvas 2D behaviour those
  choices rest on; §21 is why each choice was made and what it costs.
- **Not shipped** — everything structural. There is still **no edit mode**, **no caret**, **no
  click-versus-drag distinction**, **no placeholder text**, **no wrapping**, **no per-character
  or per-paragraph style**, and **no vertical type**. Those are the `GAP` rows in §2, §3, §4, §6,
  §7 and §9, and they are unchanged.

So the status rows are now split: the character-formatting rows in §5 have largely been converted
from `PARTIAL`/`GAP` to `HAVE`, and the interaction rows have not moved at all. §16 is renumbered
to list only what has not landed.

Researched 2026-09-30; re-researched and re-derived 2026-10-01. Sources in
[§22](#22-sources). Every claim about this repository was re-verified against the tree in this
worktree; every claim about Photoshop is either quoted from Adobe or labelled third-party.

**Status legend.** `HAVE` — implemented. `PARTIAL` — implemented, narrower than the requirement.
`GAP` — not implemented. `OUT` — deliberately not implemented, with the reason.

---

## 0. Corrections to the previous version of this document

The previous revision of this file (landed `54f2b212`) carried claims that the tree has since
outgrown. They are recorded here rather than silently corrected, because a stale requirements doc
is worse than none — it sends the next session to verify a defect that is already gone.

| #   | Stale claim                                                                                                              | The truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "There is no colour control on this bar at all: the type fill is slaved to the global foreground swatch."                | **False.** `Text.tsx:219` renders `<input id="text-color" type="color">`, and `Text.tsx:83-93` documents the reversal deliberately: the bar owns the colour and the store's foreground no longer overwrites it. `Text.test.tsx:521-561` and `TextToolArea.test.tsx:201-233` pin ownership, and `e2e/text-tool.spec.ts:290-308` drives the e2e through `#text-color`. The divergence from Photoshop is narrower: Photoshop also binds `Alt+Backspace` to the foreground colour. |
| 2   | "the layer renderer re-runs a tool's creator only for the six shape tools … so its retained args are never re-rendered." | **True of the runtime path, false unqualified.** `layer-renderer.ts:32` does list six tool names with `text` absent, so the runtime draws from `layer.bitmap`. But the **durable** materializer re-runs the text creator from the retained args (`materialization.ts:166-171`), pinned at `materialization.assets.test.ts:499-516`. "Never re-rendered" describes one of two engines.                                                                                          |
| 3   | "Tests … jsdom only"                                                                                                     | **False.** `e2e/text-tool.spec.ts` exists — 557 lines, 4 tests, covering the drag, the Apply gate, the committed layer row, and the committed ink.                                                                                                                                                                                                                                                                                                                             |
| 4   | "`Text.tsx` … 221 lines"                                                                                                 | It is 336. Several other line references in the old §1 table drifted the same way.                                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | Hyphenation "Words Longer Than N Letters (default 2)"                                                                    | **Default is 5.** Verified against Adobe's own `HyphenationProperties` reference, which documents `wordsLongerThan: 5`, `range [2, 25]`. The value 2 is a CS-era figure still repeated in third-party tutorials.                                                                                                                                                                                                                                                               |

**§0 is itself now partly superseded, and that is the point of keeping it.** Items 1–4 describe
code this revision then changed again: `Text.tsx` has grown from 241 lines to 336 and every line
number in the table above has been moved again, item 4 is now wrong by a second revision rather
than one, and item 1's corrected claim ("the bar owns the colour") is still true while its
citations are not. Item 5 is a **fact about Photoshop** and does not age with the tree — it is the
only row above that will still be true when the next session reads it, and it is the model for
how §19 and §22 are written. §19 records this revision's supersessions the same way.

Item 1's source is `src/tools/descriptions/type-crop.ts:123-125` (`appNotes`), which is what
`docs/TOOLS.md` is generated from — so `docs/TOOLS.md` carries the same false sentence. Fixing the
generated doc means fixing the data file, and a test fails on drift between them.

**That fix landed in a concurrent session, mid-way through this revision, and §0 item 1's line
numbers are stale because of it.** At the time this section was written, the text tool's
`appNotes` still carried three more sentences this revision had made false — an 8–500 size range, a
1.1 default leading, and the bare `Text.tsx:184` reference. As of this writing all three are gone
from the file and the `appNotes` string moved from `:115` to `:123`. **Verify the current line
number before citing it**; the substance of item 1 is unaffected, because the correction it records
was to the _description data_, which is a different file from the options bar `Text.tsx`.

---

## 1. Current state of the tool

| Area             | File                                                          | What it owns                                                                                                    |
| ---------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Args + rendering | `src/tools/text.ts:63-88`, `:287-329`, `:331-351`, `:353-361` | `TextToolArgs`, `ResolvedTextStyle`/`resolveTextStyle`, `renderText`, `getTextWidth`, the `text` creator        |
| Adobe constants  | `src/tools/text.ts:14-34`                                     | `FONT_SIZE_MIN/MAX`, `TRACKING_MIN/MAX`, `AUTO_LEADING`, each carrying its Adobe citation in place              |
| Renderer helpers | `src/tools/text.ts:150-285`                                   | `fontShorthand`, `trackingPx`, the two feature tests, `applyTextStyle`, `inkWidth`, `fillLine`, the decorations |
| Registry entry   | `src/tools/toolProcessors.ts:160-166`                         | `commit: 'source'`, `creator: true`                                                                             |
| Toolbar          | `src/components/ToolbarsRight/Text/Text.tsx:23-336`           | textarea, font, size, leading, tracking, colour, align, six toggles, Apply/Clear                                |
| Font picker      | `src/components/ToolbarsRight/Text/FontSelect.tsx`            | 14 hard-coded families (`FontSelect.tsx:5-20`), hover preview, Escape/outside-click revert                      |
| Canvas area      | `src/components/Main/TextToolArea.tsx:24-59`                  | `useRect` wiring, overlay repaint, textarea focus                                                               |
| Rect growth      | `src/util/rect.ts:116-173`                                    | `calculateNewRect` — grows to fit, never wraps, never shrinks (`:145`)                                          |
| Commit           | `src/contexts/useLayer.ts:278-321`, `:365-381`                | `createLayerFromTool`; `commitDirtyTool` and its text branch at `:369-381`                                      |
| Settings         | `src/tools/settings.ts:83-100`, `src/util/settings.ts:30-31`  | the `text:` seed; persistence deliberately omits `text` and `rect`                                              |
| Graphemes        | `src/util/string.ts:19-21`                                    | `graphemes()`, the new export the manual tracking fallback draws on                                             |

Two things about that table are new and both are consequences of §7. The tool is **still one flat
`TextToolArgs` record with no per-run or per-character structure**, and it is now a flat record
with **twelve resolved style fields** instead of seven, which is what §19 records. And `getTextWidth`
is now bracketed in `save`/`restore` (`text.ts:340-350`), because `calculateNewRect` hands it the
live tool overlay — see §21.

---

## 2. What a click does today — and what Photoshop's click does

This is the behaviour the naive description gets most wrong, so it is worth stating precisely.

**In this app, a click already places a box.** There is no click-versus-drag distinction in the
code path. `TextToolArea.tsx:137` spreads only `useRect`'s pointer events, and
`useRect.ts:493-518` computes `onChangeEnd` on every valid release with no minimum-distance check.
With a press and release at the same point and no existing rect, `calculateMaskRect` (`useRect.ts:331`)
takes the fresh-point branch and `adjustFreePoint` (`:284-300`) returns a **zero-area rect**. That
zero-area rect then reaches `calculateNewRect`, whose `!text` branch (`rect.ts:131-137`) _widens_
it to roughly `2 × (fontSize × lineHeight + 2 × TEXT_PADDING)` px at the click point. So a bare
click produces a real, non-degenerate draft box and focuses the textarea.

`src/util/__tests__/rect.test.ts:213-229` pins that widening branch as load-bearing. It is unchanged
by this revision: `calculateNewRect`'s `!text` branch still turns a zero-area drag into a
non-degenerate box (`rect.ts:131-137`), which is what makes the overlay mask visible before anything
is typed.

**No text is ever auto-created.** `args.text` stays `''`, `Apply` stays disabled
(`Text.tsx:325`), and no layer is created. A repo-wide grep for `lorem`, `placeholder` and
`Enter text` returns exactly one production hit — the HTML `placeholder` attribute at
`Text.tsx:123`, which is a DOM hint and never becomes a layer. (`Text.tsx:125` also contains the
token, as a Tailwind `placeholder:` colour variant, which is CSS rather than an attribute.)

**Photoshop behaves differently, and the difference is a requirement** ([creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), Adobe):

- A **click** places **point type** — a line that expands and shrinks with the text and
  **never wraps**. A **drag** places **paragraph type** — a bounding box whose lines wrap and
  reflow on resize. The app has one kind, and its box does not constrain the text at all.
- **A layer is created immediately**, containing **placeholder text** that previews font, size
  and colour, and that is **pre-selected so typing replaces it**. This is a real preference:
  `Fill new type layers with placeholder text` under `Preferences > Type`
  ([add-edit-text](https://helpx.adobe.com/au/photoshop/using/add-edit-text.html), Adobe — the
  route moved to `Settings > Type` in 23.0). There is also a `Type > Paste Lorem Ipsum` command.
- **Clicking again creates a second layer** — unless the click lands inside an existing text
  flow, which enters that layer instead. `Shift`-click forces a new layer even when close to
  another (third-party walkthrough of Adobe's own behaviour;
  `https://jkost.com/blog/2020/09/30-tips-tricks-and-shortcuts-for-working-type-in-photoshop.html`).
- **Overflow indicator.** When text outgrows a paragraph box, "a small box or circle containing a
  plus symbol (+) appears in place of a handle in the corner of the boundary"
  ([creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), Adobe).

**Requirements**

- `GAP` — **click/drag distinction.** Point type on click, paragraph type on drag. The threshold
  must be an explicit movement test; `useRect` has none today, and its shared consumers (crop,
  Move, all selections) must keep their current behaviour.
- `GAP` — **placeholder text.** A new type layer is born with placeholder text pre-selected, so
  typing replaces it rather than appending. The preference must gate it.
- `GAP` — **second click creates a second layer**, and a click inside an existing text flow
  enters it instead.
- `GAP` — **overflow indicator** on the box.
- `PARTIAL` — the box exists and is placed by pointer; it is a growth rect, not a layout box.

**This is the single largest fidelity gap in the tool.** "Click to place type, type to replace it"
is the tool's primary interaction and the app has none of it.

---

## 3. Edit mode, commit, cancel

**In this app there is no edit mode, and this revision did not change that.** `Text.tsx:98-105`
`applyText` is the commit, and it is a one-shot "type into the textarea, press Apply, get a raster
layer". There is no way back into a placed layer to change a character, and no way to cancel a
partially-typed layer — `clear()` (`Text.tsx:107-109`) discards the pending draft. Nothing in §19
touched this section's rows.

One Adobe commit path _is_ already present: switching tools commits the draft implicitly, because
`goToTool` calls `commitDirtyTool()` first (`src/hooks/useApp.ts:167-169`).

**What Photoshop does.** Adobe enumerates the commit paths across **two** pages, and the split
matters — a previous revision of this document presented them as one helpx list.

| Path                                                                         | Adobe source                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Commit button in the options bar                                             | [creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), verbatim |
| **`Ctrl+Enter` / `Cmd+Return`**                                              | [creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), verbatim |
| **numeric-keypad `Enter`**                                                   | [creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), verbatim |
| select any tool in the toolbox; click a panel; any menu command              | [creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html)           |
| **`Esc`** — which **commits by default**                                     | [editing-text](https://helpx.adobe.com/photoshop/using/editing-text.html)             |
| clicking away on the canvas, watching the cursor become a normal arrow first | [editing-text](https://helpx.adobe.com/photoshop/using/editing-text.html)             |
| moving focus to another application — commits automatically                  | [editing-text](https://helpx.adobe.com/photoshop/using/editing-text.html)             |
| Cancel button, or `Esc` **if** the preference is off                         | [editing-text](https://helpx.adobe.com/photoshop/using/editing-text.html)             |

`creating-type` reads: "Click the Commit button in the options bar. **Press the Enter key on the
numeric keypad. Press Ctrl+Enter (Windows) or Command+Return (Mac OS).** Select any tool in the
toolbox; click in the Layers, Channels, Paths, Actions, History, or Styles panel; or select any
available menu command." So `Ctrl/Cmd+Return` and keypad `Enter` are **Adobe helpx**, not the
Adobe-staff blog or Elements. What _is_ third-party is the double-click-the-`T`-thumbnail entry
route, which has no helpx citation, and what is Elements-only is the
[`Ctrl+Shift+J` / `Ctrl+Shift+F` justify shortcuts](https://helpx.adobe.com/photoshop-elements/desktop/adding-shapes-and-text/add-text.html).

- Edit mode has **exactly one visual tell**: the options bar shows the **Commit** and **Cancel**
  pair. "To determine whether a type tool is in edit mode, look in the options bar — if you see
  the Commit button and the Cancel button, the type tool is in edit mode."
- **Entry**: click the text flow with a type tool; double-click the layer on canvas with the Move
  tool; or **double-click the `T` thumbnail in the Layers panel** — that last one enters edit mode
  **with all characters selected**.
- **`Esc` COMMITS by default** — Adobe's own note: "Note that the Esc key is set to commit text by
  default. You can change this to cancel the changes by going to Edit > Preferences > Type
  (Windows) or Photoshop > Preferences > Type (MacOS) . Then uncheck Use Esc key to commit text."
  Every pre-CC-2017 shortcut sheet and most third-party tutorials still say Esc cancels; the
  current default is the opposite, and the preference is why.
- Commit is **not** available by keyboard alone when the default is on: Esc commits, so cancel is
  reachable only from the button.

**Requirements**

- `GAP` — edit mode as a state, with the Commit/Cancel pair appearing only inside it.
- `GAP` — re-entering an existing type layer to change characters. **This is the blocking
  requirement for everything in §4 and §6.**
- `GAP` — cancel of an in-progress edit.
- `GAP` — `Ctrl/Cmd+Return`, keypad Enter, and Esc bound to commit/cancel. Note the app's own
  trap: the textarea holds focus as soon as the tool is selected (`TextToolArea.tsx:41-43`), and
  `useKeyboardEvents.tsx:136` refuses any shortcut without `allowInInput` while a field has
  focus — so `T` pressed mid-draft types a letter today.
- `GAP` — the `T` thumbnail and double-click-to-edit in the Layers panel.
  `src/components/SidebarRight/LayersTab.tsx` has **no `onDoubleClick`** at all; the only editable
  field there is the layer _name_.
- `OUT` — the `Use Esc key to commit text` preference as a user setting. It exists to serve a
  modal transform state; this app has no need for it. Bind Esc to commit, matching the default.

---

## 4. Selection and caret

**Photoshop's selection ladder inside a text flow**
([formatting-characters](https://helpx.adobe.com/photoshop/using/formatting-characters.html), Adobe):

| Gesture                  | Selects                            |
| ------------------------ | ---------------------------------- |
| Click                    | The insertion point                |
| Double-click             | The word                           |
| Triple-click             | The line                           |
| Quadruple-click          | The paragraph                      |
| Quintuple-click          | All characters in the bounding box |
| Drag / `Shift`-click     | A character range                  |
| `Shift`+`←`/`→`          | One character at a time            |
| `Shift`+`↑`/`↓`          | One line at a time                 |
| `Ctrl/⌘`+`Shift`+`←`/`→` | One word at a time                 |

Adobe states the caret/selection rule that gates two Character-panel fields: "When you click to
place the insertion point between two letters, **kerning** values appear in the Character panel.
Similarly, if you select a word or a range of text, the **tracking** values appear"
([line-character-spacing](https://helpx.adobe.com/photoshop/using/line-character-spacing.html),
Adobe).

**Requirements**

- `GAP` — caret placement and character-range selection. There is no caret model in the app.
- `GAP` — the click-count ladder.
- `GAP` — the caret-dependent Kerning/Tracking field swap.
- `GAP` — IME. Any caret model must be composition-aware from the start. The browser owns
  composition; the caret is real but hidden during it, and `keydown` must not be intercepted for
  ordinary input. The commented-out scaffolding at `TextToolArea.tsx:61-135` shows the previous
  approach, and it was wrong for this reason — it is a sketch, not a reference.

**A ready-made foundation exists, and it is now half-used.** `src/util/string.ts` provides
`charLength`, `deleteCharAt`, `deleteLastChar` and `ellipsify`, all **grapheme-cluster-safe** via
`Intl.Segmenter` (`string.ts:1-3`), all fully tested (`src/util/__tests__/string.test.ts`). This
revision added a fifth export, `graphemes()` (`string.ts:19-21`), which returns the clusters
themselves — the other three index by cluster, so a caller iterating the same way they measure needs
the clusters rather than `[...str]`, which splits by code unit and separates a combining mark from
its base.

| Export                       | Line                      | Production consumer                                                              |
| ---------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `graphemes`                  | `string.ts:19-21`         | **`text.ts:256,277`** — the manual tracking fallback draws one cluster at a time |
| `charLength`, `deleteCharAt` | `string.ts:5-7`, `:33-48` | **none** — only the commented-out caret block at `TextToolArea.tsx:102,126`      |
| `deleteLastChar`             | `string.ts:23-31`         | **none** — same                                                                  |
| `ellipsify`                  | `string.ts:50-63`         | unrelated callers                                                                |

So the orphan problem narrowed rather than went away: `charLength`, `deleteCharAt` and
`deleteLastChar` were written for the caret work, abandoned with it, and still have no production
consumer. Reuse them rather than reaching for `.length` or `.slice()` on a code-unit index. Note
that `string.test.ts` does **not** import `graphemes`: the new export is exercised only through
`text.test.ts`, on the fallback path.

`graphemes` is not a substitute for the caret model and does not move §4's rows. A caret needs to
know where the clusters **are on the canvas**, which is a glyph hit-test against
`measureText` prefixes — `graphemes` gives the indices, and nothing gives the positions.

---

## 5. Character formatting

Re-verified 2026-10-01 against Adobe's `CharacterStyle` reference, which states every default and
range explicitly and is the authoritative source for the numbers. Nothing in the table changed; the
table's row labels are `CharacterStyle` property names.

| Control                   | Range                     | Default           |
| ------------------------- | ------------------------- | ----------------- |
| Size                      | `0.01..1296` px @72ppi    | —                 |
| Leading                   | `0..4999.99` px @72ppi    | `null` (Auto)     |
| Tracking                  | `-1000..1000` (1/1000 em) | —                 |
| Baseline Shift            | `-1296..1296` px @72ppi   | —                 |
| Vertical Scale            | `0..1000` %               | —                 |
| Horizontal Scale          | `0..1000` %               | —                 |
| Auto kerning              | `AutoKernType`            | `METRICS`         |
| Anti-alias                | `AntiAlias`               | `SHARP`           |
| Faux Bold / Faux Italic   | boolean                   | `false` / `false` |
| Standard ligatures        | boolean                   | `true`            |
| Capitalization            | `NORMAL`                  | `NORMAL`          |
| Underline / StrikeThrough | `NONE` / `STRIKEOFF`      | as listed         |

Load-bearing facts:

- **Explicit leading is a LENGTH, not a multiple of the size.** `CharacterStyle.leading` is
  `0..4999.99`, "The leading amount in pixels for a 72ppi document", defaulting to `null` for Auto.
  Only **auto**-leading is a percentage of the type size. A previous revision of this section
  described the leading control as a multiple; that was wrong, and it is the same category of error
  as calling Tracking points.
- **Tracking is 1/1000 em**, relative to the current type size. Adobe's own example, verbatim:
  "Tracking units are 1/1000 of an em space. The width of an em space is relative to the current
  type size… So for example, 100 tracking units in a 10-point font are equivalent to 1 point." It is
  not points and not pixels.
- **Manual kerning requires the insertion point between two characters.** With a range selected it
  is unavailable and you must use tracking instead. "Tracking and manual kerning are cumulative."
- **Metrics kerning is Adobe's default**, in Adobe's words: "**Metrics kerning is set as the
  default** so that specific pairs are automatically kerned when you import or type text"
  ([line-character-spacing](https://helpx.adobe.com/photoshop/using/line-character-spacing.html)).
  That matches `CharacterStyle.autoKerning` = `METRICS`. Note this is about **auto** kerning; the
  per-pair manual control is a separate field.
- **Underline and strikethrough are always the same colour as the type.** Adobe, verbatim: "Place a
  line under horizontal type or to the left or right of vertical type… **The line is always the same
  color as the type color.**" ([formatting-characters](https://helpx.adobe.com/photoshop/using/formatting-characters.html))
  There is no underline-thickness or offset control in Photoshop — the Underline Options dialog is
  InDesign-only, and the `Underline` enum is `NONE / LEFTINVERTICAL / RIGHTINVERTICAL` with no style,
  weight, offset or colour of its own
  ([`constants`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants)).
- **Size sets the em, not the cap height.** The bound is an **input-field clamp, not a rendering
  clamp** — Free Transform exceeds 1296pt. At 300ppi the maximum becomes `(300/72) × 1296 = 5400`.

**Anti-aliasing — RESOLVED, and the previous "unconfirmed" is now settled.** Five levels: None,
Sharp, Crisp, Strong, Smooth, each with a `constants.AntiAlias` value. The control was **removed
from the type options bar in Photoshop 26.10**, and this is no longer a rumour: in an Adobe
employee's own reply on Adobe's community forum, "Thanks to you all for the feedback on **removal
of anti-alias dropdown to tool options**, bringing this dropdown back is definitely under
consideration. In the meantime, locations like right clicking on text on canvas…, the Properties
and Character panels, and Type menu are places these settings can still be accessed."
([the thread](https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044)).
It is a forum statement by an Adobe employee, not a helpx page, so it is cited as such and **not**
as Adobe documentation. Adobe's helpx page is dated 2023-09-20 and still lists all three routes —
**it is stale on this point and should not be read as evidence the pull-down is current.** The
Narrow Options Bar preference is the more commonly reported _user-side_ cause of a control appearing
missing, and it is a separate thing from the 26.10 removal.

**Faux Bold / Faux Italic are Character-panel controls in Photoshop.** `CharacterStyle.fauxBold`
reads, verbatim: "True to use Faux Bold. Setting this to true is **equivalent to selecting text and
clicking Faux Bold in the Character panel**." Same for `fauxItalic`. The only Adobe page that puts
Faux toggles on a **type options bar** is
[Photoshop Elements' type tool options](https://helpx.adobe.com/photoshop-elements/desktop/adding-shapes-and-text/add-text.html)
— a different product with a different bar. **So there is no Adobe basis for a Faux toggle on the
Photoshop Type options bar, and this app does not ship one.** §19 records that the app ships true
`bold`/`italic`, which is a different thing again (see below).

**Adobe documents no left-to-right order for the Photoshop Type options bar.** The one Photoshop
page that mentions it at all,
[Horizontal and vertical type tool options](https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html),
says only "Use the Options bar to customize tool settings, like Font Style, Font Size, and, Text
Color, to get the effect you want." That is a list of three examples, not an order. **The order this
app's bar ships in is a design decision of this app** (`Text.tsx:112-331`), pinned as a tab order at
`Text.test.tsx:644-689` because it is a real accessibility property — not because Adobe specifies it.

**Requirements**

- `HAVE` — font family, size, bold, italic, colour, and a per-layer colour swatch. _(unchanged by
  this revision)_
- `HAVE` — **tracking**, `-1000..1000` in 1/1000 em, applied as `ctx.letterSpacing`, with a
  measured manual fallback (`text.ts:195-197`, `:248-260`, `:271-281`). §20 and §21.
- `HAVE` — **All Caps** and **Small Caps** as separate booleans via `ctx.fontVariantCaps`
  (`text.ts:198-207`). Chrome synthesises, and `'small-caps'` synthesises only the lowercase, which
  matches Adobe's rule (§20).
- `HAVE` — **underline** and **strikethrough**, drawn in the type colour with `ctx.fillRect` at a
  thickness of `fontSize / 16` (`text.ts:283-285`, `:322-327`). **Their vertical positions are a
  RECONSTRUCTION of this app — §21.6. No Adobe page documents where the rule sits.**
- `PARTIAL` — the font list is **14 hard-coded families** (`FontSelect.tsx:5-20`), not a platform
  enumeration. The picker does render each entry in its own face (`FontSelect.tsx:203`), which is
  already Photoshop's WYSIWYG behaviour.
- `PARTIAL` — **size**: the **range is Adobe's** (`0.01..1296`, `FONT_SIZE_MIN`/`FONT_SIZE_MAX`,
  `text.ts:14-15`) and the control is a number field (`Text.tsx:150-168`) because a slider over a
  1296-wide span puts one point in about a hundredth of a pixel of track. **The unit is not
  Adobe's**: it is CSS px, applied by `fontShorthand` (`text.ts:151`). Photoshop's is **points** —
  "Points is the default unit of measurement for type" — and the app's canvas carries no document
  resolution, so a point has no denominator here. At 72ppi the two are 1:1. This is what keeps the
  row `PARTIAL` after the range landed.
- `PARTIAL` — bold/italic are booleans, not a style axis, and they now emit a **correctly ordered**
  CSS shorthand (`text.ts:150-152`; §19 item 1). Photoshop's model is family + style, with the
  family determining which styles exist; the app synthesises `bold`/`italic` prefixes. Faux Bold and
  Faux Italic — the case where the family has no true style — are `GAP` below.
- `PARTIAL` — leading is a unitless ratio `0.5..2.25` applied as `index * fontSize * lineHeight`
  (`text.ts:297`, `:308`). **The default is now 1.2** (`AUTO_LEADING`, `text.ts:34`; seed at
  `settings.ts:86`), which matches Adobe's `autoLeadingAmount`. **The semantics do not**: Adobe's
  explicit leading is a length and has an Auto mode, this app has neither. The default matching is
  why this stays `PARTIAL` rather than becoming `HAVE`, and the `useAutoLeading` conflict in §6 is
  why the 1.2 is not the last word on it.
- `GAP` — **manual kerning** (per-pair, caret-dependent). Auto kerning is not a `GAP`: Chrome's
  default is metrics kerning, which is Adobe's default too (§20 measured `AV` at -4.75px), but
  there is no control over the _type_, and Adobe's Optical is unreachable.
- `GAP` — **Faux Bold** and **Faux Italic**, as distinct from true `bold`/`italic`. §5 above.
- `GAP` — baseline shift, vertical/horizontal scale, superscript, subscript.
- `OUT` — anti-aliasing. Canvas 2D delegates glyph rasterisation to the platform and offers no
  selectable edge treatment. This is a **renderer limit, not a missing feature** — see §11. Note the
  removal above is _not_ the reason it is `OUT`: it was unavailable before 26.10 too, on the
  platforms that never had the control.

**Superscript/subscript defaults remain unsourced.** No Adobe page states the raise percentage.
Widely-repeated figures (33.3% raise, 58.3% size) trace to InDesign, which makes them
configurable, and to a Wikipedia row marked _citation needed_. Adobe confirms only the _shape_:
"If the font does not include superscript or subscript characters, Photoshop generates faux
superscript or subscript characters." **Do not treat any percentage as Adobe-documented.**

---

## 6. Paragraph formatting

From Adobe's `ParagraphStyle` and `JustificationProperties` references:

| Control                            | Range                   | Default              |
| ---------------------------------- | ----------------------- | -------------------- |
| Justification                      | `LEFT`                  | `LEFT`               |
| Left / Right / First-line indent   | `-1296..1296` px @72ppi | `0`                  |
| Space before / after               | `-1296..1296` px @72ppi | `0`                  |
| Hyphenation                        | boolean                 | `false`              |
| Word spacing min / desired / max   | `0..1000` %             | `80` / `100` / `133` |
| Letter spacing min / desired / max | `0..500` %              | `0` / `0` / `0`      |
| Glyph scaling min / desired / max  | `50..200` %             | `100`                |
| Auto leading amount                | `0..500` %              | `120`                |

The Min/Desired/Max triad is Adobe's own design and the semantics matter: **Min and Max bound
justified paragraphs only, while Desired governs both justified and unjustified.** Auto-leading
is the 120% default from §5, and it lives here rather than in Preferences — Adobe's route is
"Choose Justification from the Paragraph panel menu. For Auto Leading, enter a new default
percentage" ([line-character-spacing](https://helpx.adobe.com/photoshop/using/line-character-spacing.html)).

**An unresolved conflict between two Adobe references, recorded rather than settled.**
`JustificationProperties.autoLeadingAmount` is "Percentage of type size to use for auto leading",
default `120`. `CharacterStyle.useAutoLeading` is "True to use a **font's built-in leading
information**." Both are current, both are Adobe, and they do not agree about where leading comes
from — one says a percentage of the type size, the other says the font's own metrics. A previous
revision of this document resolved it silently by asserting the 120% was font-independent and
therefore exactly reproducible. **That assertion is withdrawn.** What this app ships is the number
`1.2`, which is the defensible reading of `autoLeadingAmount` and is what the Constant is named
after; it is **not** a claim that the two references agree. A font whose built-in leading is not
1.2em would render differently here than in Photoshop whichever reading is correct, and no Adobe
page says which reading wins.

Alignment is **Left / Center / Right** for horizontal type and **Top / Center / Bottom** for
vertical — and it is **paragraph type only**; point type must be converted first
([formatting-paragraphs](https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html), Adobe).

**Hyphenation** — six settings, all Adobe-documented, all dictionary-driven:

| Setting                     | Range               | Default |
| --------------------------- | ------------------- | ------- |
| Words Longer Than # Letters | `2..25`             | **5**   |
| After First # Letters       | `1..15`             | 2       |
| Before Last # Letters       | `1..15`             | 2       |
| Hyphen Limit                | `2..25`             | 2       |
| Hyphenation Zone            | `0..8640` px @72ppi | 36      |
| Hyphenate Capitalized Words | boolean             | `true`  |

**Requirements**

- `HAVE` — left / center / right alignment. The mechanism changed: `renderText` no longer sets one
  `ctx.textAlign` per alignment. It sets `textAlign: 'start'` unconditionally and computes the
  anchor itself from the measured ink width (`text.ts:194`, `:313-318`), because `'left'` is the
  fallthrough for an unrecognised value — a hand-edited or forward-version settings record should
  land where the tool starts rather than silently flip the alignment.
- `PARTIAL` — alignment applies to the **whole layer**. One `align` field drives every line; there is
  no per-paragraph scope.
- `GAP` — wrapping, which is what makes the box mean anything. `calculateNewRect` measures the
  widest line and **grows** the box; a line longer than the canvas is clipped at the canvas edge
  rather than reflowed. It also **never shrinks** — `rect.ts:145` grows on
  `requiredWidth > currentWidth` and has no shrink branch. This revision added tracking and caps,
  which both change every character's advance, and the box now measures them correctly
  (`Text.tsx:45-48` routes them through `publishStyle`); it still grows and never shrinks.
- `GAP` — justification, all four modes, with the Min/Desired/Max triad.
- `GAP` — indents, space before/after.
- `GAP` — hyphenation and all six settings.
- `GAP` — point vs paragraph type, and conversion between them. Converting paragraph → point
  **deletes overflowing characters**, and what Adobe says is a **Note, not a modal warning**:
  "When you convert paragraph type to point type, all characters that overflow the bounding box are
  deleted. To avoid losing text, **adjust the bounding box so that all type is visible prior to
  conversion**."
  ([creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html)). A previous revision
  of this line said a faithful implementation "must warn first" and, in §2, that "Adobe warns about
  it" — both overstated a Note into a warning. **A confirmation step is a reasonable thing for this
  app to add, and it would be this app's decision, not a documented Photoshop behaviour.**
- `OUT` — Asian text options (Set Tsume, mojikumi, kinsoku). These need CJK dictionaries this app
  does not ship.

---

## 7. The blocking requirement: a live type layer and a run model

Everything in §3, §4, §5 and §6 is downstream of this section.

**Photoshop's own architecture** ([TextItem](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/textitem),
Adobe): a type layer holds `contents` (the character stream), a `characterStyle` and a
`paragraphStyle`, plus `orientation`, `isPointText`/`isParagraphText` and `warpStyle`. Character
formatting is applied over **ranges of the stream**, which is why a selection is what makes every
per-character feature reachable.

Today `TextToolArgs` (`text.ts:63-88`) is a flat record — `{ align, bold, color, fontFamily,
fontSize, italic, lineHeight, text, rect }` plus the **five optional character attributes** this
revision added — so one style covers all of `text`. There is nowhere to put "the first three words
are bold", because no such structure exists. §19.1 explains why the new five are optional rather
than required, and that is a persistence constraint, not a modelling choice: **it does not make the
record any less flat.**

### 7.1 What the repository already gives us, and where it stops

This is the part that makes the requirement landable rather than aspirational:

- **The durable sidecar already has a first-class `kind: 'text'` source** (`history-model.ts:37-43`),
  distinct from both `'vector'` and `'legacy-tool'`, carrying `args`, `size` and `sourcePos`. The
  adapter classifies a tool source with `args.toolName === 'text'` into it (`history-adapter.ts:167`).
- **The durable materializer already re-runs the text creator from the retained args**
  (`materialization.ts:166-171`), pinned by a test at `materialization.assets.test.ts:499-516`.
  The characters are therefore already preserved and already re-derivable on one of the two
  engines.
- **The characters survive commit** in three places: `layer.source.args.text`, the history entry's
  deep-cloned `layerSource.args.text`, and the durable snapshot. **No UI reaches any of them.**

What stops it:

- **The runtime renderer excludes it.** `layer-renderer.ts:32` lists six vector tool names;
  `text` is absent, so `getLayerBitmap` returns the baked `layer.bitmap`. Adding `'text'` to that
  set routes it through `scaleVectorArgs` (`:38-49`), which requires `start`/`end` — fields text
  args do not have. **A text-specific scaling rule is needed; it is not a one-line membership
  change.**
- **One raster tool destroys the source.** `tempUpdateLayer` sets `source: undefined` for
  `commit: 'raster'` (`useLayer.ts:616-618`), and replay's `applyRasterTool` does the same
  (`useHistory.ts:100-101`). Once a text layer is painted on, the retained characters are gone.
  A live text layer that also permits painting on itself is asking for a re-derivable source the
  current code deliberately deletes.
- **Hit-testing is rect-based, not glyph-based.** `isPointInLayer` (`affine-transform.ts:258`) is
  a bounds test against `layer.pos`. A caret needs a **glyph-level** hit test — the character
  whose advance contains the click — which does not exist anywhere in the tree.
- **There is no commit kind that mutates an existing layer's content.** `UPDATE_LAYER_ACTION` is
  **commented out** in the action union (`constants.ts:27,42`). The only precedents are
  `commit: 'layer-operation'` (filter stacks) and `commit: 'geometry'` (`layer.pos`), neither of
  which is text-shaped.
- **Undo re-simulates the whole timeline from index 0** on every navigation
  (`history-replay.ts:72`), and every text layer creation re-runs the creator. Per-keystroke
  history granularity — which a live type layer implies — multiplies the entry count that replay
  re-executes.
- **A tripwire already exists**: `src/tools/__tests__/text.test.ts:877` is an `it.fails` asserting
  that an identical replay reuses the raster instead of re-running `renderText`. Per `AGENTS.md`,
  fixing that requires removing the pin **in the same change**. **The line number moved in this
  revision** — the previous revision of this document cited `:282`, which is a comment inside the
  alpha-reset suite. Read the test name, not the line.
- **The e2e asserts ink stays inside the dragged rectangle** (`e2e/text-tool.spec.ts:430`, four
  `expect.soft` assertions). That invariant is the anchor a wrapping implementation must satisfy.

### 7.2 The shape that unblocks it

Minimum viable, in the repo's own vocabulary:

```ts
type TextRun = { start: number; end: number; style: TextCharacterStyle };
type TextParagraph = { start: number; end: number; style: TextParagraphStyle };
type TypeLayerContent = {
  characters: string;
  characterRuns: TextRun[]; // half-open [start, end) over the string
  paragraphs: TextParagraph[];
  kind: 'point' | 'paragraph';
  orientation: 'horizontal' | 'vertical';
};
```

Consequences to design for, not discover later:

- **Undo granularity is a replay concern.** `HistoryItem[]` is the production replay authority
  (`AGENTS.md` → Architecture status). "Typed a character" and "split a style run" are first-class
  history entries, and the durable converter **must** be taught any new commit kind — an
  unrecognised action does not degrade partially, it **voids the entire durable shadow**
  (`history-adapter.ts:868-876`).
- **The converter and the append boundary are two independent implementations** of every durable
  rule, deliberately kept apart so a bug cannot reproduce itself (`history-append.ts:242-246`).
  A text-edit commit must be written **twice** and cross-pinned.
- **Layer identity changes.** A text layer is no longer fully described by its pixels, and the
  layer cannot be treated as an opaque bitmap.

---

## 8. Transforms in edit mode

**Photoshop** ([creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), Adobe):

- **Point type** gains a transformable box **while still editing**: `Ctrl`/`Cmd`-drag shows it,
  and its handles scale, skew and rotate the type.
- **Paragraph type** shows its box by default; resizing it **reflows the text**.
- `Ctrl`/`Cmd`-drag a **corner** handle scales the glyphs; `Ctrl`/`Cmd`-drag a **middle** handle
  **skews**; drag **outside** the border to **rotate**; `Shift` constrains; `Alt` grows from
  centre; `Ctrl`/`Cmd`-drag the centre point moves the rotation centre.
- Edit-menu transforms are allowed **except Perspective and Distort**. Transforming **part** of a
  type layer requires rasterizing first — Adobe's own note, and a stronger restriction than the
  exception list.
- A non-commit move is available: outside the bounding box the cursor becomes the Move tool, so
  the type can be repositioned without committing first.

**In this app**: `useRect` gives resize and an interior move, and `calculateNewRect` re-lays out
the text on a metric change. There is no scale, skew, rotate, no in-edit-mode `Ctrl`-drag, and no
edit mode for any of it to happen in.

- `HAVE` — box resize via `useRect`.
- `PARTIAL` — resize only. No scale, skew or rotate.
- `GAP` — reflow on box resize. **The box currently has no typographic effect on the text at
  all**; it only clips and it grows.
- `GAP` — the in-edit-mode transform box and its modifier matrix.

---

## 9. The four tools, and vertical type

**Photoshop ships four** on the `T` slot, cycled with `Shift+T`
([keys-selecting-tools](https://helpx.adobe.com/photoshop-elements/using/keys-selecting-tools.html),
Adobe):

| Tool                 | Creates                                                |
| -------------------- | ------------------------------------------------------ |
| Horizontal Type      | A live type layer, point or paragraph, left-to-right   |
| Vertical Type        | A live type layer, top-to-bottom                       |
| Horizontal Type Mask | **A selection in the shape of the type** — not a layer |
| Vertical Type Mask   | The same, vertical                                     |

Adobe's own sentence for the mask tools: "When you use the Horizontal Type Mask tool or Vertical
Type Mask tool, you create a selection in the shape of the type"
([Adobe teaching resources](https://edex.adobe.com/teaching-resources/photoshop-type-mask-tool)).

**Vertical type specifics** ([editing-text](https://helpx.adobe.com/photoshop/using/editing-text.html),
Adobe):

- Three routes: the options-bar **Text Orientation** button · `Layer > Type > Horizontal|Vertical`
  · Character panel menu > **Change Text Orientation**.
- **It flips the whole layer**, not the selection.
- Adobe warns explicitly: "Don't confuse the orientation of a type layer with the direction of
  characters in a type line."
- Alignment becomes **Top / Center / Bottom**; justification renames to **Justify Last Top /
  Centered / Bottom**.
- Underline moves beside the text and offers **Underline Left or Underline Right — never both**.
- Characters can be rotated 90° so they stand upright within vertical lines.
- The baseline marker changes meaning: for vertical type it marks the **centre axis** of the
  characters, not a baseline.

**In this app**: the type tile holds a **single entry** (`toolbar-mapping.ts:108`), so `Shift+T`
re-selects the same tool. One entry stands in for a four-tool group.

- `GAP` — the orientation control, on the bar and as a layer property. This is the one item in the
  naive description that is genuinely absent.
- `GAP` — vertical rendering. Canvas can rotate the glyph run, but vertical alignment, the
  underline rule and the centre-axis baseline all follow from the layout model in §7.
- `OUT` — the two **mask** tools. They produce a selection, not a layer, so they belong to the
  selection model rather than to the Type tool's layer story.

**The path-type cursor is unsourced.** Third-party descriptions disagree — dotted wavy line, wavy
line, or I-beam in a dotted square — and no Adobe page documents it. Specify a dotted path-line
through the I-beam and **label it a reconstruction**.

---

## 10. Fonts

- `HAVE` — a font picker with hover-preview, portal-anchored positioning, and Escape /
  outside-click revert (`FontSelect.tsx`).
- `PARTIAL` — **14 hard-coded families** (`FontSelect.tsx:5-20`). WYSIWYG preview is already
  correct.
- `GAP` — per-family style enumeration.
- `GAP` — **missing fonts are a first-class state, not an error path.** A document from a
  collaborator must always open. Photoshop surfaces this as `Type > Manage Missing Fonts`, a
  per-layer indicator in the Layers panel, and a default replacement (**Myriad Pro Regular** for
  Roman text). A web editor cannot assume the font exists.
- `OUT` — Adobe Fonts / Typekit sync, and `Type > Match Font` (identify a font from a rasterised
  selection — an image-matching model this app does not have).
- `OUT` — OpenType feature toggles and variable-font axes. Canvas 2D exposes neither: the shaper
  is the platform's and takes no feature arguments. Not a checkbox.

---

## 11. Units, coordinates, export — the renderer limits

| Concept               | Photoshop                                   | This repo                                                      |
| --------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Type size             | points (1/72 in)                            | **px**, emitted by `fontShorthand` (`text.ts:151`)             |
| Explicit leading      | a **length**: `0..4999.99` px @72ppi        | unitless ratio — **semantics differ**                          |
| Auto leading          | % of type size, default 120                 | ratio, default 1.2 — **number matches, semantics do not** (§6) |
| Tracking              | 1/1000 em, `-1000..1000`                    | 1/1000 em, via `ctx.letterSpacing` — **matches**               |
| Kerning               | 1/1000 em; default `METRICS`                | browser default (metrics); **no control**                      |
| Resolution dependence | `newVal = (resolution / 72) × referenceVal` | none                                                           |

**The previous revision's Size-field unit claim was REFUTED and is withdrawn.** It said the field
"accepts `in, cm, mm, pt, px, pica` and converts to the document's default unit", attributed to a
CS-era manual mirror. Two corrections, both from Adobe:

1. **`TypeUnits` has three members, not six.** `constants.TypeUnits` is
   **`MILLIMETERS / PIXELS / POINTS`** — "The measurement unit for type. Pass to
   `PreferencesUnitsAndRulers.typeUnits`"
   ([`constants`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants)).
   There is no `in`, `cm` or `pica` for type. The CS mirror was describing the general unit
   preference, not the type one, and reading it as the Size field was the error.
2. **The conversion target is not the document's default unit.** Adobe: "**Points is the default
   unit of measurement for type.** One PostScript point is equal to 1/72 of an inch in a 72-ppi
   image. However, you can switch between using the PostScript and traditional definitions of point
   size. Change the default unit of measurement for type in the Units & Rulers section of the
   Preferences dialog box."
   ([formatting-characters](https://helpx.adobe.com/photoshop/using/formatting-characters.html)).
   **Type has its own unit preference**, independent of the ruler unit — a ruler in inches does not
   make the Size field an inches field.

**Export.** Photoshop type stays vector in PSD, PDF and EPS. Canvas-rendered text is pixels from
the moment it is drawn. Both save paths flatten: `savePsd` writes each child as a raster canvas
(`psd-utils.ts:240-270`), and the image path writes a single flattened canvas. The PSD importer
already warns that text arrives "as a raster preview; editable text is not preserved"
(`psd-utils.ts:108`) — which is true in both directions today. Both references are in
`src/contexts/psd-utils.ts`, which the old row did not name.

- `OUT` — switching the size unit to points. **The requirement is narrower and is the landable
  one: the stored value must name its unit**, so a future points migration is a data migration
  and not an ambiguity. The size **range** is already Adobe's (§5); only the unit is not.
- `OUT` — vector text output. **A hard limit of the renderer, not a missing feature.** Record it
  once here so it is not rediscovered per export baseline.

---

## 12. Text on paths, warp, and conversions

- **Text on a path** — click the path, type; text follows the path in the direction of its anchor
  points and stays fully editable. Needs path sampling.
- **Text inside a shape** — the same gesture inside a closed path.
- **Warp Text** — ~20 presets, each with **Bend**, horizontal/vertical distortion, and H/V
  orientation. **Warped text stays fully editable**, and `None` unwraps it. Warp is unavailable
  when Faux Bold is applied.
- **Create Work Path** — produces a path **and leaves the type layer intact**. Cheap and useful.
- **Convert to Shape** — turns text into a vector shape: no longer editable as type, now
  deformable per-letter.
- **Rasterize Type** — irreversible; afterwards the words and the font are gone.

- `OUT` — text on a path and warp. Both need per-glyph placement along a deformed baseline, and
  warp's editable-after-warping property is the expensive half.
- `GAP` — Create Work Path. Glyph outlines are reachable via a font parser.
- `OUT` — Convert to Shape. Needs a vector document model this app does not have.
- `OUT` — rasterize prompts. A raster text layer is already rasterized.

---

## 13. Spelling, hyphenation, search

- **Check Spelling** — per-language dictionary, and **hidden and locked layers are not checked**.
  Offers Ignore / Ignore All / Change To / Add to Dictionary, one misspelling at a time.
- **Find And Replace Text** — across **visible and unlocked type layers only**, with case and
  whole-word options.

- `GAP` — all of it. `Intl.Segmenter` gives word boundaries for double-click selection and
  whole-word search; the browser exposes **no** per-language hyphenation patterns, so hyphenation
  needs a shipped pattern set.
- `OUT` — the personal dictionary and the hidden/locked rules as a _rule_ rather than as
  behaviour. The dictionary is user data with a file format.

---

## 14. Platform constraints

Canvas 2D, and what each Photoshop feature costs there:

| Photoshop feature      | Canvas 2D             | Status                                                                              |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Photoshop feature      | Canvas 2D             | Status                                                                              |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------   |
| Kerning                | `ctx.fontKerning`     | Available; **default metrics kerning matches Adobe's default**, no control          |
| Tracking               | `ctx.letterSpacing`   | **Used, feature-detected, with a measured fallback** (§19, §20, §21)                |
| Word spacing           | `ctx.wordSpacing`     | Baseline 2025 — feature-detect; **not used yet** (it is §6's `wordSpacingDesired`)  |
| Small caps / all caps  | `ctx.fontVariantCaps` | **Used, synthesising** (§19, §20)                                                   |
| Condensed / expanded   | `ctx.fontStretch`     | Available                                                                           |
| Baseline direction     | `ctx.direction`       | Direction only, not bidi shaping                                                    |
| Language for shaping   | `ctx.lang`            | Available                                                                           |
| Ligature control       | `ctx.textRendering`   | Limited availability                                                                |
| **Auto-leading 120%**  | —                     | Reproduced as a constant; **"font-independent, therefore exact" is WITHDRAWN** (§6) |
| **Anti-aliasing mode** | —                     | **Unavailable** (§5)                                                                |
| **OpenType features**  | —                     | **Unavailable** (§10)                                                               |
| **Hyphenation**        | —                     | Needs shipped patterns (§13)                                                        |

**Baseline 2025 is not a floor to assume.** `letterSpacing` and `wordSpacing` shipped in March
2025, and the e2e suite runs system **Chrome** only (`playwright.config.ts:100-105`), so CI will
not catch a regression elsewhere. Any use of these must be feature-detected at the point of use,
with a measured manual fallback.

**The previous revision's testing instruction for that fallback was WRONG, and is withdrawn.** It
said the fallback "must be exercised by a unit test that deletes the property". On Chrome 154,
`delete CanvasRenderingContext2D.prototype.letterSpacing` **reports success and leaves the property
present and fully functional** (§20) — so such a test is a **false pass on the real browser**: it
exercises the `letterSpacing` path while claiming to exercise the fallback. **The correct way to
exercise the fallback is a harness that simply omits the key.** That is what `makeTextCtx`
(`text.test.ts:59-66`) does, with `modern: false` as the default, and it is why the fallback's
tests are trusted and the old instruction is not.

**One assignment-order rule came out of the measurements and is not optional.** Assigning
`ctx.font` **resets** `fontVariantCaps` to `'normal'`; `letterSpacing`, `wordSpacing` and
`fontKerning` survive a font assignment. So `applyTextStyle` (`text.ts:191-208`) assigns the font
first and the caps last, and `text.test.ts:604-624` proves the order by reading `ctx.font` at the
moment of the caps assignment. A caps toggle set before the font would be silently discarded on
every redraw, with no error anywhere.

**The consequence worth stating plainly: the Text tool's glyph rasterisation is the host
browser's, not ours.** Anti-aliasing, hinting, subpixel positioning and the `textRendering` hint
all sit below `fillText`. Any requirement that says "render the text the way Photoshop renders
text" is unreachable, and any export baseline that depends on it is host-dependent rather than a
property of the code. This revision added a second instance of the same class: synthesised small
caps are **exactly 0.703125 of the real cap height** on Chrome's Arial, and that constant is
Chrome's, not Adobe's.

---

## 15. Verification

Every requirement above needs a test that fails without the change. **This section was materially
wrong before this revision and is now re-derived from the tests as they are.**

- **jsdom (`npm run test`)** — layout arithmetic, run splitting and merging, selection-range
  arithmetic, justification distribution, indent maths.
- **`measureText` does not have to be an injected seam, and the old claim about why is dead.**
  The previous revision said `measureText` "must be **injected seams, not globals**" because
  "`getTextWidth` currently reaches into a live context via `rect.ts:144`, and that has to change
  before any of §5 or §6 is testable". Both halves are false now. `getTextWidth` still reaches a
  live context at `rect.ts:144` — but it now brackets its own style writes in `save`/`restore`
  (`text.ts:340-350`, §21.5), so it is **safe** to hand it a mock, and the whole of §5's tracking,
  caps and decoration arithmetic is tested through exactly that shape. What §5 needed was not a new
  seam but a renderer that did not scribble on the caller's context. **The real seam is
  `makeMockCtx` plus `makeTextCtx`** (`text.test.ts:59-66`), and the rule for it is §14's: **omit
  the key, do not delete it.**
- **Playwright (`npm run test:e2e`, headless)** — caret placement, the click-count ladder, IME
  composition, box drag reflow, the overflow indicator. Real input via `page.mouse` /
  `page.keyboard`. None of these exist yet.
- **Rendered output** — a text layer's pixels are the only place wrapping, tracking and
  justification are observable. These need a **pixel** assertion. jsdom `toBeVisible()` is not
  evidence about glyphs. The e2e's existing ink-bounds assertions (`e2e/text-tool.spec.ts:522-525`)
  are the nearest thing today and they check _position_, not _shaping_ — so **no e2e currently
  asserts that tracking, caps or a rule reaches the canvas at all.**
- **Not pinned by a test** — anti-aliasing and OpenType features. Host behaviour. Say so rather
  than writing a test that passes for the wrong reason.
- **Tripwires to remove in the same change as any fix** — **one remains.**
  `src/tools/__tests__/text.test.ts:877` is the `it.fails` on replay re-rasterization.
  **The B/I `aria-pressed` `it.fails` is GONE** — the previous revision listed it at
  `Text.test.tsx:132`. It was removed: `aria-pressed` now exists on both toggles
  (`Text.tsx:253`, `:265`) and the tripwire became a real assertion at `Text.test.tsx:189-212`,
  which states in its own comment that it "had to become a real assertion in the same change that
  added the attribute". **Do not go looking for it.**
- **A gap in the new tests worth naming.** `src/util/__tests__/string.test.ts` does not import
  `graphemes`, so the new export has no direct unit test; it is covered only on the fallback path
  in `text.test.ts:551-565,765-774`. That is enough to catch a wrong signature and not enough to
  catch a wrong cluster rule.

---

## 16. Priority order

Ordered by what unblocks the most per unit of work, not by what Photoshop does first. **Renumbered
2026-10-01: what this revision shipped is removed, and the reasoning for the survivors is kept.**

Removed, because they landed: _tracking_ (`ctx.letterSpacing` exists and is now used, §19 item 4)
and _character style attributes — underline, strikethrough, caps_ (§19 items 5 and 6). The
surviving character work is what the run model gates, and it has been pushed down accordingly.

| #   | Item                                                                     | Why here                                                                                                      |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1   | **Live type layer + run model** (§7)                                     | Blocks every remaining per-character and per-paragraph feature, and re-entering a layer at all                |
| 2   | **Click = point type, drag = paragraph type** (§2)                       | The tool's primary interaction, entirely absent                                                               |
| 3   | **Placeholder text, pre-selected** (§2)                                  | What makes "click then type" feel like Photoshop                                                              |
| 4   | **Edit mode + caret + selection** (§3, §4)                               | Commit/cancel, manual kerning, IME, and §7's usability                                                        |
| 5   | **Text wrapping + overflow indicator** (§2, §6)                          | Makes the box mean something; currently decorative                                                            |
| 6   | **Orientation / vertical type** (§9)                                     | The one bar control named in the naive description, and the only Adobe-documented one this app omits entirely |
| 7   | **Justification** (§6)                                                   | Needs written properly; the commented-out caret block is a sketch, not a reference                            |
| 8   | **Missing-font state** (§10)                                             | A document from a collaborator must always open                                                               |
| 9   | **Indents + paragraph spacing** (§6)                                     | Follows the run model, low marginal cost                                                                      |
| 10  | **Leading as a length, with Auto** (§5)                                  | The default matches Adobe and the semantics still do not (§5, §6)                                             |
| 11  | **Manual kerning** (§5)                                                  | Needs a caret, so it is item 4 wearing a different hat                                                        |
| 12  | **Faux Bold / Faux Italic, super/subscript, baseline shift, scale** (§5) | All gated on the run model; none is a bar control in Photoshop anyway (§5)                                    |
| 13  | **Size in points** (§11)                                                 | The range is already Adobe's; only the unit is left                                                           |

**Renumbering note.** Item 6 of the old list was tracking and item 8 was the character attributes;
both are gone, so the old items 7 and 9–11 are now 6 and 8–9, and three new items (10–13) appear at
the bottom because they are genuinely post-run-model work rather than blocked by it.

---

## 17. Open questions

These are judgement calls, not research gaps. Each one blocks work downstream.

1. **Does a text layer stay editable, or commit once?** Today: commit once, to a raster. §3 and
   §7 assume the layer survives. **This is the decision the rest of the document waits on**, and
   §7.1 lists the three places in the current code that would have to change.
2. **Per-keystroke history, or per-edit?** Photoshop records text edits individually. Replay
   re-simulates the whole timeline from index 0 and re-runs the creator per layer, so per-keystroke
   granularity has a real cost here. This is a replay decision, not a UI one.
3. **Should a text layer survive a raster tool applied to it?** The current code deletes the
   retained source. Preserving it means either re-deriving after the raster (impossible — the
   pixels changed) or keeping both and choosing. Photoshop prompts to rasterize first.
4. **Wrapping, or explicitly out of scope?** The bounding box is currently decorative. Wrapping is
   the largest visual-quality jump and the largest test surface, and `e2e/text-tool.spec.ts:430`
   already pins an invariant a wrapping implementation must satisfy.
5. **Which browser is the floor?** **Partly answered, and it changed the answer.** Tracking is
   feature-detected with a measured manual fallback and needs no floor at all (§19, §21.3).
   `wordSpacing` does, because §6's `wordSpacingDesired` would use it and it is still
   unfeature-detected anywhere. CI is Chrome-only today (`playwright.config.ts:100-105`).
6. **Whose small caps is a rendering problem, not a layout one?** Chrome **synthesises** rather
   than selecting a real small-cap face (§20), at exactly 0.703125 of the cap height on its Arial.
   A document authored on a machine with a real small-caps font will not match one authored here,
   and no amount of correctness in this app changes that. Whether to treat it as a fidelity gap, a
   documented host limitation, or both is undecided.
7. **Is the underline's 0.1em offset a decision this app gets to keep?** §21.6 records it as a
   reconstruction. It could be made _measured_ instead — `fontBoundingBoxDescent` is available
   (§20) — which would be more defensible and still not a Photoshop figure.

---

## 18. Test inventory that pins today's behaviour

Any implementation that changes the model above will break these. They are listed so the next
session knows what it is walking into — not as an instruction to weaken any of them. **Every line
reference below was re-verified against the tree on 2026-10-01; two of them had drifted since the
previous revision and the old numbers are recorded in §22.2.**

| File                                                                    | Pins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Breaks on                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `src/tools/__tests__/text.test.ts` (889 lines)                          | `fontShorthand` order; `fontShorthand`'s grammar-legal shape; the four Adobe constants; `trackingPx`; `resolveTextStyle`'s five defaults, its `lineHeight` fallback, its pass-through and its non-mutation; the empty-draft guard in all four spellings; the shared overlay alpha; `textBaseline`/`textAlign`; the per-line baseline and the 0.8em fallback; the per-line anchor including both overflow cases; tracking's string shape, its `'letterSpacing' in ctx` guard, ink-vs-advance anchoring, the cluster fallback and the zero-tracking path; caps, including the font-before-caps order and the `'fontVariantCaps' in ctx` guard; both rules' thickness, position, colour and off state; `getTextWidth`'s widest line, single line, absent text, trailing-gap subtraction, `(n-1)` fallback, zero clamp, zero-tracking path and style match; creator canvas size; re-rasterization cost; **the `it.fails` replay tripwire at `:877`** | most of the model               |
| `src/util/__tests__/rect.test.ts:191-339`                               | grow-from-click (`:213-229`), grow-on-wider-text, centre re-placement, **no shrink**, height arithmetic, null-rect precedence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | wrapping and fixed boxes        |
| `src/components/ToolbarsRight/Text/__tests__/Text.test.tsx` (823 lines) | Apply/Clear gating, the textarea placeholder, the **colour swatch owning its value** (`:521-561`), the four style toggles each in three states (`:214-325`), `publishStyle`'s metric-vs-decoration split, a persisted record with the five optionals deleted (`:354`), the 15-stop tab order including all six toggles (`:644-689`), the number field over `0.01..1296` (`:691-718`), tracking in 1/1000 em (`:592-642`), apply idempotency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | the whole commit model          |
| `src/components/Main/__tests__/TextToolArea.test.tsx:201-233`           | colour ownership in both directions — a drag must not republish the foreground, and a foreground change must not republish the args                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | focus moving to the canvas      |
| `src/contexts/__tests__/useLayer.text.test.tsx` (371 lines)             | commit idempotency in both directions, cleared-draft shape, distinct-args distinct-layers, text-without-rect committing nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | the commit model                |
| `e2e/text-tool.spec.ts` (557 lines, 4 tests)                            | drag-then-type order, the Apply gate, the `/^text \d+$/` layer row, **ink stays inside the dragged rectangle** (`:430`, assertions `:522-525`), Clear discarding, colour driven through `#text-color` (`:290-308`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | creation gestures, layer naming |
| `src/contexts/__tests__/materialization.assets.test.ts:499-516`         | a durable `kind: 'text'` source **renders through the text creator** at its intrinsic size                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | nothing — already correct       |
| `src/util/__tests__/settings.test.ts:110-130`, `:139-182`               | text settings persist **without** `text` and `rect`; the five character attributes persist **verbatim and are never back-filled**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | nothing — correct by design     |
| `src/util/__tests__/string.test.ts` (142 lines)                         | `charLength`, `deleteLastChar`, `deleteCharAt` on ZWJ sequences and flags. **Does not import `graphemes`** (§15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the caret work                  |

**The two rows that moved.** `settings.test.ts:85-105` was cited for the text-persistence pin and
is actually the **draw** arm's test; the text arms are `:110-130` and `:139-182`. And the
`calculateNewRect` block is `:191-339`, not `:207-334` — the old range started inside the mock
builder and so covered two tests, not the suite.

**Nothing in this inventory fails today.** `npx vitest run` over the seven text-related files gives
248 passed and 1 expected fail (the replay tripwire), and `npm run tsc` is clean.

---

## 19. What this revision shipped

Recorded so the next session does not re-litigate it, and in the register §0 uses: what the code
now does, and which row it moved. Nothing here is a Photoshop behaviour claim unless it carries an
Adobe citation.

| #   | Change                                                              | Where                                               | Adobe basis                                                                                                                                           |
| --- | ------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ctx.font` shorthand order                                          | `text.ts:150-152`                                   | none needed — this is a CSS grammar fix. `${italic}${bold}${size}px ${family}` produced `64px bold Arial`, which the grammar rejects as a family name |
| 2   | Size field range and control                                        | `text.ts:14-15`, `Text.tsx:150-168`                 | `CharacterStyle.size`, `0.01..1296`                                                                                                                   |
| 3   | Default leading                                                     | `text.ts:34`, `settings.ts:86`                      | `JustificationProperties.autoLeadingAmount` = `120`                                                                                                   |
| 4   | Tracking                                                            | `text.ts:23-24,155-157,195-197`; `Text.tsx:195-213` | `CharacterStyle.tracking`, `-1000..1000`, 1/1000 em                                                                                                   |
| 5   | All Caps / Small Caps                                               | `text.ts:198-207`; `Text.tsx:272-299`               | `formatting-characters.html` — "if the font does not include small caps, Photoshop generates faux small caps"                                         |
| 6   | Underline / Strikethrough                                           | `text.ts:322-327`; `Text.tsx:300-321`               | `formatting-characters.html` — "The line is always the same color as the type color"                                                                  |
| 7   | `textBaseline: 'alphabetic'`                                        | `text.ts:193`, `:222-224`, `:308`                   | none — a renderer decision, measured. §21                                                                                                             |
| 8   | `textAlign: 'start'` + ink-width anchoring                          | `text.ts:194`, `:248-260`, `:313-318`               | none — a renderer decision, measured. §21                                                                                                             |
| 9   | `getTextWidth` bracketed in `save`/`restore`                        | `text.ts:340-350`                                   | none — a leak fix. §21                                                                                                                                |
| 10  | `resolveTextStyle` as the one place an absent field becomes a value | `text.ts:113-128`                                   | none — a migration guard. See §19.1                                                                                                                   |
| 11  | `graphemes()` export                                                | `string.ts:19-21`, used at `text.ts:256,277`        | none needed. `Intl.Segmenter`, `granularity: 'grapheme'`                                                                                              |

### 19.1 The five new args fields are OPTIONAL, and that is load-bearing

`allCaps`, `smallCaps`, `strikethrough`, `tracking` and `underline` are declared `?` on
`TextToolArgs` (`text.ts:80-86`) while `ResolvedTextStyle` has them required (`text.ts:98-111`).
That is not tidiness. `saveLastSettings` persists the text record **verbatim**
(`util/settings.ts:30-31`), so a settings object written by an earlier build has no key for these
fields at all — not `false`, not `0`, not `undefined`, which are three different documents. Reading
the raw args produced `undefined * fontSize` = `NaN`, and a `fillText` at `y = NaN` draws **nothing
at all** rather than something wrong a user could see. `resolveTextStyle` is the single place that
answer lives, and `Text.test.tsx:354` renders the bar from a record with the five keys genuinely
deleted, while `settings.test.ts:139-182` pins that the save path neither back-fills them nor drops
them.

---

## 20. Measured Canvas 2D behaviour

Every number in §21 is a measurement, not a reading of a spec. **Method:** a page served by this
app's own dev server, a real `HTMLCanvasElement` 2D context, and values read back after
`fillText`/`measureText`. Two browser builds on this host, **Google Chrome 154.0.8037.58** (the
`chrome` channel `playwright.config.ts:100-105` uses for the e2e) and **Google Chrome for Testing
153.0.8010.12** (Playwright's bundled `chromium-1243`). **Every number below was identical on both.**

**`ctx.letterSpacing` — present.**

| Fact                                                                                                                         | Consequence in this app                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `measureText` width grows by `n * spacing` for n = 1..10 — **including the trailing character**                              | `getTextWidth` subtracts one spacing (`text.ts:253-255`)                                                                |
| The **ink** grows by `(n - 1) * spacing`                                                                                     | every anchor and the underline use the ink, not the advance                                                             |
| A value with surrounding whitespace is **silently rejected**; the property keeps its old value                               | the assignment is exactly `${n}px`, asserted for shape at `text.test.ts:508-524`                                        |
| `'normal'` is **not** a keyword; reset with `'0px'`                                                                          | no string is ever built from a keyword here                                                                             |
| No invalid value ever throws                                                                                                 | there is no error path to handle, which is why the bug was silent                                                       |
| `'letterSpacing' in ctx` is the only reliable feature test                                                                   | `hasLetterSpacing` (`text.ts:165-167`)                                                                                  |
| `delete CanvasRenderingContext2D.prototype.letterSpacing` **reports success** and leaves the property present and functional | a prototype-deletion test of the fallback is a **false pass**. §14's old instruction to write one is withdrawn; see §14 |
| Setting `letterSpacing` does **not** disable kerning — the `AV` pair kerns -4.75px at both 0px and 10px                      | the manual fallback's loss of kerning is the fallback's, not `letterSpacing`'s                                          |

**`ctx.fontVariantCaps` — present, and it synthesises.**

| Value            | Measured behaviour on Arial 64px                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `all-small-caps` | `h` gets **exactly** the advance and ink box of `H`, at exactly `0.703125` of the real cap height |
| `small-caps`     | uppercase untouched; only the lowercase is synthesised — which **is** Adobe's documented rule     |
| `petite-caps`    | indistinguishable from `small-caps` on Arial — **not shipped**                                    |
| `titling-caps`   | a no-op on Arial — **not shipped**                                                                |

Assigning `ctx.font` **resets** `fontVariantCaps` to `'normal'`; `letterSpacing`, `wordSpacing` and
`fontKerning` **survive** a font assignment. That asymmetry is the whole of the ordering rule at
`text.ts:192` before `:206`, and it is pinned by reading `ctx.font` at the moment of the caps
assignment (`text.test.ts:604-624`).

**Text metrics — all available.** Arial at 64px: `fontBoundingBoxAscent` **58**, `fontBoundingBoxDescent`
**14**, cap height **45.81250** (`0.715820em`), x-height **33.18750** (`0.518555em`),
`actualBoundingBoxAscent` for `g` **33.93750**.

**`ctx.textBaseline = 'top'` matches no exposed metric.** Measured across fourteen families at 64px
the offset from the top of the line box to the baseline runs **0.762695em** (Times New Roman) to
**0.875977em** (Impact), Arial **0.781250em**, and the generic families exactly **0.75em**. There is
no metric that reproduces it, and this is the whole reason for the move to `'alphabetic'`.

**The price of the manual fallback, measured.** On `'WAVE AV'` at 64px, summing per-cluster
advances gives a total **11.875px wider** than the kerned whole-line measurement. That is kerning
lost, and it is the honest cost of placing gaps by hand.

---

## 21. Renderer decisions, and what they cost

Four decisions were made that Adobe says nothing about. Each is a decision **of this app**, none is
a Photoshop behaviour, and each is recorded here with its cost.

**1. `textBaseline: 'alphabetic'`, with the baseline placed by formula** —
`rect.y1 + TEXT_PADDING + fontBoundingBoxAscent + index * fontSize * lineHeight` (`text.ts:308`).
Under `'top'` every y was the browser's idea of the line top, which §20 shows is a font-dependent
constant no exposed metric reproduces. Every decoration this tool draws — the underline at 0.1em
below the baseline, the strikethrough at half the x-height above it — needs a baseline it can
_name_. **Cost:** `fontBoundingBoxAscent` is the font's **ascent**, so on a face whose ascent
exceeds `fontSize * lineHeight` a line can collide with the next one. The two fallbacks
(`ASCENT_FALLBACK_EM` 0.8, `X_HEIGHT_FALLBACK_EM` 0.5 at `text.ts:54,61`) exist because a bare
canvas mock reports `{ width }` and nothing else, and `NaN` draws nothing at all.

**2. Ink width, not advance.** Chrome's `letterSpacing` adds the gap to the **last** character's
advance too (§20), so the advance over-reports the line by exactly one spacing. Every coordinate
derived from a line — the left/centre/right anchors, the underline and strikethrough extents, and
`getTextWidth` itself — uses the ink. `getTextWidth` clamps at 0 (`text.ts:254`), because a
one-glyph line at wide tracking measures negative and a negative extent asks `fillRect` for a
**mirrored rectangle** rather than an error. **Cost:** none; it is the arithmetic the platform
implies. A line is drawn once per `fillText` with `textAlign: 'start'` so the browser is never asked
to place the glyphs.

**3. `'letterSpacing' in ctx` is the only feature test** (`text.ts:165-167`), with a **manual
per-grapheme fallback** that positions each cluster itself (`text.ts:271-281`). **Cost, stated
plainly: kerning and any ligature the font would have formed across a cluster boundary are gone**,
worth 11.875px on `'WAVE AV'` at 64px (§20). There is no API to ask for one kerned pair at a time.
This is why the fallback is written as a named branch with its own tests rather than as a
`smoothWidth()` helper nobody reads.

**4. Tracking at zero does not take the fallback** (`text.ts:252`, `:272`). Zero tracking is the
overwhelmingly common case and there is nothing to place by hand, so falling through to the
cluster path would throw kerning away for free. One whole-line `measureText`/`fillText` is the
observable difference, and it is asserted by the **absence** of per-cluster calls
(`text.test.ts:567-579`, `:786-794`) — the only thing that distinguishes the two paths in the call
log.

**5. `getTextWidth` brackets `applyTextStyle` in `save`/`restore`** (`text.ts:340-350`).
`calculateNewRect` calls it with the **live tool overlay** — `TextToolArea.tsx:28` hands
`toolOverlayRef` to `useRect` and `TextToolArea.tsx:31` hands the same ref to `calculateNewRect` —
and `applyTextStyle` is not a measurement, it _writes_ `font`, `textBaseline`, `textAlign`,
`letterSpacing` and `fontVariantCaps` onto the caller's context. Unbracketed, every box recompute
left the overlay wearing the Type tool's typography. This is the same leak `resetOverlayAlpha`
exists for, and unlike that helper it was not closed. **Cost:** none, and it is what makes §5's
tracking testable at all — see §15.

**6. The underline's position is a RECONSTRUCTION.** `UNDERLINE_BELOW_BASELINE_EM = 0.1`
(`text.ts:47`) is **this app's choice, not an Adobe figure**. No Adobe page documents where the
rule sits relative to the baseline. Adobe documents only that the rule takes the type's colour
(`formatting-characters.html`) and that its `Underline` enum is `NONE / LEFTINVERTICAL /
RIGHTINVERTICAL` with no style, weight or offset of its own
([`constants`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants)); the
Underline Options dialog with its offset control is InDesign/InCopy. The 0.1em sits in the band
browsers and print conventions use. It is a named constant precisely so that it is **one edit**
rather than a search, and `text.test.ts:640-654` pins the app's choice as such.

---

## 22. Sources

**Labelling discipline.** A claim with no Adobe citation is a rumour (`docs/DOCUMENTATION.md`).
Adobe's own helpx, Adobe's own API reference and Adobe employees on Adobe's own forum are all
"Adobe", but they are **not interchangeable**: the third is not documentation and is labelled as
such where it is used.

### Adobe — behaviour and interaction

- [Create type in Photoshop](https://helpx.adobe.com/photoshop/using/creating-type.html) — point
  vs paragraph, edit mode, the Commit/Cancel tell, **the Commit button, numeric-keypad `Enter` and
  `Ctrl+Enter`/`Cmd+Return` verbatim**, the overflow icon, the editable-without-rasterizing list and
  its Perspective/Distort exceptions, and the **Note** that paragraph→point deletes overflowing
  characters
- [Edit text in Photoshop](https://helpx.adobe.com/photoshop/using/editing-text.html) — `Esc`
  committing by default and the `Use Esc key to commit text` preference, clicking away to commit
  (watch the cursor), focus loss to another application committing automatically, spell check,
  find and replace, the three orientation routes, the default font size
- [Add or edit text](https://helpx.adobe.com/au/photoshop/using/add-edit-text.html) —
  `Fill new type layers with placeholder text`, and `Type > Paste Lorem Ipsum`
- [Format characters](https://helpx.adobe.com/photoshop/using/formatting-characters.html) — the
  full click-count selection ladder, faux styles, **"The line is always the same color as the type
  color"**, Underline Left/Right, **the faux small caps rule**, super/subscript faux generation, and
  **"Points is the default unit of measurement for type"** with its own preference
- [Line and character spacing](https://helpx.adobe.com/photoshop/using/line-character-spacing.html)
  — leading as a Character-panel value, where auto-leading is changed, **"Metrics kerning is set as
  the default"**, the 1/1000-em tracking unit, the caret-vs-selection field swap, cumulative
  tracking and manual kerning
- [Format paragraphs](https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html) —
  alignment, the four justification modes, Min/Desired/Max semantics, indents, hyphenation
- [Horizontal and vertical type tool options](https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html)
  — **the only Photoshop page that mentions the Type options bar at all**, and it lists three
  examples without an order (§5). Use it for the existence of the bar, never for its layout
- [Warp and unwarp text](https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html)
  — that warped text stays fully editable
- [Convert text to shapes or work paths](https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/convert-text-to-shapes-or-work-paths.html)
- [Replace missing fonts](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/replace-missing-fonts.html)
  — `Manage Missing Fonts`, Myriad Pro Regular as the Roman default, the per-layer indicator
- [Apply OpenType features](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/apply-opentype-features.html)
- [When to rasterize type and shape layers](https://www.adobe.com/learn/photoshop/web/rasterize-type-shape-layer)
- [Type mask tool](https://edex.adobe.com/teaching-resources/photoshop-type-mask-tool) — Adobe's
  own teaching page: the mask tools create a selection in the shape of the type
- [Keyboard shortcuts: selecting tools](https://helpx.adobe.com/photoshop-elements/using/keys-selecting-tools.html)
  — the four type tools on `T`, and `Shift+T` cycling
- [Asian type](https://helpx.adobe.com/photoshop/using/asian-type.html) — mojikumi, kinsoku,
  top-to-top leading, Set Tsume, and that 23.0 removed the need to select the East Asian engine
- **[Add text to an image in Photoshop Elements](https://helpx.adobe.com/photoshop-elements/desktop/adding-shapes-and-text/add-text.html)**
  — the **only** Adobe page that enumerates a type options bar control by control. Cited for:
  `Tracking`, `Faux Bold`, `Faux Italic`, `Underline`, `Strikethrough`, `Align Text`, `Toggle Text
Orientation`, `Warp text` and `Anti-aliased` being **options-bar** controls; that placeholder
  text (Lorem Ipsum) appears after clicking with the `T` tool and can be disabled in
  `Preferences > Type`; the Elements commit list; and the `Ctrl+Shift+J` / `Ctrl+Shift+F` justify
  shortcuts. **It is a different product with a different bar** — see §5 on why it is not a basis
  for a Photoshop bar layout, and on the correction that it _does_ carry Faux toggles

### Adobe — API reference (authoritative for every default and range in §5 and §6)

- [`CharacterStyle`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle)
  — every character property with its default and range, in pixels for a 72ppi document. Every row
  of §5's table was re-read from this page on 2026-10-01, including `leading` `0..4999.99` default
  `null`, `size` `0.01..1296`, `tracking` `-1000..1000` at 1/1000 em, `autoKerning` default
  `METRICS`, `antiAliasMethod` default `SHARP`, `fauxBold`/`fauxItalic` default `false` with the
  Character-panel wording, and `useAutoLeading`
- [`ParagraphStyle`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/paragraphstyle)
- [`JustificationProperties`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/objects/options/justificationproperties)
  — the Min/Desired/Max defaults of 80/100/133, 0/0/0, 100/100/100, and `autoLeadingAmount` = `120`,
  "Percentage of type size to use for auto leading", range `0..500`
- [`HyphenationProperties`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/objects/options/hyphenationproperties)
  — all six settings, including `wordsLongerThan` default **5**
- [`TextItem`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/textitem) —
  `contents`, `isPointText`/`isParagraphText`, `orientation`, the resolution conversion formula,
  and the conversion methods
- [`constants`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants) —
  the enumerations this document leans on, read on 2026-10-01: **`TypeUnits` =
  `MILLIMETERS / PIXELS / POINTS`** ("The measurement unit for type"), **`Underline` =
  `NONE / LEFTINVERTICAL / RIGHTINVERTICAL`** with no style/weight/offset/colour of its own (the
  basis for §21.6), **`AutoKernType` = `MANUAL / METRICS / OPTICAL`**, `AntiAlias` =
  `NONE/SHARP/CRISP/SMOOTH/STRONG`, `Justification`, `Baseline`, `StrikeThrough`

### Adobe — an employee, on Adobe's own community forum. Not documentation.

- [Bring back Font Anti Aliasing Pulldown in the Type tool bar](https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044)
  — an **Adobe employee** states there that the anti-alias dropdown was **removed from the tool
  options**, that returning it "is definitely under consideration", and that it remains reachable
  by right-clicking type on canvas, from the Properties and Character panels, and from the `Type`
  menu; the original report gives **26.10** as the version. **The previous revision of this
  document listed this thread as a third-party rumour with an "unconfirmed" date; that is now
  resolved in favour of the removal, and the entry has moved out of the third-party list.** It is
  still not a helpx page, and Adobe's own `formatting-characters` helpx is dated 2023-09-20 and
  still lists the panel routes — that page is stale on this point (§5)

### Web platform

- [MDN: `CanvasRenderingContext2D`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)
- [MDN: `letterSpacing`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing)
  and [`wordSpacing`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/wordSpacing)
  — Baseline 2025
- [MDN: `fontVariantCaps`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/fontVariantCaps)
- [MDN: `textRendering`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/textRendering)
  — limited availability
- [MDN: `TextMetrics`](https://developer.mozilla.org/en-US/docs/Web/API/TextMetrics) — the metric
  fields §20 and §21 are measured against
- **The behavioural numbers in §20 are measurements, not citations.** They were taken on this host
  against a page served by this app's dev server, on **Google Chrome 154.0.8037.58** and **Google
  Chrome for Testing 153.0.8010.12**, identical on both. Re-measure before trusting them
  elsewhere; none of them is guaranteed by any specification.

### Third-party, labelled as such

- [Text shortcut walkthrough](https://jkost.com/blog/2020/09/30-tips-tricks-and-shortcuts-for-working-type-in-photoshop.html)
  — Adobe's own official blog, used for: placeholder text being pre-selected, `Shift`-click
  forcing a new layer, and the Move cursor outside the bounding box. **Its claims about
  placeholder text and about the commit keys are now redundant** — §3 and §5 cite Adobe directly
  for both
- [AntiAlias — Photoshop Scripting Reference mirror](https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html)
  — the five constants and their one-line descriptions. **Superseded**: `constants.AntiAlias` is
  the primary source now
- [Photoshop CS3 manual mirror](http://www.underwaterphotography.com/photoshop/photoshop/1_16_2_3.html)
  — Adobe-authored CS-era text, and the **only** place found that states a Size-field unit-suffix
  list. **That list is REFUTED** (§11): `TypeUnits` has three members, not six. The mirror is
  retained here only so the next session does not re-derive the error from it

### 22.2 Superseded claims, collected

Every claim in this document that a later revision found false, in one place, so that none of them
is rediscovered. The current text says so at each site; this table is the index.

| Claim                                                                                  | Verdict                                                                                             | Corrected at |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------ |
| "This document landed; the tool did not."                                              | **false** — part of §5 shipped                                                                      | header, §19  |
| §0 item 1's citations (`Text.tsx:184`, `:71-81`)                                       | **stale** — the bar grew to 336 lines, and the `type-crop.ts` data file was fixed concurrently (§0) | §0           |
| "221 lines"                                                                            | **false** twice: 241, then 336                                                                      | §0 item 4    |
| `TextToolArgs` has seven style fields                                                  | **false** — twelve resolved                                                                         | §1, §7       |
| Size range is 8–500                                                                    | **false** — Adobe's `0.01..1296`                                                                    | §5, §19      |
| Default leading is 1.1 and "tighter than Photoshop's"                                  | **false** — the default is now 1.2, matching Adobe                                                  | §5, §19      |
| `leading` is a multiple of the size                                                    | **false** — a length, `0..4999.99` px                                                               | §5           |
| Auto-leading 120% is font-independent and "exactly" reproducible                       | **withdrawn** — conflicts with `CharacterStyle.useAutoLeading`                                      | §6, §14      |
| Tracking is a `GAP`                                                                    | **superseded** — shipped, with a measured fallback                                                  | §5, §19      |
| All Caps / Small Caps / underline / strikethrough are a `GAP`                          | **superseded** — shipped                                                                            | §5, §19      |
| Underline sits 0.1em below the baseline                                                | **never was an Adobe claim** — it is a reconstruction, and now says so                              | §21.6        |
| The Size field accepts `in, cm, mm, pt, px, pica`                                      | **REFUTED** — `TypeUnits` is `MILLIMETERS / PIXELS / POINTS`                                        | §11          |
| The field converts "to the document's default unit"                                    | **REFUTED** — type has its own unit preference                                                      | §11          |
| Anti-aliasing removal date "unconfirmed"                                               | **resolved** — Adobe employee confirms removal from the type bar in 26.10                           | §5, §22      |
| Faux Bold / Faux Italic are options-bar controls                                       | **false for Photoshop** — Character-panel per `CharacterStyle`; Elements is a different product     | §5           |
| Adobe documents the Type options bar's left-to-right order                             | **false** — no Adobe page does; the app's order is its own decision                                 | §5           |
| `Ctrl/Cmd+Return` and keypad `Enter` are not in a helpx commit list                    | **false** — both are verbatim in `creating-type.html`                                               | §3, §22      |
| Converting paragraph→point "must warn first" / "Adobe warns"                           | **overstated** — Adobe's wording is a Note                                                          | §6           |
| Kerning is `n/a`                                                                       | **half false** — the browser kerns by default; the _control_ is a `GAP`                             | §5, §11      |
| "The fallback must be exercised by a test that deletes the property"                   | **false and dangerous** — a prototype deletion is a false pass on Chrome 154                        | §14, §15     |
| "`measureText` must be an injected seam … before any of §5 is testable"                | **false** — §5 is tested through a mock context now                                                 | §15          |
| An `it.fails` on B/I `aria-pressed` at `Text.test.tsx:132`                             | **gone** — removed, replaced by a real assertion                                                    | §15          |
| The replay tripwire is at `text.test.ts:282`                                           | **stale** — it is at `:877`                                                                         | §7, §15, §18 |
| `layer-renderer.ts:32`, `useLayer.ts:278-321`, `:365-381`, `toolProcessors.ts:160-166` | **correct** — re-verified, unchanged                                                                | §0, §1, §7   |
