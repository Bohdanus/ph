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
- **Not shipped** — the rest of the structural work. There is still **no edit mode**, **no caret**,
  **no placeholder text**, **no per-character or per-paragraph style**, **no justification**, **no
  hyphenation**, and **no vertical type**. Those are the `GAP` rows in §2, §3, §4, §6 and §9.

- **Shipped in a second wave** — the **click/drag distinction**: a click places **point** type and
  a drag places **paragraph** type, decided by a named constant in the app. With it, **paragraph
  type wraps**, the paragraph box's width is the width the user dragged, and **Adobe's overflow
  icon** is drawn on the draft overlay. §2, §6, §16 and §19.3 are the item-by-item record; §21.7
  onward is why each layout choice was made and what it costs.

So the status rows are now split three ways: the character-formatting rows in §5 have largely been
converted from `PARTIAL`/`GAP` to `HAVE`, the two-kind rows in §2 and the wrapping row in §6 moved
in the second wave, and the interaction rows in §3 and §4 have not moved at all. §16 is renumbered
to list only what has not landed.

Researched 2026-09-30; re-researched and re-derived 2026-10-01; a second wave of research and
implementation on 2026-10-02. Sources in [§22](#22-sources). Every claim about this repository was
re-verified against the tree in this worktree; every claim about Photoshop is either quoted from
Adobe or labelled third-party.

**Status legend.** `HAVE` — implemented. `PARTIAL` — implemented, narrower than the requirement.
`GAP` — not implemented. `OUT` — deliberately not implemented, with the reason.

---

## 0. Corrections to the previous version of this document

The previous revision of this file (landed `54f2b212`) carried claims that the tree has since
outgrown. They are recorded here rather than silently corrected, because a stale requirements doc
is worse than none — it sends the next session to verify a defect that is already gone.

| #   | Stale claim                                                                                                              | The truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "There is no colour control on this bar at all: the type fill is slaved to the global foreground swatch."                | **False.** `Text.tsx`'s `#text-color` input renders `<input id="text-color" type="color">`, and the comment above `handleColorChange` documents the reversal deliberately: the bar owns the colour and the store's foreground no longer overwrites it. `Text.test.tsx`'s `it('renders a Color swatch bound to the tool args colour')` and `TextToolArea.test.tsx`'s `it('commits the recalculated rect and leaves the tool its own colour')` pin ownership, and `e2e/text-tool.spec.ts`'s `setTextToolColor()` drives the e2e through `#text-color`. The divergence from Photoshop is narrower: Photoshop also binds `Alt+Backspace` to the foreground colour. |
| 2   | "the layer renderer re-runs a tool's creator only for the six shape tools … so its retained args are never re-rendered." | **True of the runtime path, false unqualified.** `layer-renderer.ts`'s `vectorToolNames` does list six tool names with `text` absent, so the runtime draws from `layer.bitmap`. But the **durable** materializer re-runs the text creator from the retained args (`materialization.ts` — `sourceBitmap()`), pinned by `materialization.assets.test.ts`'s `it('renders a text source through the text creator using its intrinsic size')`. "Never re-rendered" describes one of two engines.                                                                                                                                                                    |
| 3   | "Tests … jsdom only"                                                                                                     | **False.** `e2e/text-tool.spec.ts` exists — 2117 lines and 16 tests, covering both gestures, the Apply gate, the committed layer row, the committed ink, every style control reaching the canvas, and the overflow icon. The counts are not recorded here on purpose: the suite's size is known only by running it, and `docs/TESTING.md` carries that rule.                                                                                                                                                                                                                                                                                                   |
| 4   | "`Text.tsx` … 221 lines"                                                                                                 | It is 336. Several other line references in the old §1 table drifted the same way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | Hyphenation "Words Longer Than N Letters (default 2)"                                                                    | **Default is 5.** Verified against Adobe's own `HyphenationProperties` reference, which documents `wordsLongerThan: 5`, `range [2, 25]`. The value 2 is a CS-era figure still repeated in third-party tutorials.                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**§0 is itself now partly superseded, and that is the point of keeping it.** Items 1–4 describe
code this revision then changed again: `Text.tsx` has grown from 241 lines to 336 and every line
number in the table above has been moved again, item 4 is now wrong by a second revision rather
than one, and item 1's corrected claim ("the bar owns the colour") is still true while its
citations are not. Item 5 is a **fact about Photoshop** and does not age with the tree — it is the
only row above that will still be true when the next session reads it, and it is the model for
how §19 and §22 are written. §19 records this revision's supersessions the same way.

Item 1's source is `src/tools/descriptions/type-crop.ts`'s `appNotes` string, which is what
`docs/TOOLS.md` is generated from — so `docs/TOOLS.md` carries the same false sentence. Fixing the
generated doc means fixing the data file, and a test fails on drift between them.

**That fix landed in a concurrent session, mid-way through this revision, and §0 item 1's line
numbers are stale because of it.** At the time this section was written, the text tool's
`appNotes` still carried three more sentences this revision had made false — an 8–500 size range,
a 1.1 default leading, and a bare `Text.tsx` line reference. As of this writing all three are gone
from the file and the `appNotes` string has moved again since. **Verify the string's current
position before citing it**; the substance of item 1 is unaffected, because the correction it
records was to the _description data_, which is a different file from the options bar `Text.tsx`.

**Every line number in the table above has now drifted a second time, and the file `Text.tsx` is
shorter than the last revision reported rather than longer.** Re-verified 2026-10-02:

| §0 ref                                   | What it pointed at then                    | Where it is now                                                                                                                               |
| ---------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Text.tsx` — the colour swatch           | `<input id="text-color" type="color">`     | the same `#text-color` input, higher up the file                                                                                              |
| `Text.tsx` — the colour-reversal comment | the comment recording the colour reversal  | the same comment, above `handleColorChange`                                                                                                   |
| `Text.tsx` — its last line               | the end of the file (item 4's "336 lines") | **414 lines**, so item 4 is wrong by a second revision in the _other_ direction                                                               |
| `type-crop.ts`'s `appNotes`              | the `appNotes` key                         | **the same key**, further down the file — and a concurrent session refreshed the `sources` array around it without touching the prose (§22.3) |

The colour-input correction is still true and is now pinned in two places rather than one: the
`it('renders a Color swatch bound to the tool args colour')` case in `Text.test.tsx` and the
`it('commits the recalculated rect and leaves the tool its own colour')` case in
`TextToolArea.test.tsx`. §22.2 carries the index. The lesson is the one §0 was written to make:
**a line reference in this document is a claim about a moving file, and §0 is where that claim is
allowed to be visibly wrong.**

---

## 1. Current state of the tool

| Area             | File                                                                                                                                                          | What it owns                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Args + rendering | `src/tools/text.ts` — `TextToolArgs`, `layoutText`, `renderText`, the `text` creator                                                                          | `TextToolArgs`, `layoutText`, `renderText`, the `text` creator                                                                                             |
| The two kinds    | `src/tools/text.ts` — `POINT_TYPE_MAX_DRAG_PX`, `TextKind`, the optional `kind` field, `resolveTextKind`                                                      | `POINT_TYPE_MAX_DRAG_PX`, `TextKind`, the optional `kind` field, `resolveTextKind`                                                                         |
| Layout authority | `src/tools/text.ts` — `textWrapWidth`, `wrapLine`, `layoutText`, `getTextLineCount`                                                                           | `textWrapWidth`, `wrapLine`, `layoutText`, `getTextLineCount`                                                                                              |
| Adobe constants  | `src/tools/text.ts` — `FONT_SIZE_MIN/MAX`, `TRACKING_MIN/MAX`, `AUTO_LEADING`, `UNDERLINE_BELOW_BASELINE_EM`, `OVERFLOW_INDICATOR_PX`                         | `FONT_SIZE_MIN/MAX`, `TRACKING_MIN/MAX`, `AUTO_LEADING`, `UNDERLINE_BELOW_BASELINE_EM`, `OVERFLOW_INDICATOR_PX`, each carrying its Adobe citation in place |
| Overflow icon    | `src/tools/text.ts` — `TextLayout`, `RenderTextOptions`, `drawOverflowIndicator`                                                                              | `TextLayout.overflow`, `RenderTextOptions`, `drawOverflowIndicator`                                                                                        |
| Renderer helpers | `src/tools/text.ts` — `fontShorthand`, `trackingPx`, `hasLetterSpacing`/`hasFontVariantCaps`, `applyTextStyle`, `inkWidth`, `fillLine`, `decorationThickness` | `fontShorthand`, `trackingPx`, the two feature tests, `applyTextStyle`, `inkWidth`, `fillLine`, the decorations                                            |
| Registry entry   | `src/tools/toolProcessors.ts` — the `text` entry                                                                                                              | `commit: 'source'`, `creator: true`                                                                                                                        |
| Toolbar          | `src/components/ToolbarsRight/Text/Text.tsx` — the `Text` component's returned bar                                                                            | textarea, font, size, leading, tracking, colour, align, six toggles, Apply/Clear                                                                           |
| Font picker      | `src/components/ToolbarsRight/Text/FontSelect.tsx` — `FONTS`                                                                                                  | 14 hard-coded families, hover preview, Escape/outside-click revert                                                                                         |
| Canvas area      | `src/components/Main/TextToolArea.tsx` — `useRect` wiring and `redrawText`                                                                                    | `useRect` wiring and the click/drag decision, overlay repaint                                                                                              |
| Rect growth      | `src/util/rect.ts` — `calculateNewRect`, whose two arms are the paragraph one (height only) and the point one (grow to fit, then re-place)                    | `calculateNewRect` — two arms: paragraph sizes by height only, point grows to fit and re-places                                                            |
| Commit           | `src/contexts/useLayer.ts` — `createLayerFromTool` and `commitDirtyTool`                                                                                      | `createLayerFromTool`; `commitDirtyTool` and its text branch                                                                                               |
| Settings         | `src/tools/settings.ts` — the `defaultSettings` text seed; `src/util/settings.ts` — `saveLastSettings`                                                        | the `text:` seed, now including `kind: 'point'`; persistence omits `text`, `rect` **and `kind`**                                                           |
| Graphemes        | `src/util/string.ts` — `graphemes`                                                                                                                            | `graphemes()`, the export the manual tracking fallback draws on                                                                                            |

Three things about that table are new, and the first two are consequences of §7. The tool is
**still one flat `TextToolArgs` record with no per-run or per-character structure**, and it is now
a flat record with **twelve resolved style fields** plus one kind, which is what §19 records. And
**two measurement functions write style onto their caller's context before they measure** —
`getTextWidth` and `getTextLineCount` — so both are bracketed in `save`/`restore`, because
`calculateNewRect` hands them the live tool overlay. See §21.5 and §21.12.

**The paragraph arm of `calculateNewRect` is the third new thing, and it is where the box stopped
being decorative.** The width is clamped to the document **first** (`rect.ts` —
`calculateNewRect`'s paragraph arm, before anything is measured), so the preview and the committed
box wrap identically; only the height is content-derived, in that same arm. The grow-to-fit width
arm and the `align` re-placement arm are skipped entirely for a paragraph box (`calculateNewRect`'s
point arm runs only for point), which is what keeps a dragged box the width it was dragged to.
§2, §6 and §21.7 record why.

---

## 2. What a click does today — and what Photoshop's click does

This is the behaviour the naive description gets most wrong, so it is worth stating precisely.

**In this app, a click places point type and a drag places paragraph type. That landed in the
second wave; this paragraph describes what was there before it, because the rows below are the
evidence the change was needed.** `TextToolArea.tsx` spreads only `useRect`'s pointer events, and
`useRect` computes `onChangeEnd` on every valid release with no minimum-distance check at all
(`useRect` — `handlePointerUp`; a grep for `threshold`/`distance`/`MIN_DRAG` across the hook returns
nothing). With a press and release at the same point and no existing rect, `calculateMaskRect`
(`useRect`) takes the fresh-point branch and `adjustFreePoint` (`useRect`) returns a **zero-area
rect**. That zero-area rect then reaches `calculateNewRect`, whose `!text` branch _widens_ it to
roughly `2 × (fontSize × lineHeight + 2 × TEXT_PADDING)` px at the click point, so a bare click
produced a real, non-degenerate draft box and focused the textarea — but a box of no particular
kind, laid out with no wrapping.

`src/util/__tests__/rect.test.ts` — the `it('returns an expanded rect when text is empty')` title —
pins that widening branch as load-bearing, and it is **unchanged** by either wave:
`calculateNewRect`'s `!text` branch still turns a zero-area drag into a non-degenerate box, which is
what makes the overlay mask visible before anything is typed.

**No text is ever auto-created.** `args.text` stays `''`, `Apply` stays disabled (`Text.tsx` — the
`Apply` button's `disabled={!text || !rect}`), and no layer is created. A repo-wide grep for
`lorem`, `placeholder` and `Enter text` returns exactly one production hit — the HTML `placeholder`
attribute on the textarea (`Text.tsx`), which is a DOM hint and never becomes a layer. (That same
`textarea` also carries the token, as a Tailwind `placeholder:` colour variant, which is CSS rather
than an attribute.)

**Photoshop behaves differently, and the difference is a requirement** ([creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), Adobe):

- A **click** places **point type** — a line that expands and shrinks with the text and
  **never wraps**. A **drag** places **paragraph type** — a bounding box whose lines wrap and
  reflow on resize.
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

**The pair as Adobe's API publishes it, and the gap between that and the old scripting reference.**
`TextToolArgs.kind` is `'point' | 'paragraph'`, mirroring Adobe's ExtendScript `TextType` enum —
`PARAGRAPHTEXT` is "Text that wraps within a bounding box" and `POINTTEXT` is "Text that does not
wrap" ([Scripting Reference mirror](https://theiviaxx.github.io/photoshop-docs/Photoshop/TextType.html),
**Adobe-authored text in a third-party mirror**; see §22 for the labelling). **The current UXP
reference has no such enum.** `TextItem` publishes the pair as two read-only booleans,
`isPointText` — "True if the Text Layer is a 'Point Text': a horizontal or vertical line of text
that begins where the user clicks in the image" — and `isParagraphText`, plus the two methods
`convertToPointText()` and `convertToParagraphText()`, all since 24.1
([`TextItem`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/textitem),
Adobe). **The API documents the data loss of that conversion nowhere at all** — the full page
carries no warning, no note, no mention of what the conversion costs — and only the helpx page does
(§6). The same page is also the only Adobe statement of what a point type _is_: "a horizontal or
vertical line of text that **begins where the user clicks** in the image", which is the sentence
this wave implemented.

**Requirements**

- `PARTIAL` — **click/drag distinction.** Point type on click, paragraph type on drag
  (`TextToolArea.tsx` — `onChangeEnd`'s pointer-travel test against `POINT_TYPE_MAX_DRAG_PX`), and `resolveTextKind` (`text.ts`) resolves a
  record with no `kind` at all to **`point`**. It is `PARTIAL` rather than `HAVE` for two reasons,
  both Adobe's:
  - **The threshold is this app's, and Adobe documents no threshold of any kind.** Adobe
    distinguishes the gestures by _intent_, as prose: "Select anywhere in the document and start
    typing to add point text" and "Drag anywhere in the document to add paragraph text"
    ([add text](https://helpx.adobe.com/photoshop/desktop/text-typography/get-started-with-text/add-text.html),
    Adobe). No distance, no time, no tie-break for a one-pixel drag. `POINT_TYPE_MAX_DRAG_PX = 3`
    (`text.ts`) is therefore a **RECONSTRUCTION**, named and exported so it is one edit rather
    than a search, and it is measured on **both** axes — crossing it on either one is a drag,
    because a one-pixel-wide box would hand every line an overflow.
  - **Adobe also offers a third route this app has no analogue for**: `Alt`/`Option`+click (or
    drag) opens the **Paragraph Text Size dialog**, where the box's width and height are typed
    rather than dragged. **No Photoshop helpx page for the Type tool documents this.** Adobe's own
    official blog states the gesture without naming the dialog
    ([jkost](https://jkost.com/blog/2020/09/30-tips-tricks-and-shortcuts-for-working-type-in-photoshop.html),
    third-party-listed even though the blog is Adobe's own: "Option -click (Mac) / Alt -click (Win)
    in the image area to set the width and height of the paragraph type bounding box"), the dialog
    name comes from **Elements** documentation, and the gesture is described independently by
    third-party trainers. Treat it as a real Adobe feature with **no tier-1 citation in this
    document**, and as `GAP`.
- `HAVE` — **point vs paragraph type as a stored distinction**, with `point` as the migration
  default, because a record written before the field existed can only have behaved as point type
  (§19.4).
- `GAP` — **placeholder text.** A new type layer is born with placeholder text pre-selected, so
  typing replaces it rather than appending. The preference must gate it.
- `GAP` — **second click creates a second layer**, and a click inside an existing text flow
  enters it instead.
- `HAVE` — **overflow indicator** on the box, drawn only on the draft overlay. The size, the
  corner and the colour are a **RECONSTRUCTION** — §21.11.
- `PARTIAL` — the box. It is a **layout** box for paragraph type (its width constrains the text)
  and a growth box for point type, which still has the grow-to-fit and `align` re-placement arms
  (`rect.ts` — `calculateNewRect`'s point arm). It is not a **transform** box and does not reflow on
  a later resize in the sense §8 requires.

**The largest fidelity gap in the tool has narrowed but not closed.** "Click to place type, type to
replace it" still has no `type to replace it`: there is no edit mode, no caret, and no placeholder,
so the app still asks the user to type into a textarea on the right rather than onto the canvas.
What the second wave bought is that the two gestures Photoshop distinguishes now produce two
genuinely different layers.

---

## 3. Edit mode, commit, cancel

**In this app there is no Photoshop edit mode.** `applyText()` (`Text.tsx`) commits a one-shot
"type into the textarea, press Apply" operation and rasterizes the presentation. The source
arguments are retained, however: selecting an existing layer row with the Type tool active
(`LayersTab.tsx` — `selectLayer()`) hydrates them, and `applyText()` can replace that layer through
`replaceLayerSource()` when the new gesture starts at the layer's original position. A gesture away
from that position creates a new layer. There is no on-canvas caret, character selection,
double-click entry, or cancel for an already placed layer; `clear()` (`Text.tsx`) only discards the
pending draft.

One Adobe commit path _is_ already present: switching tools commits the draft implicitly, because
`goToTool` calls `commitDirtyTool()` first (`src/hooks/useApp.ts` — `goToTool`).

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
- `PARTIAL` — selecting an existing text row with the Type tool active can hydrate its source
  arguments and `Apply` can replace it at the original position. The Photoshop requirement remains
  a `GAP`: edit mode must be entered from the canvas or the layer's type thumbnail, without a
  position-sensitive redraw gesture. This is the blocking requirement for everything in §4 and §6.
- `GAP` — cancel of an in-progress edit.
- `GAP` — `Ctrl/Cmd+Return`, keypad Enter, and Esc bound to commit/cancel. Note the app's own
  trap: the textarea holds focus as soon as the tool is selected (`TextToolArea.tsx` — the
  tool-change focus effect), and `handleKeyDown` (`useKeyboardEvents.tsx`) refuses any shortcut
  without `allowInInput` while a field has focus — so `T` pressed mid-draft types a letter today.
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
  ordinary input. The commented-out caret scaffolding in `TextToolArea.tsx` shows the previous
  approach, and it was wrong for this reason — it is a sketch, not a reference.

**A ready-made foundation exists, and it is now half-used.** `src/util/string.ts` provides
`charLength`, `deleteCharAt`, `deleteLastChar` and `ellipsify`, all **grapheme-cluster-safe** via the
module's `segmenter`, all fully tested (`src/util/__tests__/string.test.ts`). This revision added a
fifth export, `graphemes()`, which returns the clusters themselves — the other three index by
cluster, so a caller iterating the same way they measure needs the clusters rather than `[...str]`,
which splits by code unit and separates a combining mark from its base.

| Export                       | Unit                         | Production consumer                                                                                  |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `graphemes`                  | `graphemes`                  | **`text.ts` — `inkWidth` and `fillLine`** — the manual tracking fallback draws one cluster at a time |
| `charLength`, `deleteCharAt` | `charLength`, `deleteCharAt` | **none** — only the commented-out caret block in `TextToolArea.tsx`                                  |
| `deleteLastChar`             | `deleteLastChar`             | **none** — same                                                                                      |
| `ellipsify`                  | `ellipsify`                  | unrelated callers                                                                                    |

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
app's bar ships in is a design decision of this app** (`Text.tsx` — the `Text` component's returned
bar), pinned as a tab order by `Text.test.tsx`'s
`it('walks the bar left to right, with the style toggles between Italic and Apply')` because it is a
real accessibility property — not because Adobe specifies it.

**Requirements**

- `HAVE` — font family, size, bold, italic, colour, and a per-layer colour swatch. _(unchanged by
  this revision)_
- `HAVE` — **tracking**, `-1000..1000` in 1/1000 em, applied as `ctx.letterSpacing`, with a
  measured manual fallback (`text.ts` — `trackingPx`, `applyTextStyle`'s letterSpacing arm, and
  `fillLine`). §20 and §21.
- `HAVE` — **All Caps** and **Small Caps** as separate booleans via `ctx.fontVariantCaps`
  (`text.ts` — `applyTextStyle`). Chrome synthesises, and `'small-caps'` synthesises only the
  lowercase, which matches Adobe's rule (§20).
- `HAVE` — **underline** and **strikethrough**, drawn in the type colour with `ctx.fillRect` at a
  thickness of `fontSize / 16` (`text.ts` — `decorationThickness`, and `renderText`'s decoration
  arm). **Their vertical positions are a RECONSTRUCTION of this app — §21.6. No Adobe page
  documents where the rule sits.**
- `PARTIAL` — the font list is **14 hard-coded families** (`FontSelect.tsx` — `FONTS`), not a
  platform enumeration. The picker does render each entry in its own face (`FontSelect.tsx` — the
  list button's `fontFamily` style), which is already Photoshop's WYSIWYG behaviour.
- `PARTIAL` — **size**: the **range is Adobe's** (`0.01..1296`, `FONT_SIZE_MIN`/`FONT_SIZE_MAX` in
  `text.ts`) and the control is a number field (`Text.tsx` — the font-size input) because a slider
  over a 1296-wide span puts one point in about a hundredth of a pixel of track. **The unit is not
  Adobe's**: it is CSS px, applied by `fontShorthand` (`text.ts`). Photoshop's is **points** —
  "Points is the default unit of measurement for type" — and the app's canvas carries no document
  resolution, so a point has no denominator here. At 72ppi the two are 1:1. This is what keeps the
  row `PARTIAL` after the range landed.
- `PARTIAL` — bold/italic are booleans, not a style axis, and they now emit a **correctly ordered**
  CSS shorthand (`text.ts` — `fontShorthand`; §19.1 item 1). Photoshop's model is family + style,
  with the family determining which styles exist; the app synthesises `bold`/`italic` prefixes. Faux
  Bold and Faux Italic — the case where the family has no true style — are `GAP` below.
- `PARTIAL` — leading is a unitless ratio `0.5..2.25` applied as `index * fontSize * lineHeight`
  (`text.ts` — `renderText`'s `lineStep` and per-line baseline). **The default is now 1.2**
  (`text.ts` — `AUTO_LEADING`; seeded at `src/tools/settings.ts` — the `text:` seed's `lineHeight`),
  which matches Adobe's `autoLeadingAmount`. **The semantics do not**: Adobe's explicit leading is a
  length and has an Auto mode, this app has neither. The default matching is why this stays
  `PARTIAL` rather than becoming `HAVE`, and the `useAutoLeading` conflict in §6 is why the 1.2 is
  not the last word on it.
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
  anchor itself from the measured ink width (`text.ts` — `applyTextStyle`, and `renderText`'s anchor
  ternary), because `'left'` is the fallthrough for an unrecognised value — a hand-edited or
  forward-version settings record should land where the tool starts rather than silently flip the
  alignment.
- `PARTIAL` — alignment is **paragraph-only in Photoshop and layer-wide here**. Two separate
  shortfalls, and Adobe states the first in both words: "**Alignment options are available only for
  paragraph type.**" ([formatting-paragraphs](https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html),
  Adobe; the same page says the same of justification — "Justification options are available only
  for paragraph type"). **This app applies `align` to point type too**, which was invisible while
  the two kinds were indistinguishable and is now a real divergence: with `kind` present the bar
  offers alignment for a layer Adobe would refuse to align. Separately, one `align` field still
  drives every line, so there is no per-paragraph scope.
- `PARTIAL` — **wrapping.** What ships, all of it in `layoutText` (`text.ts`) as **the single
  layout authority** the renderer draws from and `calculateNewRect` sizes the box with:
  - A paragraph box's **width is the width the user dragged**, clamped to the document _before_
    anything is measured (`rect.ts` — `calculateNewRect`'s `placed` assignment), so the preview and
    the committed box wrap identically. Only the height is content-derived, from the **wrapped**
    line count rather than the hard-break count (the same paragraph arm, through
    `getTextLineCount`). Point type keeps both the grow-to-fit width arm and the `align`
    re-placement arm, so a click's box still grows to fit and still never wraps.
  - Greedy first fit, breaking at spaces only, with `\n` handled as a hard break before wrapping,
    the trailing space trimmed before each fit test, and a word wider than the box never broken and
    never hyphenated. Every one of those four decisions has an Adobe reason or a measured platform
    reason; §21.7 through §21.10 give each.
  - **The overflow fact rides out of the same function**, so the caller does not re-derive the
    layout to get it (`text.ts` — `TextLayout.overflow`, set by `layoutText`).
  - `PARTIAL` because four things Adobe puts in this section are still absent: **justification**
    (all four modes, with the Min/Desired/Max triad), **hyphenation** and all six settings, **the
    indents**, and **space before/after**. Each is a `GAP` below, and none is reachable from the
    current `TextToolArgs`.
- `PARTIAL` — point vs paragraph type, and the wrapping consequences above. **Conversion between
  them is still `GAP`**, and it is the destructive half that matters: converting paragraph → point
  **deletes overflowing characters**, and what Adobe says is a **Note, not a modal warning**:
  "When you convert paragraph type to point type, all characters that overflow the bounding box are
  deleted. To avoid losing text, **adjust the bounding box so that all type is visible prior to
  conversion**." The same page adds a second consequence this document had not recorded: "When you
  convert from paragraph type to point type, **a carriage return is added at the end of each line
  of type (with the exception of the last line)**"
  ([creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html)). A previous revision
  of this line said a faithful implementation "must warn first" and, in §2, that "Adobe warns about
  it" — both overstated a Note into a warning. **A confirmation step is a reasonable thing for this
  app to add, and it would be this app's decision, not a documented Photoshop behaviour.** Note
  also that the app's _own_ click/drag route loses no characters: point type is placed from a click,
  so nothing ever overflowed a box that then got narrowed.
- `GAP` — justification, all four modes, with the Min/Desired/Max triad.
- `GAP` — indents, space before/after.
- `GAP` — hyphenation and all six settings. **The default being `false` is why the wrap does not
  hyphenate today** — `ParagraphStyle.hyphenation` is "boolean … Default false"
  ([`ParagraphStyle`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/paragraphstyle)),
  so not hyphenating is the faithful behaviour _at the default_, not a shortcut. Turning
  hyphenation on is the gap, and it needs dictionary patterns this app does not ship (§13).
- `OUT` — Asian text options (Set Tsume, mojikumi, kinsoku). These need CJK dictionaries this app
  does not ship.

**One Adobe sentence this app cannot yet honour, recorded because it is now reachable.** The
wrap is greedy first-fit; Adobe's is not. Photoshop exposes a **composer**: "The Adobe Every-line
and Single-line Composer can almost always produce tighter, better-looking paragraphs"
([jkost](https://jkost.com/blog/2020/09/30-tips-tricks-and-shortcuts-for-working-type-in-photoshop.html),
third-party-listed) — and the `TextComposer` enumeration exists in Adobe's Scripting Reference,
but **nothing in the current UXP `ps-reference` exposes it**, and Adobe's own helpx does not
document the composer for Photoshop at all. So there is **no tier-1 source for how Photoshop
composes a paragraph**, the greedy breaker is a reconstruction rather than a claim of fidelity, and
§21.7 records what it costs.

---

## 7. The blocking requirement: a live type layer and a run model

Everything in §3 and §4 is downstream of this section, and so is §5's _unbuilt_ rows. **§5's shipped
rows are not, and neither is §6**: tracking, caps, both rules, the Adobe size range, alignment and
wrapping all shipped without this section, as did §6's two kinds of type and the wrapping they select
between. That matters for reading §17, whose first open question this section is the answer to: a
reader who takes a blanket "§3 to §6 waits on this" will expect solving it to unblock work that is
already done.

**Photoshop's own architecture** ([TextItem](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/textitem),
Adobe): a type layer holds `contents` (the character stream), a `characterStyle` and a
`paragraphStyle`, plus `orientation`, `isPointText`/`isParagraphText` and `warpStyle`. Character
formatting is applied over **ranges of the stream**, which is why a selection is what makes every
per-character feature reachable.

Today `TextToolArgs` (`text.ts`) is a flat record — `{ align, bold, color, fontFamily,
fontSize, italic, lineHeight, text, rect }` plus the **five optional character attributes** this
revision added — so one style covers all of `text`. There is nowhere to put "the first three words
are bold", because no such structure exists. §19.2 explains why the new five are optional rather
than required, and that is a persistence constraint, not a modelling choice: **it does not make the
record any less flat.**

### 7.1 What the repository already gives us, and where it stops

This is the part that makes the requirement landable rather than aspirational:

- **The durable sidecar already has a first-class `kind: 'text'` source**
  (`history-model.ts` — `DurableLayerSource`), distinct from both `'vector'` and `'legacy-tool'`,
  carrying `args`, `size` and `sourcePos`. The adapter classifies a tool source with
  `args.toolName === 'text'` into it (`history-adapter.ts` — `convertSource`).
- **The durable materializer already re-runs the text creator from the retained args**
  (`materialization.ts` — `sourceBitmap`), pinned by
  `materialization.assets.test.ts`'s
  `it('renders a text source through the text creator using its intrinsic size')`. The characters
  are therefore already preserved and already re-derivable on one of the two engines.
- **The characters survive commit** in three places: `layer.source.args.text`, the history entry's
  deep-cloned `layerSource.args.text`, and the durable snapshot. **No UI reaches any of them.**

What stops it:

- **The runtime renderer excludes it.** `layer-renderer.ts` — `vectorToolNames` — lists six vector
  tool names; `text` is absent, so `getLayerBitmap` returns the baked `layer.bitmap`. Adding
  `'text'` to that set routes it through `scaleVectorArgs` (`presentation-evaluator.ts`, called from
  `materialization.ts`'s `sourceBitmap`), which requires `start`/`end` — fields text
  args do not have. **A text-specific scaling rule is needed; it is not a one-line membership
  change.**
- **One raster tool destroys the source.** `tempUpdateLayer` sets `source: undefined` for
  `commit: 'raster'` (`useLayer.ts`), and replay's `applyRasterTool` does the same
  (`useHistory.ts`). Once a text layer is painted on, the retained characters are gone.
  A live text layer that also permits painting on itself is asking for a re-derivable source the
  current code deliberately deletes.
- **Hit-testing is rect-based, not glyph-based.** `isPointInLayer` (`affine-transform.ts`) is
  a bounds test against `layer.pos`. A caret needs a **glyph-level** hit test — the character
  whose advance contains the click — which does not exist anywhere in the tree.
- **There is no commit kind that mutates an existing layer's content.** `UPDATE_LAYER_ACTION` is
  **commented out** in `constants.ts`, both as the constant and as a member of the `ActionType`
  union. The only precedents are `commit: 'layer-operation'` (filter stacks) and `commit: 'geometry'`
  (`layer.pos`), neither of which is text-shaped.
- **Undo re-simulates the whole timeline from index 0** on every navigation
  (`history-replay.ts` — `replayHistory`), and every text layer creation re-runs the creator.
  Per-keystroke history granularity — which a live type layer implies — multiplies the entry count
  that replay re-executes.
- **A tripwire already exists**: `src/tools/__tests__/text.test.ts` — the `it.fails('replays text
from a durable vector source without re-rasterizing …')` title — asserts that an identical replay
  reuses the raster instead of re-running `renderText`. Per `AGENTS.md`, fixing that requires
  removing the pin **in the same change**. **Its position moved in this revision** — the previous
  revision of this document cited a line that is a comment inside the alpha-reset suite. Read the
  test name, not the line.
- **The e2e asserts ink stays inside the dragged rectangle** (`e2e/text-tool.spec.ts` — the
  `test('committed text reaches the canvas as foreground pixels inside the dragged rectangle')`
  title, whose four `expect.soft` assertions are what the claim rests on). That invariant is the
  anchor a wrapping implementation must satisfy.

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
  (`history-adapter.ts` — `convertLegacyHistorySafely`).
- **The converter and the append boundary are two independent implementations** of every durable
  rule, deliberately kept apart so a bug cannot reproduce itself (`history-append.ts` — `translate`).
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
edit mode for any of it to happen in. **What the second wave changed is the paragraph box's
authority, not its handles:** before it, the box grew to the widest line and the text ignored it;
now a paragraph box's width constrains the text and a resize re-wraps it, because
`calculateNewRect` is on both the drag path and the resize path.

- `HAVE` — box resize via `useRect`.
- `PARTIAL` — resize only. No scale, skew or rotate.
- `PARTIAL` — reflow on box resize, **for paragraph type only**. **It was a `GAP`, and the reason it
  was is now false**: the old text said "the box currently has no typographic effect on the text at
  all; it only clips and it grows". For a **point** box that sentence is still true — it still grows
  to fit and still never wraps (`rect.ts` — `calculateNewRect`'s point arm) — and point type is
  exactly the kind Photoshop gives a transform box to. It stays `PARTIAL` because the reflow is a
  consequence of wrapping rather than a transform, and because it is confined to the horizontal.
- `GAP` — the in-edit-mode transform box and its modifier matrix. Point type's `Ctrl`-drag box is
  the one item here that becomes reachable the moment edit mode exists.

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

**In this app**: the type tile holds a **single entry** (`toolsMap.ts` — the `text` entry; and
`descriptions/type-crop.ts` — its `photoshopName`), so `Shift+T` re-selects the same tool. One
entry stands in for a four-tool group.

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
- `PARTIAL` — **14 hard-coded families** (`FontSelect.tsx` — `FONTS`). WYSIWYG preview is already
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
| Type size             | points (1/72 in)                            | **px**, emitted by `fontShorthand` (`text.ts`)                 |
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
(`psd-utils.ts`), and the image path writes a single flattened canvas. The PSD importer
already warns that text arrives "as a raster preview; editable text is not preserved"
(`psd-utils.ts` — `loadPsd`'s `visit`) — which is true in both directions today. Both references
are in `src/contexts/psd-utils.ts`, which the old row did not name.

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
2025, and the e2e suite runs system **Chrome** only (`playwright.config.ts` — the sole project,
whose `channel` is `chrome`), so CI will not catch a regression elsewhere. Any use of these must be
feature-detected at the point of use, with a measured manual fallback.

**The previous revision's testing instruction for that fallback was WRONG, and is withdrawn.** It
said the fallback "must be exercised by a unit test that deletes the property". On Chrome 154,
`delete CanvasRenderingContext2D.prototype.letterSpacing` **reports success and leaves the property
present and fully functional** (§20) — so such a test is a **false pass on the real browser**: it
exercises the `letterSpacing` path while claiming to exercise the fallback. **The correct way to
exercise the fallback is a harness that simply omits the key.** That is what `makeTextCtx`
(`src/tools/__tests__/text.test.ts`) does, with `modern: false` as the default, and it is why the
fallback's tests are trusted and the old instruction is not.

**One assignment-order rule came out of the measurements and is not optional.** Assigning
`ctx.font` **resets** `fontVariantCaps` to `'normal'`; `letterSpacing`, `wordSpacing` and
`fontKerning` survive a font assignment. So `applyTextStyle` (`text.ts`) assigns the font
first and the caps last, and `text.test.ts`'s
`it('assigns fontVariantCaps AFTER ctx.font, because assigning the font resets it')` proves the order
by reading `ctx.font` at the moment of the caps assignment. A caps toggle set before the font would
be silently discarded on every redraw, with no error anywhere.

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
  "`getTextWidth` currently reaches into a live context via `rect.ts`, and that has to change
  before any of §5 or §6 is testable". Both halves are false now. `getTextWidth` still reaches a
  live context from `rect.ts` — `calculateNewRect` hands it the caller's canvas ref — but it now
  brackets its own style writes in `save`/`restore` (`text.ts` — `getTextWidth`, §21.5), so it is
  **safe** to hand it a mock, and the whole of §5's tracking, caps and decoration arithmetic is
  tested through exactly that shape. What §5 needed was not a new seam but a renderer that did not
  scribble on the caller's context. **The real seam is `makeMockCtx` plus `makeTextCtx`**
  (`src/tools/__tests__/text.test.ts`), and the rule for it is §14's: **omit the key, do not
  delete it.**
- **Playwright (`npm run test:e2e`, headless)** — caret placement, the click-count ladder, IME
  composition, box drag reflow, the overflow indicator. Real input via `page.mouse` /
  `page.keyboard`. **Three of these now exist and pass** — box drag reflow (the `test('a drag
places paragraph type: the type wraps to the dragged width and the box keeps that width')` title),
  the click/drag distinction itself (the `test('a click places point type: the line does not wrap
and the box grows to fit it')` title), and the overflow indicator (the `test('the overflow icon
is on the draft overlay only while the type outgrows the box')` title) — and the last two
  are what §21.12 argues below. The caret, the click-count ladder and IME remain `GAP` because
  edit mode does.
- **Rendered output** — a text layer's pixels are the only place wrapping, tracking and
  justification are observable. These need a **pixel** assertion. jsdom `toBeVisible()` is not
  evidence about glyphs. The e2e's ink-bounds assertions (the `test('committed text reaches the
canvas as foreground pixels inside the dragged rectangle')` title in `e2e/text-tool.spec.ts`)
  check _position_, not _shaping_. **Twelve of the sixteen e2e tests are pixel assertions** —
  tracking, both rules, both caps, both B/I, and the two kinds all read back the inked pixels and
  compare them — so **the claim in the previous revision of this paragraph, that no e2e asserted
  that tracking, caps or a rule reaches the canvas at all, is false**, and was false before this
  wave.
- **Not pinned by a test** — anti-aliasing and OpenType features. Host behaviour. Say so rather
  than writing a test that passes for the wrong reason.
- **Tripwires to remove in the same change as any fix** — **one remains.**
  `src/tools/__tests__/text.test.ts` — the `it.fails('replays text from a durable vector source
without re-rasterizing …')` title — is the `it.fails` on replay re-rasterization.
  **The B/I `aria-pressed` `it.fails` is GONE** — the previous revision listed it against
  `Text.test.tsx`'s `renderWithProvider` helper, which was never the tripwire's home. It was
  removed: `aria-pressed` now exists on both toggles (`Text.tsx` — the Bold and Italic buttons) and
  the tripwire became a real assertion, `Text.test.tsx`'s
  `it('exposes the bold and italic toggle state through aria-pressed')`, which states in its own
  comment that it "had to become a real assertion in the same change that
  added the attribute". **Do not go looking for it.**
- **A gap in the new tests worth naming.** `src/util/__tests__/string.test.ts` does not import
  `graphemes`, so the export has no direct unit test; it is covered on the fallback path
  (`text.test.ts` — the `it('places each grapheme cluster itself when the platform has no
letterSpacing')` title). That is enough to catch a wrong signature and not enough to catch a
  wrong cluster rule.
- **A second gap, and it is the one that produced a bug.** `getTextLineCount`'s `save`/`restore`
  bracket is **not pinned by any unit test**, and could not be: `rect.test.ts`'s mock `measureText`
  ignores `ctx.font` entirely (`rect.test.ts` — `makeCanvasRef`), and the one direct test
  (`text.test.ts` — the `it('measures the box against the WRAPPED line count, not the hard-break
count')` title) checks the line count rather than the bracket. **The bracket exists only
  because the e2e caught the defect** (§21.12). Removing it would turn the suite green while
  re-breaking the feature, which is the worst available outcome. **Either widen the mock so
  `measureText` honours `ctx.font`, or add an e2e that fails without the bracket** — and the second
  already exists: `e2e/text-tool.spec.ts`'s `test('a drag places paragraph type: the type wraps to
the dragged width and the box keeps that width')`, which is why this is a latent gap rather than a
  live one.

---

## 16. Priority order

Ordered by what unblocks the most per unit of work, not by what Photoshop does first. **Renumbered
2026-10-02: what the second wave shipped is removed, and the reasoning for the survivors is kept.**

Removed, and why each went:

- **_Click = point type, drag = paragraph type_ (old item 2)** — shipped, and it was the cheapest
  genuinely-visible item on the list: one comparison on the rect `useRect` already handed
  `onChangeEnd` (`TextToolArea.tsx` — `onChangeEnd`'s pointer-travel test against `POINT_TYPE_MAX_DRAG_PX`) and one optional field. It
  moved because the click-versus-drag distinction **is the tool's primary interaction** and it
  needed nothing from §7 to land. What remains of it — the Alt-click Paragraph Text Size dialog —
  was folded into §2's `PARTIAL` row rather than kept as a list item.
- **_Text wrapping + overflow indicator_ (old item 5)** — shipped as `PARTIAL`. It was called "the
  largest visual-quality jump and the largest test surface" (§17 old item 4), and that judgement
  held: it needed the durable materializer's re-run of the creator to agree with the preview, a
  single layout authority so the two could not diverge, and a fix for a defect the e2e caught. Its
  remaining halves — justification, hyphenation, indents, per-paragraph scope — are **not** this
  item any more; they are old items 7 and 9 below, which stay.

| #   | Item                                                                     | Why here                                                                                                                         |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Live type layer + run model** (§7)                                     | Blocks every remaining per-character and per-paragraph feature, and re-entering a layer at all                                   |
| 2   | **Placeholder text, pre-selected** (§2)                                  | What makes "click then type" feel like Photoshop. The gesture half landed; **this** is the half that did not                     |
| 3   | **Edit mode + caret + selection** (§3, §4)                               | Commit/cancel, manual kerning, IME, and §7's usability                                                                           |
| 4   | **Orientation / vertical type** (§9)                                     | The one bar control named in the naive description, and the only Adobe-documented one this app omits entirely                    |
| 5   | **Justification, in all four modes** (§6)                                | Paragraph-only in Adobe, which now matters because the two kinds are distinguishable; also the Min/Desired/Max triad             |
| 6   | **Missing-font state** (§10)                                             | A document from a collaborator must always open                                                                                  |
| 7   | **Indents + paragraph spacing** (§6)                                     | Follows the run model, low marginal cost                                                                                         |
| 8   | **Hyphenation** (§6, §13)                                                | Breaks inside a word, so it is a dictionary problem rather than an arithmetic one — the browser exposes no per-language patterns |
| 9   | **Leading as a length, with Auto** (§5)                                  | The default matches Adobe and the semantics still do not (§5, §6)                                                                |
| 10  | **Manual kerning** (§5)                                                  | Needs a caret, so it is item 3 wearing a different hat                                                                           |
| 11  | **Faux Bold / Faux Italic, super/subscript, baseline shift, scale** (§5) | All gated on the run model; none is a bar control in Photoshop anyway (§5)                                                       |
| 12  | **Size in points** (§11)                                                 | The range is already Adobe's; only the unit is left                                                                              |

**What did NOT get renumbered out, deliberately.** Two old rows were half-true after the wave and
were narrowed rather than deleted, because deleting them would have claimed the work is done:

- **Reflow on box resize (§8)** was a `GAP` on the grounds that "the box currently has no
  typographic effect on the text at all; it only clips and it grows." That sentence is now false for
  paragraph type: the box **does** constrain the text, and resizing it re-wraps — because
  `useRect`'s handles republish through the same `calculateNewRect` the drag used. It stays a
  `GAP` for point type, and for the whole of §8's transform matrix, but the row needed rewording
  rather than removing, and §8 now says so.
- **The overflow indicator** was bundled with wrapping as one item. The icon shipped; **the concept
  of text outgrowing a box is now real**, which is what makes §8's transform matrix and §6's
  conversion gap reachable at all.

**Renumbering note.** Two items left (old 2 and 5, both landed), four old items were merged into
narrower survivors (§6's hyphenation became old 9's neighbour rather than riding with wrapping),
and one new item appears at 2 because the gesture landed and only the text half did.

---

## 17. Open questions

These are judgement calls, not research gaps. Each one blocks work downstream. **Three are settled
by the second wave and one is re-posed**, each marked.

1. **Does a text layer stay editable, or commit once?** Today: commit once, to a raster. §3 and
   §7 assume the layer survives. **This is the decision the rest of the document waits on**, and
   §7.1 lists the three places in the current code that would have to change. **Still open** — and
   the wave sharpened it rather than answering it: `kind` is now a field on the committed args
   (`text.ts` — `TextToolArgs`'s optional `kind`), so a live layer now has something structural to
   preserve, and the durable materializer already re-runs the creator from the retained args
   (`materialization.ts` — `sourceBitmap`).
2. **Per-keystroke history, or per-edit?** Photoshop records text edits individually. Replay
   re-simulates the whole timeline from index 0 (`history-replay.ts` — `replayHistory`) and re-runs
   the creator per layer, so per-keystroke granularity has a real cost here. This is a replay
   decision, not a UI one. **Still open.**
3. **Should a text layer survive a raster tool applied to it?** The current code deletes the
   retained source (`useLayer.ts` — `tempUpdateLayer` for the preview, `useHistory.ts` —
   `applyRasterTool` for replay). Keeping both and choosing. Photoshop prompts to rasterize first.
   **Still open** — and the wave added a wrinkle: a live paragraph box is now a piece of geometry
   that a raster tool painted over, so "which of the two is authoritative" stops being a bookkeeping
   question about characters.
4. ~~**Wrapping, or explicitly out of scope?**~~ **ANSWERED 2026-10-02: it shipped**, as `PARTIAL`.
   The old note in this list said wrapping "is the largest visual-quality jump and the largest test
   surface", and that is how it turned out: 15 new unit tests in `text.test.ts`, 6 in `rect.test.ts`,
   3 new e2e, **and a defect only the e2e could catch** (§21.12). The invariant the old text pointed
   at — the e2e's ink-stays-inside-the-rectangle assertion — is now the thing that pins the wrap,
   and it now lives entirely in `e2e/text-tool.spec.ts`'s
   `test('committed text reaches the canvas as foreground pixels inside the dragged rectangle')`,
   whose `expect.soft` assertions are what the claim rests on; before the wave it was spread across
   two unrelated helpers in that file. **What is still open is narrower and is now item 5 on §16's
   list**: the wrap is greedy first-fit and Adobe's is a composer (§6, §21.7), and justification —
   which the wrap made reachable and meaningless — is `GAP`.
5. **Which browser is the floor?** **Partly answered, and it changed the answer.** Tracking is
   feature-detected with a measured manual fallback and needs no floor at all (§19, §21.3).
   `wordSpacing` does, because §6's `wordSpacingDesired` would use it and it is still
   unfeature-detected anywhere. CI is Chrome-only today (`playwright.config.ts` — the sole project,
   whose `channel` is `chrome`). **Still open, and the wave made it slightly worse:** `layoutText`
   reads `inkWidth`, so on a browser **without** `letterSpacing` the wrap is measured by the manual
   per-grapheme fallback — which is ~11.9px wider on `'WAVE AV'` at 64px than the kerned whole-line
   measurement (§20) — and a paragraph box would therefore break one word earlier on such a browser
   than on Chrome. It breaks at the right _places_, just at a slightly different width. Any
   browser-floor decision now has to be made about the **layout** as well as the glyphs.
6. **Whose small caps is a rendering problem, not a layout one?** Chrome **synthesises** rather
   than selecting a real small-cap face (§20), at exactly 0.703125 of the cap height on its Arial.
   A document authored on a machine with a real small-caps font will not match one authored here,
   and no amount of correctness in this app changes that. Whether to treat it as a fidelity gap, a
   documented host limitation, or both is undecided. **Still open** — and the wave widened it:
   synthesised small caps change every character's advance, so they change **where the wrap breaks**
   too, not only how the glyphs look.
7. **Is the underline's 0.1em offset a decision this app gets to keep?** §21.6 records it as a
   reconstruction. It could be made _measured_ instead — `fontBoundingBoxDescent` is available
   (§20) — which would be more defensible and still not a Photoshop figure. **Still open**, and the
   same question now applies verbatim to **three more reconstructions** the wave added: the 3px
   click/drag threshold (§2), the overflow icon's 8px edge and bottom-right corner (§21.11), and the
   greedy-first-fit composer (§21.7). **The general question worth answering once is: does this app
   want a house position on reconstructions — keep them named and pinned, or re-derive each from a
   measured metric where one exists?** That would settle items 7 and the overflow icon in one move
   and is the reason this question is re-posed rather than answered.
8. **Is the 3px threshold right, or should it be tied to something?** `PARTIAL` in §2 says the
   threshold is a reconstruction. The sub-question the wave raised: a threshold in **px** is
   resolution-dependent the way Photoshop's leading is (`TextItem`: "for a 72ppi document"), and a
   trackpad and a mouse disagree about what a "3px" press is. A **time** threshold is the other
   conventional answer and is equally undocumentable. **This is a judgement call the operator owns**;
   §2 records what shipped, not that 3 is correct.

---

## 18. Test inventory that pins today's behaviour

Any implementation that changes the model above will break these. They are listed so the next
session knows what it is walking into — not as an instruction to weaken any of them. **Every unit
named below was re-verified against the tree on 2026-10-02, and every file's length, test count and
block moved during the second wave.** The moved rows are named in the prose under the table.

| File                                                                                                                                                                                                                                 | Pins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Breaks on                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/tools/__tests__/text.test.ts` (1587 lines)                                                                                                                                                                                      | `fontShorthand` order; `fontShorthand`'s grammar-legal shape; the four Adobe constants; `trackingPx`; `resolveTextStyle`'s five defaults, its `lineHeight` fallback, its pass-through and its non-mutation; the empty-draft guard in all four spellings; the shared overlay alpha; `textBaseline`/`textAlign`; the per-line baseline and the 0.8em fallback; the per-line anchor including both overflow cases; tracking's string shape, its `'letterSpacing' in ctx` guard, ink-vs-advance anchoring, the cluster fallback and the zero-tracking path; caps, including the font-before-caps order and the `'fontVariantCaps' in ctx` guard; both rules' thickness, position, colour and off state; `getTextWidth`'s widest line, absent text, trailing-gap subtraction, `(n-1)` fallback, zero clamp, zero-tracking path and style match; creator canvas size; re-rasterization cost. **New in the second wave**: `resolveTextKind` resolving a missing `kind` to `point`; `textWrapWidth`; seven `layoutText` tests (point-as-hard-breaks, wrapping without losing a word, `\n` staying a hard break, never breaking or hyphenating an over-wide word, the trailing-space trim, overflow reported only against a given box height, wrapped-count-vs-hard-break-count); three `renderText` tests for the two kinds; three for the overflow icon including "draws no indicator on the default call"; **the `it.fails('replays text from a durable vector source without re-rasterizing …')` replay tripwire** | most of the model               |
| `src/util/__tests__/rect.test.ts` — the `describe('calculateNewRect')` block                                                                                                                                                         | grow-from-click (`it('returns an expanded rect when text is empty')`), grow-on-wider-text, centre re-placement, **no shrink**, height arithmetic, null-rect precedence. **New in the second wave, six tests**: a paragraph box keeps the dragged width however much wider the text is; a paragraph box is sized by the **wrapped** line count, not the hard-break count; a paragraph box is never re-placed for `align` where point type moves centre and right; a paragraph box already tall enough is left exactly as dragged; a paragraph box wraps at the **clamped** width; and a record carrying **no `kind` key at all** keeps growing, which is what every pre-kind document holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | wrapping and fixed boxes        |
| `src/components/ToolbarsRight/Text/__tests__/Text.test.tsx` (908 lines)                                                                                                                                                              | Apply/Clear gating, the textarea placeholder, the **colour swatch owning its value** (`describe('text colour')`), the four style toggles each in three states (`describe('the four style toggles')`), `publishStyle`'s metric-vs-decoration split (`it('recomputes the rect for a change of metrics and leaves it alone for a change of decoration')`), a persisted record with the five optionals deleted (`it('renders every optional style field as its default when the persisted record predates it')`), the 15-stop tab order including all six toggles (`it('walks the bar left to right, with the style toggles between Italic and Apply')`), the number field over `0.01..1296` (`it('exposes font size as a number field over the whole 0.01..1296 range')`), tracking in 1/1000 em (`it('shows the seeded value in the field and in the readout, in 1/1000 em')`), apply idempotency (`it('commits the same tool args only once, however often Apply is activated …')`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | the whole commit model          |
| `src/components/Main/__tests__/TextToolArea.test.tsx` — the `describe('onChangeEnd')` block                                                                                                                                          | colour ownership in both directions — a drag must not republish the foreground (`it('commits the recalculated rect and leaves the tool its own colour')`), and a foreground change must not republish the args (`it('does not republish the args when only the store foreground changed')`). **New in the second wave, five tests**: a drag commits a paragraph box with the dragged rect handed over unchanged; a click commits a point box with the rect collapsed onto the press origin; a 4px×1px press is a drag; a 200px×3px press is a drag; and a press **exactly at** 3px×3px is a click                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | focus moving to the canvas      |
| `src/contexts/__tests__/useLayer.text.test.tsx` (370 lines)                                                                                                                                                                          | commit idempotency in both directions, cleared-draft shape, distinct-args distinct-layers, text-without-rect committing nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the commit model                |
| `e2e/text-tool.spec.ts` (2117 lines, 16 tests)                                                                                                                                                                                       | drag-then-type order, the Apply gate, the `/^text \d+$/` layer row, **ink stays inside the dragged rectangle** (the `test('committed text reaches the canvas as foreground pixels inside the dragged rectangle')` title, whose `expect.soft` assertions carry the claim), Clear discarding, colour driven through `#text-color`, the six toggles' `aria-pressed`, Bold weighting rather than switching typeface, Italic leaning rather than switching, tracking widening the ink, underline below the band, strikethrough through it, caps differing from each other, the size field clamping at both Adobe ends, the Adobe maximum's ink reaching the document bottom. **New in the second wave, three tests**: `test('a drag places paragraph type: the type wraps to the dragged width and the box keeps that width')`; `test('a click places point type: the line does not wrap and the box grows to fit it')`; `test('the overflow icon is on the draft overlay only while the type outgrows the box')`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | creation gestures, layer naming |
| `src/contexts/__tests__/materialization.assets.test.ts` — `it('renders a text source through the text creator using its intrinsic size')`                                                                                            | a durable `kind: 'text'` source **renders through the text creator** at its intrinsic size                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | nothing — already correct       |
| `src/util/__tests__/settings.test.ts` — `it('stores text settings without text and rect')`, `it('persists the text character attributes verbatim, and invents none of them')`, `it('seeds the text record with exactly these keys')` | text settings persist **without** `text` and `rect`; the five character attributes persist **verbatim and are never back-filled**; and the exhaustive seed key set, which is where `kind` was added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | nothing — correct by design     |
| `src/util/__tests__/string.test.ts` (142 lines)                                                                                                                                                                                      | `charLength`, `deleteLastChar`, `deleteCharAt` on ZWJ sequences and flags. **Does not import `graphemes`** (§15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | the caret work                  |

**The pins this wave rewrote, and the ones that still stand.**

- **Rewrote**: the click/drag rows. `rect.test.ts`'s six new tests **contradict the old inventory's
  framing**, not just its position in the file — the old row said `calculateNewRect` "grows on
  `requiredWidth > currentWidth` and has no shrink branch", which was the whole of §6's `GAP`. Both
  halves of that sentence are now conditional on `kind`. §2, §6 and §16 record the change.
- **Rewrote**: the overflow indicator, which was a `GAP` and is now `HAVE`. The pin that matters is
  the **negative** one — `text.test.ts`'s "draws no indicator on the default call, even for text
  that overflows" — because the icon is chrome and must never reach the creator.
- **Rewrote**: `Text.test.tsx`'s **exhaustive seed key set**, which gained `'kind'`. That test is
  written out literally for this purpose, and it is the only thing that will fail if a sixth
  character attribute is added without the pin moving with it.
- **Still standing, unchanged**: the `it.fails('replays text from a durable vector source without
re-rasterizing …')` replay tripwire (which moved in this revision); the colour-ownership pair in
  `TextToolArea.test.tsx`; the tab order; the committed-ink bounds assertions; the durable
  materializer's text round trip; the `graphemes` coverage gap.

**Two stale pointers in the previous inventory, and both were right about the substance.**
`settings.test.ts` was cited for the text-persistence pin against `it('throws when toolName is
missing')`, which is actually the **draw** arm (`it('stores draw settings without points')`); the
text arms are `it('stores text settings without text and rect')` and `it('persists the text
character attributes verbatim, and invents none of them')`. And the `calculateNewRect` block was
quoted as a bare span; it is the `describe('calculateNewRect')` block, and it grew in this wave,
because the six new paragraph tests live inside it.

**The suite as it stands, measured on `main` in this worktree.** `npm run test`: **324 files,
7933 passed, 0 failed, 27 expected fail**. `npm run test:e2e -- e2e/text-tool.spec.ts`: **16
passed**. The `scripts/__tests__/tool-descriptions.test.mjs` drift failure this section used to
report is gone: the `appNotes` sentence it named has been corrected at source, and the generated
`docs/TOOLS.md` matches its generator. Do not store either figure as a target — `docs/TESTING.md`
carries that rule, and the file sizes below move with the tests.

---

## 19. What each revision shipped

Recorded so the next session does not re-litigate it, and in the register §0 uses: what the code
now does, and which row it moved. Nothing here is a Photoshop behaviour claim unless it carries an
Adobe citation. **There have been two revisions to this tool's rendering and creation model**, so
this section has two tables: §19.1 the character-formatting wave, §19.3 the two-kind wave.

### 19.1 Revision 1 — the character-formatting wave

| #   | Change                                                              | Where                                                                                                       | Adobe basis                                                                                                                                           |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ctx.font` shorthand order                                          | `text.ts` — `fontShorthand`                                                                                 | none needed — this is a CSS grammar fix. `${italic}${bold}${size}px ${family}` produced `64px bold Arial`, which the grammar rejects as a family name |
| 2   | Size field range and control                                        | `text.ts` — `FONT_SIZE_MIN`/`FONT_SIZE_MAX`; `Text.tsx` — the font-size input                               | `CharacterStyle.size`, `0.01..1296`                                                                                                                   |
| 3   | Default leading                                                     | `text.ts` — `AUTO_LEADING`; `src/tools/settings.ts` — the `text:` seed's `lineHeight`                       | `JustificationProperties.autoLeadingAmount` = `120`                                                                                                   |
| 4   | Tracking                                                            | `text.ts` — `TRACKING_MIN`/`TRACKING_MAX`, `trackingPx`, `applyTextStyle`; `Text.tsx` — the tracking slider | `CharacterStyle.tracking`, `-1000..1000`, 1/1000 em                                                                                                   |
| 5   | All Caps / Small Caps                                               | `text.ts` — `applyTextStyle`; `Text.tsx` — the All Caps and Small Caps buttons                              | `formatting-characters.html` — "if the font does not include small caps, Photoshop generates faux small caps"                                         |
| 6   | Underline / Strikethrough                                           | `text.ts` — `renderText`'s decoration arm; `Text.tsx` — the Underline and Strikethrough buttons             | `formatting-characters.html` — "The line is always the same color as the type color"                                                                  |
| 7   | `textBaseline: 'alphabetic'`                                        | `text.ts` — `applyTextStyle`, `baselineOffset`, `renderText`'s per-line baseline                            | none — a renderer decision, measured. §21.1                                                                                                           |
| 8   | `textAlign: 'start'` + ink-width anchoring                          | `text.ts` — `applyTextStyle`, `inkWidth`, `renderText`'s anchor ternary                                     | none — a renderer decision, measured. §21.2                                                                                                           |
| 9   | `getTextWidth` bracketed in `save`/`restore`                        | `text.ts` — `getTextWidth`                                                                                  | none — a leak fix. §21.5                                                                                                                              |
| 10  | `resolveTextStyle` as the one place an absent field becomes a value | `text.ts` — `resolveTextStyle`                                                                              | none — a migration guard. See §19.2                                                                                                                   |
| 11  | `graphemes()` export                                                | `string.ts` — `graphemes`, used at `text.ts`'s `inkWidth` and `fillLine`                                    | none needed. `Intl.Segmenter`, `granularity: 'grapheme'`                                                                                              |

### 19.2 The five character-attribute fields are OPTIONAL, and that is load-bearing

`allCaps`, `smallCaps`, `strikethrough`, `tracking` and `underline` are declared `?` on
`TextToolArgs` (`text.ts`) while `ResolvedTextStyle` has them required (`text.ts`). That is not
tidiness. `saveLastSettings` persists the text record **verbatim** (`src/util/settings.ts` — its
`text` arm), so a settings object written by an earlier build has no key for these fields at all —
not `false`, not `0`, not `undefined`, which are three different documents. Reading the raw args
produced `undefined * fontSize` = `NaN`, and a `fillText` at `y = NaN` draws **nothing at all**
rather than something wrong a user could see. `resolveTextStyle` is the single place that answer
lives, and `Text.test.tsx`'s
`it('renders every optional style field as its default when the persisted record predates it')`
renders the bar from a record with the five keys genuinely deleted, while `settings.test.ts`'s
`it('persists the text character attributes verbatim, and invents none of them')` pins that the save
path neither back-fills them nor drops them.

### 19.3 Revision 2 — the two-kind wave: point vs paragraph, wrapping, the overflow icon

| #   | Change                                                                                                                                         | Where                                                                                                                           | Adobe basis                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `kind?: 'point' \| 'paragraph'` on the args, and `TextKind`                                                                                    | `text.ts` — `TextKind` and `TextToolArgs`'s optional `kind`                                                                     | `TextItem.isPointText` / `isParagraphText` (UXP); ExtendScript `TextType {PARAGRAPHTEXT, POINTTEXT}` (**Adobe-authored text in a third-party mirror**)                                                   |
| 2   | `POINT_TYPE_MAX_DRAG_PX = 3`, and the click/drag test                                                                                          | `text.ts` — `POINT_TYPE_MAX_DRAG_PX`; `TextToolArea.tsx` — `onChangeEnd`'s pointer-travel test against `POINT_TYPE_MAX_DRAG_PX` | **none — a RECONSTRUCTION.** Adobe states the two gestures by intent ("Select anywhere… to add point text" / "Drag anywhere… to add paragraph text") and documents **no threshold**. §21.13              |
| 3   | `resolveTextKind` — absent `kind` means `point`                                                                                                | `text.ts` — `resolveTextKind`                                                                                                   | none — a migration decision, and the only defensible one (§19.4)                                                                                                                                         |
| 4   | `layoutText` as the single layout authority, shared by the renderer and the box measurement                                                    | `text.ts` — `layoutText`, called from `renderText` and `getTextWidth`                                                           | "the lines of type wrap to fit the dimensions of the bounding box" (`creating-type.html`)                                                                                                                |
| 5   | `textWrapWidth` — the width a paragraph box offers its text                                                                                    | `text.ts` — `textWrapWidth`                                                                                                     | none — it is `rect` less `TEXT_PADDING` on both sides, and the box is the app's                                                                                                                          |
| 6   | Greedy first fit at spaces, hard breaks first, trailing space trimmed, **no hyphenation**                                                      | `text.ts` — `wrapLine`                                                                                                          | hyphenation off by default (`ParagraphStyle.hyphenation`, "boolean … Default false"); the `\n` and trailing-space halves are measured, §20                                                               |
| 7   | The paragraph arm of `calculateNewRect`: clamped width first, height only from the wrapped line count, no grow-to-fit, no `align` re-placement | `rect.ts` — `calculateNewRect`                                                                                                  | "the lines of type wrap to fit the dimensions of the bounding box" (`creating-type.html`), §6                                                                                                            |
| 8   | `getTextLineCount`, bracketed in `save`/`restore`                                                                                              | `text.ts` — `getTextLineCount`                                                                                                  | none — a measurement that must not leak. §21.12                                                                                                                                                          |
| 9   | `TextLayout.overflow`, carried out of the layout rather than recomputed                                                                        | `text.ts` — `TextLayout` and `layoutText`'s return                                                                              | "If you enter more text that can fit within a paragraph boundary…, a small box or circle containing a plus symbol (+) appears in place of a handle in the corner of the boundary" (`creating-type.html`) |
| 10  | `drawOverflowIndicator`, drawn **only** on the draft overlay                                                                                   | `text.ts` — `drawOverflowIndicator` and `RenderTextOptions.overflowIndicator`                                                   | the quote above, and nothing else: **the size, the corner and the colour are a RECONSTRUCTION**. §21.11                                                                                                  |
| 11  | `renderText`'s third argument, `overflowIndicator`, opt-in                                                                                     | `text.ts` — `renderText`; `TextToolArea.tsx` — `redrawText`'s `overflowIndicator: true`                                         | none — it is a decision that chrome must never reach the creator                                                                                                                                         |
| 12  | `kind` omitted from persistence, seeded at `'point'`                                                                                           | `src/util/settings.ts` — its `text` arm; `src/tools/settings.ts` — the `text:` seed's `kind`                                    | none — a persistence decision. §19.4                                                                                                                                                                     |
| 13  | 15 tests in `text.test.ts`, 6 in `rect.test.ts`, 5 in `TextToolArea.test.tsx`, 3 new e2e                                                       | the four files, §18                                                                                                             | each test pins an Adobe behaviour above, except the three reconstructions in rows 2, 5 and 10, which pin **this app's** choices as such                                                                  |

### 19.4 `kind` is OPTIONAL and OMITTED FROM PERSISTENCE — both are load-bearing, for opposite reasons

`kind` is declared `?` (`text.ts` — `TextToolArgs`) for exactly the reason §19.2 gives for the five
character attributes: `saveLastSettings` persists the record verbatim, so a settings object, a
history entry or a durable snapshot written by an earlier build has **no key for it at all**.
`resolveTextKind` (`text.ts`) is the single place that becomes a value, and **`point` is the only
defensible default**: a record with no `kind` came from a build whose renderer grew its box to the
widest line and never wrapped, which _is_ point type by Adobe's definition. Resolving it as
`paragraph` would re-flow every existing document's text at the moment it is loaded. Pinned by
`rect.test.ts`'s "keeps growing a record that carries no kind key at all" and by `text.test.ts`'s
`resolveTextKind` case.

**It is also deliberately _not_ persisted** (`src/util/settings.ts` — its `text` arm omits `kind`,
alongside `text` and `rect`), which is the opposite reason: `kind` belongs to **the gesture that
placed the draft**, not to the tool. A remembered `paragraph` would make the next draft wrap inside
the last layer's box before the user has dragged anything. The seed carries `kind: 'point'`
(`src/tools/settings.ts` — the `text:` seed) so the seeded record is complete, and
`settings.test.ts`'s `it('seeds the text record with exactly these keys')` pins that key set
exhaustively — so the asymmetry between "seeded with it, never saved with it" is now a **tested**
asymmetry rather than an accident.

---

## 20. Measured Canvas 2D behaviour

Every number in §21 is a measurement, not a reading of a spec. **Method:** a page served by this
app's own dev server, a real `HTMLCanvasElement` 2D context, and values read back after
`fillText`/`measureText`. Two browser builds on this host, **Google Chrome 154.0.8037.58** (the
`chrome` channel `playwright.config.ts` — the sole project — uses for the e2e) and **Google Chrome
for Testing 153.0.8010.12** (Playwright's bundled `chromium-1243`). **Every number below was
identical on both.**

**`ctx.letterSpacing` — present.**

| Fact                                                                                                                         | Consequence in this app                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `measureText` width grows by `n * spacing` for n = 1..10 — **including the trailing character**                              | `getTextWidth` subtracts one spacing (`text.ts` — `inkWidth`)                                                                                          |
| The **ink** grows by `(n - 1) * spacing`                                                                                     | every anchor and the underline use the ink, not the advance                                                                                            |
| A value with surrounding whitespace is **silently rejected**; the property keeps its old value                               | the assignment is exactly `${n}px`, asserted for shape by `text.test.ts`'s `it('subtracts the trailing tracking gap from the advance Chrome reports')` |
| `'normal'` is **not** a keyword; reset with `'0px'`                                                                          | no string is ever built from a keyword here                                                                                                            |
| No invalid value ever throws                                                                                                 | there is no error path to handle, which is why the bug was silent                                                                                      |
| `'letterSpacing' in ctx` is the only reliable feature test                                                                   | `hasLetterSpacing` (`text.ts`)                                                                                                                         |
| `delete CanvasRenderingContext2D.prototype.letterSpacing` **reports success** and leaves the property present and functional | a prototype-deletion test of the fallback is a **false pass**. §14's old instruction to write one is withdrawn; see §14                                |
| Setting `letterSpacing` does **not** disable kerning — the `AV` pair kerns -4.75px at both 0px and 10px                      | the manual fallback's loss of kerning is the fallback's, not `letterSpacing`'s                                                                         |

**`ctx.fontVariantCaps` — present, and it synthesises.**

| Value            | Measured behaviour on Arial 64px                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `all-small-caps` | `h` gets **exactly** the advance and ink box of `H`, at exactly `0.703125` of the real cap height |
| `small-caps`     | uppercase untouched; only the lowercase is synthesised — which **is** Adobe's documented rule     |
| `petite-caps`    | indistinguishable from `small-caps` on Arial — **not shipped**                                    |
| `titling-caps`   | a no-op on Arial — **not shipped**                                                                |

Assigning `ctx.font` **resets** `fontVariantCaps` to `'normal'`; `letterSpacing`, `wordSpacing` and
`fontKerning` **survive** a font assignment. That asymmetry is the whole of the ordering rule inside
`applyTextStyle` (`text.ts`) — font first, caps last — and it is pinned by reading `ctx.font` at the
moment of the caps assignment (`text.test.ts`'s
`it('assigns fontVariantCaps AFTER ctx.font, because assigning the font resets it')`).

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

### 20.1 The second wave's measurements — the ones the layout rests on

**Different host, different build, and recorded separately rather than merged into the tables above.**
The §20 tables above were taken on **Google Chrome 154** and **Chrome for Testing 153** on this
host. The layout measurements below were taken on **Chromium 153** only, in the browser, against
this app's own dev server. **They are not guaranteed by any specification and they are not the same
measurement run as the tables above**; re-measure before trusting them elsewhere.

| Fact                                                                                                                                                              | Consequence in this app                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`\n` is not a break to canvas.** `measureText('a\nb')` equals `measureText('a b')`, and the inked pixels of `fillText('a\nb')` equal those of `fillText('a b')` | A multi-line string handed to `fillText` draws **one line with a space where the newline is**, so `\n` is split on before anything else (`text.ts` — `layoutText`) |
| **A trailing space is measured; CSS removes it.** `measureText('ab ')` is **5.557px wider** than `measureText('ab')`                                              | The fit test trims the candidate's end (`text.ts` — `wrapLine`), or every line breaks one word early                                                               |
| **A non-breaking space measures identically to a space**, so metrics cannot tell them apart                                                                       | "is this a break opportunity" is a **code-point** check, not a measurement (`text.ts` — `wrapLine`'s `line.split(' ')`)                                            |
| **The live tool overlay reports `10px sans-serif`**, and counts the §20 test string at **162.9px** against the renderer's **64px Arial**                          | A measurement taken on the caller's context without applying the style is measuring the **overlay**, not the type. §21.12                                          |

**That last row is the one worth remembering.** It is not a small ratio; it is the difference
between a box sized from the wrong font and a box sized from the right one, and on a paragraph box
it decided how many lines the text had.

---

## 21. Renderer decisions, and what they cost

**Twelve decisions have been made that Adobe says nothing about.** Each is a decision **of this
app**, none is a Photoshop behaviour, and each is recorded here with its cost. Items 1–6 are the
character-formatting wave; 7–12 are the two-kind wave. **Where an item is a RECONSTRUCTION rather
than a decision, it says so, and §17 item 7 asks the general question of whether this app wants to
keep these or re-derive them.**

**1. `textBaseline: 'alphabetic'`, with the baseline placed by formula** — `rect.y1 + TEXT_PADDING +
fontBoundingBoxAscent + index * fontSize * lineHeight` (`text.ts` — `renderText`'s per-line
baseline). Under `'top'` every y was the browser's idea of the line top, which §20 shows is a
font-dependent constant no exposed metric reproduces. Every decoration this tool draws — the
underline at 0.1em below the baseline, the strikethrough at half the x-height above it — needs a
baseline it can _name_. **Cost:** `fontBoundingBoxAscent` is the font's **ascent**, so on a face
whose ascent exceeds `fontSize * lineHeight` a line can collide with the next one. The two
fallbacks (`ASCENT_FALLBACK_EM` 0.8, `X_HEIGHT_FALLBACK_EM` 0.5, both in `text.ts`) exist because a
bare canvas mock reports `{ width }` and nothing else, and `NaN` draws nothing at all.

**2. Ink width, not advance.** Chrome's `letterSpacing` adds the gap to the **last** character's
advance too (§20), so the advance over-reports the line by exactly one spacing. Every coordinate
derived from a line — the left/centre/right anchors, the underline and strikethrough extents, and
`getTextWidth` itself — uses the ink. `getTextWidth` clamps at 0 (`text.ts` — `inkWidth`), because a
one-glyph line at wide tracking measures negative and a negative extent asks `fillRect` for a
**mirrored rectangle** rather than an error. **Cost:** none; it is the arithmetic the platform
implies. A line is drawn once per `fillText` with `textAlign: 'start'` so the browser is never asked
to place the glyphs.

**3. `'letterSpacing' in ctx` is the only feature test** (`text.ts` — `hasLetterSpacing`), with a
**manual per-grapheme fallback** that positions each cluster itself (`text.ts` — `fillLine`).
**Cost, stated plainly: kerning and any ligature the font would have formed across a cluster boundary
are gone**, worth 11.875px on `'WAVE AV'` at 64px (§20). There is no API to ask for one kerned pair
at a time. This is why the fallback is written as a named branch with its own tests rather than as a
`smoothWidth()` helper nobody reads.

**4. Tracking at zero does not take the fallback** (`text.ts` — `fillLine`). Zero tracking is the
overwhelmingly common case and there is nothing to place by hand, so falling through to the cluster
path would throw kerning away for free. One whole-line `measureText`/`fillText` is the observable
difference, and it is asserted by the **absence** of per-cluster calls (`text.test.ts`'s
`it('draws the whole line in one fillText at zero tracking, so kerning costs nothing')`) — the only
thing that distinguishes the two paths in the call log.

**5. `getTextWidth` brackets `applyTextStyle` in `save`/`restore`** (`text.ts` — `getTextWidth`).
`calculateNewRect` calls it with the **live tool overlay** — `TextToolArea.tsx` hands
`toolOverlayRef` to `useRect` and hands the same ref to `calculateNewRect` — and `applyTextStyle` is
not a measurement, it _writes_ `font`, `textBaseline`, `textAlign`, `letterSpacing` and
`fontVariantCaps` onto the caller's context. Unbracketed, every box recompute left the overlay
wearing the Type tool's typography. This is the same leak `resetOverlayAlpha` exists for, and unlike
that helper it was not closed. **Cost:** none, and it is what makes §5's tracking testable at all —
see §15.

**6. The underline's position is a RECONSTRUCTION.** `UNDERLINE_BELOW_BASELINE_EM = 0.1` (`text.ts`)
is **this app's choice, not an Adobe figure**. No Adobe page documents where the rule sits relative
to the baseline. Adobe documents only that the rule takes the type's colour
(`formatting-characters.html`) and that its `Underline` enum is `NONE / LEFTINVERTICAL /
RIGHTINVERTICAL` with no style, weight or offset of its own
([`constants`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants)); the
Underline Options dialog with its offset control is InDesign/InCopy. The 0.1em sits in the band
browsers and print conventions use. It is a named constant precisely so that it is **one edit**
rather than a search, and `text.test.ts`'s
`it('draws the underline one rule thickness below the baseline, rounded to a whole pixel')` pins the
app's choice as such.

**7. Greedy first fit, because Adobe publishes no composer.** `wrapLine` (`text.ts`) takes the last
word that fits and moves on. **Adobe documents no line-breaking algorithm for Photoshop type at
all**: a `TextComposer` enumeration exists in Adobe's CS-era Scripting Reference, and Adobe's own
blog describes the Every-line and Single-line composers as producing "tighter, better-looking
paragraphs", but **no current UXP reference exposes it and no Photoshop helpx page describes it**.
Greedy first-fit is therefore a reconstruction, not a fidelity claim, and the difference is exactly
what Adobe's composers exist to fix: greedy can leave a very short word alone on a paragraph's last
line where Every-line would pull words down to balance it. **Cost:** measured ~2µs per paragraph for
the naive breaker, so nothing; the real cost is typographic and unquantified. A composer would only
be worth building once the Min/Desired/Max model exists, and that model is `GAP`.

**8. No hyphenation, because Adobe's is off.** `ParagraphStyle.hyphenation` is "boolean … Default
**false**", so a word wider than the box is emitted alone and **overflows** (`text.ts` —
`wrapLine`'s single-token branch) — never broken, never hyphenated. That is the faithful behaviour
_at the default_, which is why it is a decision rather than a shortcut. **Cost:** a narrow paragraph
box holding an unbroken identifier will overflow, and the overflow icon will say so — which is what
Photoshop does too, until hyphenation is switched on. Switching it on is `GAP` and needs dictionary
patterns this app does not ship (§13).

**9. The trailing space is trimmed before the fit test** (`text.ts` — `wrapLine`), and `\n` is split
on **before** wrapping (`text.ts` — `layoutText`). Both are measurements, not preferences: canvas
measures a trailing space that CSS removes (5.557px at the measured size, §20.1), and canvas
renders `\n` as one space advance. **Cost:** none — trimming is a string operation and the split is
one pass. One consequence is real and belongs here: **a non-breaking space is not a break
opportunity, and metrics cannot tell it from a space**, so that is the one rule in the breaker that
is neither measured nor Adobe-documented.

**10. The paragraph box's width is clamped before it is measured** (`rect.ts` — `calculateNewRect`'s
`placed` assignment). Not a renderer decision, but it belongs with them because it exists for the
same reason `layoutText` does: `useRect.drawMask` paints `trimRect(...)` while handing `onRepaint`
the **unclamped** rect, so clamping after measuring would let the preview wrap at the dragged width
while the committed box — the clamped one — wrapped differently. **Cost:** a paragraph box dragged
past the right edge of the document lays out at the edge rather than at the width that was dragged.
That is correct, because the document is the boundary of the image, but it means **the committed
box is not always the rect the user drew** — which is `useRect`'s own existing rule, not a new one.

**11. The overflow icon is chrome, and only the draft overlay has chrome on it.** `renderText`'s
third argument (`RenderTextOptions.overflowIndicator`, `text.ts`) is opt-in and only
`TextToolArea.tsx` — `redrawText`'s `overflowIndicator: true` — sets it. **A committed layer's canvas
is its own box**, so an icon drawn by the creator would be painted into the image, where Photoshop
has no such thing. **The size and the corner are a RECONSTRUCTION.** `OVERFLOW_INDICATOR_PX = 8`
(`text.ts`), bottom-right. Adobe documents the icon's existence and its appearance and **nothing
else** — "a small box or circle containing a plus symbol (+) appears in place of a handle in the
corner of the boundary" — with no size, no corner and no colour, and "box **or circle**" is a choice
this app resolved as a box. Bottom-right is the corner the overflow is read from in every other
application. **Cost:** an 8px icon that scales with neither the type size nor the document
resolution, where Adobe's would have to. It is deliberately fixed rather than derived from the box
so that it is the same object at two zoom levels, and both figures are named constants so they are
one edit rather than a search.

**12. `getTextLineCount` had to be bracketed, and no unit test could have caught it.**
`getTextLineCount` (`text.ts`) brackets `applyTextStyle` exactly as `getTextWidth` does, for exactly
the reason §21.5 gives — `calculateNewRect` hands both the **live tool overlay**. The defect this
fixed is the one worth generalising. Unbracketed, `getTextLineCount` measured the draft in
**whatever the last tool left on the overlay** — measured in the browser, `10px sans-serif` against
the renderer's 64px Arial, and 162.9px for the test string (§20.1). Every candidate therefore
"fit", so **every paragraph box was sized to one line**, and the commit then wrapped the ink into
lines that overflowed the box it had just been handed. Nothing was drawn in the wrong place; the box
was simply the wrong height, which is invisible until you read it.

**Two lessons, and the second is the one to carry.** First: **a measurement that reads a caller's
context must own every state it depends on**, and `applyTextStyle` writing five properties is five
ways to be wrong. Second: **the unit suite could not have caught this, and the e2e did.**
`rect.test.ts`'s mock `measureText` returns a **constant width** regardless of `ctx.font`
(`rect.test.ts` — `makeCanvasRef`), so applying the style changes nothing there; and the one
`getTextLineCount` test (`text.test.ts` — the
`it('measures the box against the WRAPPED line count, not the hard-break count')` title) exercises
the count, not the bracket. **A mock that ignores the property under test cannot pin a defect in that
property** — so the fix is not "add a `save`/`restore` test", it is that the e2e was the only
instrument with the fidelity to see the bug. That is the same argument §15 makes for pixel
assertions, and it is why §15's own gap list has a new entry.

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
  `Fill new type layers with placeholder text`, and `Type > Paste Lorem Ipsum`. **Also, on this
  page: "To justify text, it must be in paragraph text format. Convert a word or short phrase
  (point text) into a paragraph to justify the text"** — the second tier-1 statement that alignment
  and justification are paragraph-only, alongside §6's `formatting-paragraphs` quote
- [Add text in Photoshop](https://helpx.adobe.com/photoshop/desktop/text-typography/get-started-with-text/add-text.html)
  — **the page that defines the two gestures, and the reason §2's threshold is a reconstruction:**
  "Select anywhere in the document and start typing to add point text" and "Drag anywhere in the
  document to add paragraph text", plus "**Point text is a single, editable text layer that appears
  in a straight line without boundaries or a bounding box.** It can include line breaks, and it
  works well for headlines, buttons, or simple annotations." **It states no distance, no time and no
  tie-break**, which is exactly what is being recorded as the app's own
- [Format characters](https://helpx.adobe.com/photoshop/using/formatting-characters.html) — the
  full click-count selection ladder, faux styles, **"The line is always the same color as the type
  color"**, Underline Left/Right, **the faux small caps rule**, super/subscript faux generation, and
  **"Points is the default unit of measurement for type"** with its own preference
- [Line and character spacing](https://helpx.adobe.com/photoshop/using/line-character-spacing.html)
  — leading as a Character-panel value, where auto-leading is changed, **"Metrics kerning is set as
  the default"**, the 1/1000-em tracking unit, the caret-vs-selection field swap, cumulative
  tracking and manual kerning
- [Format paragraphs](https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html) —
  alignment, the four justification modes, Min/Desired/Max semantics, indents, hyphenation, **and
  two paragraph-only rules §6 now depends on**: "**Alignment options are available only for
  paragraph type.**" and "**Justification options are available only for paragraph type** and
  determine word, letter, and glyph spacing." Also: "For point type, each line is a separate
  paragraph"
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
  `contents`, `orientation`, `textClickPoint`, the resolution conversion formula, and the
  conversion methods. **Re-read in full on 2026-10-02 for §2 and §6, and it is the reason the
  `TextType` enum is cited to a mirror rather than to this page**: the current UXP reference
  publishes the two kinds as **read-only booleans** `isPointText` ("True if the Text Layer is a
  'Point Text': a horizontal or vertical line of text that begins where the user clicks in the
  image") and `isParagraphText`, plus `convertToPointText()` and `convertToParagraphText()`, all
  "Min Version 24.1" — and there is **no `TextType` enumeration on the page at all**. It also
  carries **no warning, no note and no mention of what either conversion costs**, which is why §6
  sources the deletion and the added carriage return from `creating-type.html` instead. Its
  `textClickPoint` is the only Adobe-published statement of where a type layer's origin is
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

- **[`TextType` — Photoshop Scripting Reference mirror](https://theiviaxx.github.io/photoshop-docs/Photoshop/TextType.html)**
  — Adobe-authored text in a **third-party mirror**, the same family as the `AntiAlias` entry below.
  The only reference that publishes the point/paragraph pair **as an enum**: `PARAGRAPHTEXT` is
  "Text that wraps within a bounding box" and `POINTTEXT` is "Text that does not wrap", both
  `readonly`. **It is not on any current Adobe-hosted page** — see the `TextItem` entry above,
  which has no enum at all — which is why `text.ts`'s `TextKind` doc comment cites the UXP page for
  the current model and this mirror only for the enum's existence and wording. **Do not cite it as
  Adobe documentation**
- [Text shortcut walkthrough](https://jkost.com/blog/2020/09/30-tips-tricks-and-shortcuts-for-working-type-in-photoshop.html)
  — Adobe's own official blog, used for: placeholder text being pre-selected, `Shift`-click
  forcing a new layer, the Move cursor outside the bounding box, **and `Alt`/`Option`-click setting
  a paragraph type bounding box's width and height** (§2's Alt-click route, which has **no** tier-1
  citation). Its claims about placeholder text and about the commit keys are now redundant — §3 and
  §5 cite Adobe directly for both. **Its claims about the Every-line and Single-line composers**
  ("almost always produce tighter, better-looking paragraphs") are **the only description of
  Photoshop's line composer this document has**, and §6 and §21.7 lean on them only to say that no
  tier-1 source exists
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

| Claim                                                                                                   | Verdict                                                                                                                                                                                                                    | Corrected at      |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| "This document landed; the tool did not."                                                               | **false** — part of §5 shipped                                                                                                                                                                                             | header, §19       |
| §0 item 1's citations (`Text.tsx`'s colour swatch, and the comment recording the colour reversal)       | **stale** — the bar grew again, and the `type-crop.ts` data file was fixed concurrently (§0)                                                                                                                               | §0                |
| "221 lines"                                                                                             | **false** twice: 241, then 336                                                                                                                                                                                             | §0 item 4         |
| `TextToolArgs` has seven style fields                                                                   | **false** — twelve resolved, plus a kind                                                                                                                                                                                   | §1, §7            |
| Point vs paragraph type is a `GAP` (`§2`, `§6`, `§16` old item 2)                                       | **superseded** — a stored `kind`, decided by a click/drag test; the click/drag threshold is a **reconstruction**                                                                                                           | §2, §6, §19.3     |
| Wrapping is a `GAP` ("the box currently has no typographic effect on the text at all")                  | **false** — `layoutText` wraps paragraph type and the dragged width constrains it                                                                                                                                          | §2, §6, §19.3     |
| `calculateNewRect` "grows on `requiredWidth > currentWidth` and has no shrink branch"                   | **was true, now conditional on `kind`** — the whole arm is skipped for a paragraph box                                                                                                                                     | §6, §18           |
| The overflow indicator is a `GAP`                                                                       | **superseded** — shipped, draft-overlay only; size, corner and colour are reconstructions                                                                                                                                  | §2, §19.3, §21.11 |
| Adobe documents a click/drag threshold                                                                  | **false** — Adobe states the two gestures by intent and gives no distance, time or tie-break                                                                                                                               | §2, §17, §19.3    |
| The `TextType` enum is Adobe's current API                                                              | **false** — the current UXP reference has **no** enum; two read-only booleans and two methods. The enum is CS-era ExtendScript, cited to a mirror                                                                          | §2, §19.3, §22    |
| Alignment applies to the whole layer, and nothing says otherwise                                        | **half false** — "Alignment options are available only for paragraph type"; this app aligns point type too                                                                                                                 | §6                |
| "no e2e currently asserts that tracking, caps or a rule reaches the canvas at all"                      | **false** — twelve of sixteen text e2e are pixel assertions                                                                                                                                                                | §15               |
| §21 said "Four decisions"; there were six                                                               | **false** — now twelve, and the count is enumerated                                                                                                                                                                        | §21               |
| `Text.tsx` is 336 lines / §0 item 4                                                                     | **false** — 414, and every §0 line reference moved a second time                                                                                                                                                           | §0, §22.2         |
| The type tile lives in `toolbar-mapping.ts`'s `toolbarMap`                                              | **false** — the file and the export both exist. `toolbarMap` is the `toolbar-mapping.ts` array whose `Horizontal Type Tool` entry carries this tile; `toolsMap.ts` is the registry of tool definitions and carries no tile | §9                |
| The §0/§1/§7 citations in `layer-renderer.ts`, `useLayer.ts`, `toolProcessors.ts`, `materialization.ts` | **correct** — re-verified, unchanged; the `vectorToolNames`, `createLayerFromTool`, `text`-entry and `sourceBitmap` citations all still resolve                                                                            | §0, §1, §7        |
| Size range is 8–500                                                                                     | **false** — Adobe's `0.01..1296`                                                                                                                                                                                           | §5, §19           |
| Default leading is 1.1 and "tighter than Photoshop's"                                                   | **false** — the default is now 1.2, matching Adobe                                                                                                                                                                         | §5, §19           |
| `leading` is a multiple of the size                                                                     | **false** — a length, `0..4999.99` px                                                                                                                                                                                      | §5                |
| Auto-leading 120% is font-independent and "exactly" reproducible                                        | **withdrawn** — conflicts with `CharacterStyle.useAutoLeading`                                                                                                                                                             | §6, §14           |
| Tracking is a `GAP`                                                                                     | **superseded** — shipped, with a measured fallback                                                                                                                                                                         | §5, §19           |
| All Caps / Small Caps / underline / strikethrough are a `GAP`                                           | **superseded** — shipped                                                                                                                                                                                                   | §5, §19           |
| Underline sits 0.1em below the baseline                                                                 | **never was an Adobe claim** — it is a reconstruction, and now says so                                                                                                                                                     | §21.6             |
| The Size field accepts `in, cm, mm, pt, px, pica`                                                       | **REFUTED** — `TypeUnits` is `MILLIMETERS / PIXELS / POINTS`                                                                                                                                                               | §11               |
| The field converts "to the document's default unit"                                                     | **REFUTED** — type has its own unit preference                                                                                                                                                                             | §11               |
| Anti-aliasing removal date "unconfirmed"                                                                | **resolved** — Adobe employee confirms removal from the type bar in 26.10                                                                                                                                                  | §5, §22           |
| Faux Bold / Faux Italic are options-bar controls                                                        | **false for Photoshop** — Character-panel per `CharacterStyle`; Elements is a different product                                                                                                                            | §5                |
| Adobe documents the Type options bar's left-to-right order                                              | **false** — no Adobe page does; the app's order is its own decision                                                                                                                                                        | §5                |
| `Ctrl/Cmd+Return` and keypad `Enter` are not in a helpx commit list                                     | **false** — both are verbatim in `creating-type.html`                                                                                                                                                                      | §3, §22           |
| Converting paragraph→point "must warn first" / "Adobe warns"                                            | **overstated** — Adobe's wording is a Note                                                                                                                                                                                 | §6                |
| That Note is the whole of the conversion's cost                                                         | **incomplete** — Adobe adds a carriage return at the end of each line but the last                                                                                                                                         | §6                |
| The UXP `TextItem` reference documents the point/paragraph pair as an enum                              | **false** — two read-only booleans and two conversion methods, no enum                                                                                                                                                     | §2, §19.3, §22    |
| Kerning is `n/a`                                                                                        | **half false** — the browser kerns by default; the _control_ is a `GAP`                                                                                                                                                    | §5, §11           |
| "The fallback must be exercised by a test that deletes the property"                                    | **false and dangerous** — a prototype deletion is a false pass on Chrome 154                                                                                                                                               | §14, §15          |
| "`measureText` must be an injected seam … before any of §5 is testable"                                 | **false** — §5 is tested through a mock context now                                                                                                                                                                        | §15               |
| An `it.fails` on B/I `aria-pressed`, cited against `Text.test.tsx`                                      | **gone** — removed, replaced by a real assertion                                                                                                                                                                           | §15               |
| The replay tripwire is at a position in `text.test.ts`                                                  | **stale twice** — it moved twice, both times inside the same `it.fails('replays text from a durable vector source without re-rasterizing …')`                                                                              | §7, §15, §18      |
| The same §0/§1/§7 citations, second row                                                                 | **duplicate** — the same four citations are also listed above, where the verdict is `correct`; an index that gives one claim two verdicts is not an index                                                                  | §0, §1, §7        |
