# Text Tool — Requirements

What the Adobe Photoshop Type tool does, and what this editor must do to be faithful to it. This
is a **requirements** document: it states target behaviour and marks what exists today. It is not
an implementation plan and it ships no code.

**This document landed; the tool did not.** Nothing here is implemented. Every `GAP` and `PARTIAL`
row below is still the state of the tree at the commit that added this file. Read it as the
specification the next session implements against, not as a description of the app.

Researched 2026-09-30. Sources in [§19](#19-sources). Every claim about this repository was
re-derived against the tree in this worktree; every claim about Photoshop is either quoted from
Adobe or labelled third-party.

**Status legend.** `HAVE` — implemented. `PARTIAL` — implemented, narrower than the requirement.
`GAP` — not implemented. `OUT` — deliberately not implemented, with the reason.

---

## 0. Corrections to the previous version of this document

The previous revision of this file (landed `54f2b212`) carried claims that the tree has since
outgrown. They are recorded here rather than silently corrected, because a stale requirements doc
is worse than none — it sends the next session to verify a defect that is already gone.

| #   | Stale claim                                                                                                              | The truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "There is no colour control on this bar at all: the type fill is slaved to the global foreground swatch."                | **False.** `Text.tsx:184` renders `<input id="text-color" type="color">`, and `Text.tsx:71-81` documents the reversal deliberately: the bar owns the colour and the store's foreground no longer overwrites it. `Text.test.tsx:286-324` and `TextToolArea.test.tsx:198-230` pin ownership, and `e2e/text-tool.spec.ts:290-307` drives the e2e through `#text-color`. The divergence from Photoshop is narrower: Photoshop also binds `Alt+Backspace` to the foreground colour. |
| 2   | "the layer renderer re-runs a tool's creator only for the six shape tools … so its retained args are never re-rendered." | **True of the runtime path, false unqualified.** `layer-renderer.ts:32` does list six tool names with `text` absent, so the runtime draws from `layer.bitmap`. But the **durable** materializer re-runs the text creator from the retained args (`materialization.ts:166-171`), pinned at `materialization.assets.test.ts:499-516`. "Never re-rendered" describes one of two engines.                                                                                          |
| 3   | "Tests … jsdom only"                                                                                                     | **False.** `e2e/text-tool.spec.ts` exists — 557 lines, 4 tests, covering the drag, the Apply gate, the committed layer row, and the committed ink.                                                                                                                                                                                                                                                                                                                             |
| 4   | "`Text.tsx` … 221 lines"                                                                                                 | It is 241. Several other line references in the old §1 table drifted the same way.                                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | Hyphenation "Words Longer Than N Letters (default 2)"                                                                    | **Default is 5.** Verified against Adobe's own `HyphenationProperties` reference, which documents `wordsLongerThan: 5`, `range [2, 25]`. The value 2 is a CS-era figure still repeated in third-party tutorials.                                                                                                                                                                                                                                                               |

Item 1's source is `src/tools/descriptions/type-crop.ts:105` (`appNotes`), which is what
`docs/TOOLS.md` is generated from — so `docs/TOOLS.md` carries the same false sentence. Fixing the
generated doc means fixing the data file, and a test fails on drift between them.

---

## 1. Current state of the tool

| Area             | File                                                        | What it owns                                                       |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Args + rendering | `src/tools/text.ts:6-81`                                    | `TextToolArgs`, `renderText`, `getTextWidth`, the `text` creator   |
| Registry entry   | `src/tools/toolProcessors.ts:160-166`                       | `commit: 'source'`, `creator: true`                                |
| Toolbar          | `src/components/ToolbarsRight/Text/Text.tsx:16-241`         | textarea, font, size, line height, colour, align, B/I, Apply/Clear |
| Font picker      | `src/components/ToolbarsRight/Text/FontSelect.tsx`          | 14 hard-coded families, hover preview, Escape/outside-click revert |
| Canvas area      | `src/components/Main/TextToolArea.tsx:24-59`                | `useRect` wiring, overlay repaint, textarea focus                  |
| Rect growth      | `src/util/rect.ts:116-173`                                  | `calculateNewRect` — grows to fit, never wraps, never shrinks      |
| Commit           | `src/contexts/useLayer.ts:278-321`, `:365-381`              | `createLayerFromTool`, `commitDirtyTool`'s text branch             |
| Settings         | `src/tools/settings.ts:82-94`, `src/util/settings.ts:30-31` | seed defaults; persistence deliberately omits `text` and `rect`    |

The whole tool is **one flat `TextToolArgs` record with no per-run or per-character structure**.
That single fact drives §4, §5 and §6.

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

`src/util/__tests__/rect.test.ts:207-223` pins that widening branch as load-bearing.

**No text is ever auto-created.** `args.text` stays `''`, `Apply` stays disabled
(`Text.tsx:230`), and no layer is created. A repo-wide grep for `lorem`, `placeholder` and
`Enter text` returns exactly one production hit — the HTML `placeholder` attribute at
`Text.tsx:120`, which is a DOM hint and never becomes a layer.

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

**In this app there is no edit mode.** `Text.tsx:95-102` `applyText` is the commit, and it is a
one-shot "type into the textarea, press Apply, get a raster layer". There is no way back into a
placed layer to change a character, and no way to cancel a partially-typed layer — `clear()`
(`Text.tsx:104-106`) discards the pending draft.

One Adobe commit path _is_ already present: switching tools commits the draft implicitly, because
`goToTool` calls `commitDirtyTool()` first (`src/hooks/useApp.ts:167-169`).

**What Photoshop does** ([editing-text](https://helpx.adobe.com/photoshop/using/editing-text.html)
and [creating-type](https://helpx.adobe.com/photoshop/using/creating-type.html), both Adobe):

- Edit mode has **exactly one visual tell**: the options bar shows the **Commit** and **Cancel**
  pair. "To determine whether a type tool is in edit mode, look in the options bar — if you see
  the Commit button and the Cancel button, the type tool is in edit mode."
- **Entry**: click the text flow with a type tool; double-click the layer on canvas with the Move
  tool; or **double-click the `T` thumbnail in the Layers panel** — that last one enters edit mode
  **with all characters selected**.
- **Commit**: the check mark · `Ctrl+Enter` / `Cmd+Return` · numeric-keypad Enter · selecting any
  other tool · clicking any panel · clicking away on the canvas (watch the cursor become a normal
  arrow first).
- **Cancel**: the cancel button. **`Esc` COMMITS by default** — Adobe's own note: "the Esc key is
  set to commit text by default. You can change this to cancel the changes by … uncheck _Use Esc
  key to commit text_." Every pre-CC-2017 shortcut sheet and most third-party tutorials still say
  Esc cancels; the current default is the opposite, and the preference is why.
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
- `GAP` — the `T` thumbnail and double-click-to-edit in the Layers panel. `LayersTab.tsx` has **no
  `onDoubleClick`** at all; the only editable field there is the layer _name_.
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

**A ready-made foundation exists and is currently orphaned.** `src/util/string.ts` already
provides `charLength`, `deleteCharAt` and `deleteLastChar`, all **grapheme-cluster-safe** via
`Intl.Segmenter`, and all fully tested (`src/util/__tests__/string.test.ts`). Their **only**
consumers are the commented-out caret block at `TextToolArea.tsx:102,126`. They were written for
this work and abandoned with it. Reuse them rather than reaching for `.length` or `.slice()` on a
code-unit index.

---

## 5. Character formatting

Verified against Adobe's `CharacterStyle` reference, which states every default and range
explicitly and is the authoritative source for the numbers:

| Control                   | Range                     | Default           |
| ------------------------- | ------------------------- | ----------------- |
| Size                      | `0.01..1296` px @72ppi    | —                 |
| Leading                   | `0..4999.99` px @72ppi    | `null` (Auto)     |
| Tracking                  | `-1000..1000` (1/1000 em) | —                 |
| Baseline Shift            | `-1296..1296` px @72ppi   | `0`               |
| Vertical Scale            | `0..1000` %               | —                 |
| Horizontal Scale          | `0..1000` %               | —                 |
| Auto kerning              | —                         | `METRICS`         |
| Anti-alias                | —                         | `SHARP`           |
| Faux Bold / Faux Italic   | boolean                   | `false` / `false` |
| Standard ligatures        | boolean                   | `true`            |
| Capitalization            | `NORMAL`                  | `NORMAL`          |
| Underline / StrikeThrough | `NONE` / `STRIKEOFF`      | as listed         |

Load-bearing facts:

- **Tracking is 1/1000 em**, relative to the current type size. Adobe's own example: 100 tracking
  units in a 10-point font is 1 point. It is not points and not pixels.
- **Manual kerning requires the insertion point between two characters.** With a range selected
  it is unavailable and you must use tracking instead. The two are cumulative.
- **Leading is Character-panel-only**, defaults to Auto, and **auto-leading is 120%** of type
  size — configured in the Paragraph panel's Justification dialog, not in Preferences.
- **Underline and strikethrough are always the same colour as the type** (Adobe, verbatim). There
  is no underline-thickness or offset control in Photoshop — the Underline Options dialog is
  InDesign-only.
- **Size sets the em, not the cap height.** The bound is an **input-field clamp, not a rendering
  clamp** — Free Transform exceeds 1296pt. At 300ppi the maximum becomes `(300/72) × 1296 = 5400`.

**Anti-aliasing.** Five levels — None, Sharp, Crisp, Strong, Smooth — each with a Scripting
Reference constant. It is **no longer on the type options bar**: it is reached from the Character
panel, the layer's properties, and the `Type` menu. **The timing of that removal is unconfirmed** —
one community report says 26.10, and the more commonly reported cause of a "missing" control is
the Narrow Options Bar preference. Adobe's own documentation still lists all three routes.

**Requirements**

- `HAVE` — font family, size, bold, italic, colour, and a per-layer colour swatch.
- `PARTIAL` — the font list is **14 hard-coded families** (`FontSelect.tsx:5-20`), not a platform
  enumeration. The picker does render each entry in its own face (`FontSelect.tsx:203`), which is
  already Photoshop's WYSIWYG behaviour.
- `PARTIAL` — size is in **CSS px**, range 8–500, and applied as `${fontSize}px`
  (`text.ts:49`). Photoshop's unit is **points**. At 72ppi the two are 1:1; the app's canvas has no
  resolution attached, so points have no denominator.
- `PARTIAL` — bold/italic are booleans, not a style axis. Photoshop's model is family + style, and
  the family determines which styles exist. The app synthesises `bold`/`italic` prefixes.
- `PARTIAL` — leading is a unitless ratio `0.5..2.25` applied as `index * fontSize * lineHeight`
  (`text.ts:55`). Photoshop's default auto-leading is 1.2, so the app's **default of 1.1 is
  tighter than Photoshop's out-of-the-box setting**, and there is no Auto mode and no absolute
  leading.
- `GAP` — tracking, kerning, baseline shift, vertical/horizontal scale.
- `GAP` — faux small caps, all caps, superscript, subscript, underline, strikethrough.
- `OUT` — anti-aliasing. Canvas 2D delegates glyph rasterisation to the platform and offers no
  selectable edge treatment. This is a **renderer limit, not a missing feature** — see §11.

**Superscript/subscript defaults are unsourced.** No Adobe page states the raise percentage.
Widely-repeated figures (33.3% raise, 58.3% size) trace to InDesign, which makes them
configurable, and to a Wikipedia row marked _citation needed_. Photoshop exposes no such
preference. **Do not treat any percentage as Adobe-documented.**

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
is the 120% default from §5, and it lives here rather than in Preferences.

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

- `HAVE` — left / center / right alignment (`text.ts:35-46`).
- `PARTIAL` — alignment applies to the **whole layer**. `renderText` sets one `ctx.textAlign` and
  every line follows it; there is no per-paragraph scope.
- `GAP` — wrapping, which is what makes the box mean anything. `calculateNewRect` measures the
  widest line and **grows** the box; a line longer than the canvas is clipped at the canvas edge
  rather than reflowed. It also **never shrinks** — `rect.ts:145` grows on
  `requiredWidth > currentWidth` and has no shrink branch.
- `GAP` — justification, all four modes, with the Min/Desired/Max triad.
- `GAP` — indents, space before/after.
- `GAP` — hyphenation and all six settings.
- `GAP` — point vs paragraph type, and conversion between them. Converting paragraph → point
  **deletes overflowing characters** (Adobe); a faithful implementation must warn first.
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

Today `TextToolArgs` is `{ text, fontSize, lineHeight, fontFamily, align, bold, italic, color, rect }`
— one style for all of `text`. There is nowhere to put "the first three words are bold", because
no such structure exists.

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
- **A tripwire already exists**: `src/tools/__tests__/text.test.ts:282` is an `it.fails` asserting
  that an identical replay reuses the raster instead of re-running `renderText`. Per `AGENTS.md`,
  fixing that requires removing the pin **in the same change**.
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

| Concept               | Photoshop                                   | This repo               |
| --------------------- | ------------------------------------------- | ----------------------- |
| Type size             | points (1/72 in)                            | **px** (`Text.tsx:147`) |
| Inter-line space      | points, or % of size (auto 120%)            | unitless ratio          |
| Tracking / kerning    | 1/1000 em                                   | n/a                     |
| Resolution dependence | `newVal = (resolution / 72) × referenceVal` | none                    |

The **Size field accepts** `in, cm, mm, pt, px, pica` and converts to the document's default unit.

**Export.** Photoshop type stays vector in PSD, PDF and EPS. Canvas-rendered text is pixels from
the moment it is drawn. Both save paths flatten: `savePsd` writes each child as a raster canvas
(`psd-utils.ts:240-271`), and the image path writes a single flattened canvas. The PSD importer
already warns that text arrives "as a raster preview; editable text is not preserved"
(`psd-utils.ts:108`) — which is true in both directions today.

- `OUT` — switching the size unit to points. **The requirement is narrower and is the landable
  one: the stored value must name its unit**, so a future points migration is a data migration
  and not an ambiguity.
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

| Photoshop feature      | Canvas 2D             | Status                                                                            |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------- |
| Kerning                | `ctx.fontKerning`     | Available                                                                         |
| Tracking               | `ctx.letterSpacing`   | Baseline 2025 — feature-detect                                                    |
| Word spacing           | `ctx.wordSpacing`     | Baseline 2025 — feature-detect                                                    |
| Small caps / all caps  | `ctx.fontVariantCaps` | Available                                                                         |
| Condensed / expanded   | `ctx.fontStretch`     | Available                                                                         |
| Baseline direction     | `ctx.direction`       | Direction only, not bidi shaping                                                  |
| Language for shaping   | `ctx.lang`            | Available                                                                         |
| Ligature control       | `ctx.textRendering`   | Limited availability                                                              |
| **Auto-leading 120%**  | —                     | Reproduce arithmetically; the default is font-independent, so a constant is exact |
| **Anti-aliasing mode** | —                     | **Unavailable** (§5)                                                              |
| **OpenType features**  | —                     | **Unavailable** (§10)                                                             |
| **Hyphenation**        | —                     | Needs shipped patterns (§13)                                                      |

**Baseline 2025 is not a floor to assume.** `letterSpacing` and `wordSpacing` shipped in March
2025, and the e2e suite runs system **Chrome** only, so CI will not catch a regression elsewhere.
Any use of these must be feature-detected at the point of use, with a measured manual fallback,
and the fallback must be exercised by a unit test that deletes the property.

**The consequence worth stating plainly: the Text tool's glyph rasterisation is the host
browser's, not ours.** Anti-aliasing, hinting, subpixel positioning and the `textRendering` hint
all sit below `fillText`. Any requirement that says "render the text the way Photoshop renders
text" is unreachable, and any export baseline that depends on it is host-dependent rather than a
property of the code.

---

## 15. Verification

Every requirement above needs a test that fails without the change.

- **jsdom (`npm run test`)** — layout arithmetic, run splitting and merging, selection-range
  arithmetic, justification distribution, indent maths. jsdom cannot measure glyphs, so
  `measureText` and the font metrics table must be **injected seams, not globals** —
  `getTextWidth` currently reaches into a live context via `rect.ts:144`, and that has to change
  before any of §5 or §6 is testable.
- **Playwright (`npm run test:e2e`, headless)** — caret placement, the click-count ladder, IME
  composition, box drag reflow, the overflow indicator. Real input via `page.mouse` /
  `page.keyboard`.
- **Rendered output** — a text layer's pixels are the only place wrapping, tracking and
  justification are observable. These need a **pixel** assertion. jsdom `toBeVisible()` is not
  evidence about glyphs.
- **Not pinned by a test** — anti-aliasing and OpenType features. Host behaviour. Say so rather
  than writing a test that passes for the wrong reason.
- **Tripwires to remove in the same change as any fix** — `text.test.ts:282` (the `it.fails` on
  replay re-rasterization), and the `it.fails` on B/I `aria-pressed` at `Text.test.tsx:132`.

---

## 16. Priority order

Ordered by what unblocks the most per unit of work, not by what Photoshop does first.

| #   | Item                                               | Why here                                                                              |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | **Live type layer + run model** (§7)               | Blocks every per-character and per-paragraph feature, and re-entering a layer at all  |
| 2   | **Click = point type, drag = paragraph type** (§2) | The tool's primary interaction, entirely absent                                       |
| 3   | **Placeholder text, pre-selected** (§2)            | What makes "click then type" feel like Photoshop                                      |
| 4   | **Edit mode + caret + selection** (§3, §4)         | Commit/cancel, kerning, IME, and §7's usability                                       |
| 5   | **Text wrapping + overflow indicator** (§2, §6)    | Makes the box mean something; currently decorative                                    |
| 6   | **Tracking, kerning, baseline shift** (§5)         | Highest-frequency typographic control, and `ctx.letterSpacing` exists                 |
| 7   | **Orientation / vertical type** (§9)               | The one bar control named in the naive description                                    |
| 8   | **Character style attributes** (§5)                | Underline, strikethrough, caps, super/subscript                                       |
| 9   | **Justification** (§6)                             | Needs written properly; the commented-out `util/text.ts` is a sketch, not a reference |
| 10  | **Missing-font state** (§10)                       | A document from a collaborator must always open                                       |
| 11  | **Indents + paragraph spacing** (§6)               | Follows the run model, low marginal cost                                              |

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
5. **Which browser is the floor?** §14's Baseline-2025 properties decide whether tracking and word
   spacing are one line or a font-metrics engine. CI is Chrome-only today.

---

## 18. Test inventory that pins today's behaviour

Any implementation that changes the model above will break these. They are listed so the next
session knows what it is walking into — not as an instruction to weaken any of them.

| File                                                            | Pins                                                                                                                                    | Breaks on                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/tools/__tests__/text.test.ts`                              | font shorthand, per-line `fillText` spacing, `getTextWidth`, creator canvas size, re-rasterization cost, the `it.fails` replay tripwire | most of the model               |
| `src/util/__tests__/rect.test.ts:207-334`                       | grow-from-click, grow-on-wider-text, **no shrink**, height arithmetic                                                                   | wrapping and fixed boxes        |
| `src/components/ToolbarsRight/Text/__tests__/Text.test.tsx`     | Apply/Clear gating, the textarea placeholder, three-Applies-one-layer, the colour swatch owning its value, bar tab order                | the whole commit model          |
| `src/components/Main/__tests__/TextToolArea.test.tsx`           | textarea focus on tool select, the empty rendered div, focus after a committed rect                                                     | focus moving to the canvas      |
| `src/contexts/__tests__/useLayer.text.test.tsx`                 | commit idempotency in both directions, cleared-draft shape                                                                              | the commit model                |
| `e2e/text-tool.spec.ts`                                         | drag-then-type order, the Apply gate, the `/^text \d+$/` layer row, **ink stays inside the dragged rectangle**                          | creation gestures, layer naming |
| `src/contexts/__tests__/materialization.assets.test.ts:499-516` | a durable `kind: 'text'` source **renders through the text creator** at its intrinsic size                                              | nothing — already correct       |
| `src/util/__tests__/settings.test.ts:85-105`                    | text settings persist **without** `text` and `rect`                                                                                     | nothing — correct by design     |

---

## 19. Sources

### Adobe — behaviour and interaction

- [Create type in Photoshop](https://helpx.adobe.com/photoshop/using/creating-type.html) — point
  vs paragraph, edit mode, the Commit/Cancel tell, the overflow icon, the editable-without-
  rasterizing list and its Perspective/Distort exceptions, paragraph→point deleting overflow
- [Edit text in Photoshop](https://helpx.adobe.com/photoshop/using/editing-text.html) — commit and
  cancel paths, `Use Esc key to commit text` and its default, spell check, find and replace, the
  three orientation routes, the default font size
- [Add or edit text](https://helpx.adobe.com/au/photoshop/using/add-edit-text.html) —
  `Fill new type layers with placeholder text`, and `Type > Paste Lorem Ipsum`
- [Format characters](https://helpx.adobe.com/photoshop/using/formatting-characters.html) — the
  full click-count selection ladder, faux styles, the underline colour rule, Underline Left/Right
- [Line and character spacing](https://helpx.adobe.com/photoshop/using/line-character-spacing.html)
  — leading, auto-leading 120% and where it is configured, the kerning/tracking units, the
  caret-vs-selection field swap, cumulative tracking and manual kerning
- [Format paragraphs](https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html) —
  alignment, the four justification modes, Min/Desired/Max semantics, indents, hyphenation
- [Horizontal and vertical type tool options](https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html)
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

### Adobe — API reference (authoritative for every default and range in §5 and §6)

- [`CharacterStyle`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle)
  — every character property with its default and range, in pixels for a 72ppi document
- [`ParagraphStyle`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/paragraphstyle)
- [`JustificationProperties`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/objects/options/justificationproperties)
  — the Min/Desired/Max defaults of 80/100/133, 0/0/0, 100/100/100, and auto-leading 120
- [`HyphenationProperties`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/objects/options/hyphenationproperties)
  — all six settings, including `wordsLongerThan` default **5**
- [`TextItem`](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/textitem) —
  `contents`, `isPointText`/`isParagraphText`, `orientation`, the resolution conversion formula,
  and the conversion methods

### Web platform

- [MDN: `CanvasRenderingContext2D`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)
- [MDN: `letterSpacing`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing)
  and [`wordSpacing`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/wordSpacing)
  — Baseline 2025
- [MDN: `textRendering`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/textRendering)
  — limited availability

### Third-party, labelled as such

- [Adobe's own anti-aliasing pull-down missing from the type bar](https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044)
  — a user report, and the **only** source for a 26.10 removal date. Unconfirmed. The Narrow
  Options Bar preference is the more commonly reported cause
- [Text shortcut walkthrough](https://jkost.com/blog/2020/09/30-tips-tricks-and-shortcuts-for-working-type-in-photoshop.html)
  — Adobe's own official blog, used for: placeholder text being pre-selected, `Shift`-click
  forcing a new layer, and the Move cursor outside the bounding box
- [AntiAlias — Photoshop Scripting Reference mirror](https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html)
  — the five constants and their one-line descriptions
- [Photoshop CS3 manual mirror](http://www.underwaterphotography.com/photoshop/photoshop/1_16_2_3.html)
  — Adobe-authored CS-era text, and the only place found that states the Size field's accepted
  unit suffixes and the point/pica preference
