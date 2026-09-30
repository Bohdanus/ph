# Text Tool — Requirements

What the Adobe Photoshop Type tool actually does, and what this editor must do instead, given it
renders type with Canvas 2D rather than a native text engine. Researched 2026-09-28; sources in
[§18](#18-sources).

This is a requirements document, not a plan. It states the target behaviour, marks what exists
today, and separates the parts Photoshop gets from a text engine from the parts it gets from
Canvas — because that line decides which requirements are cheap, which are approximate, and which
are not reachable at all in a browser.

**Status legend.** `HAVE` — implemented in this repo. `PARTIAL` — implemented, behaviour narrower
than the requirement. `GAP` — not implemented. `OUT` — deliberately not implemented, with the
reason.

---

## 1. Current state

| Area                       | File                                                                               | Notes                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Tool arguments / rendering | `src/tools/text.ts`                                                                | `renderText`, `getTextWidth`, `text` OffscreenCanvas processor                |
| Toolbar UI                 | `src/components/ToolbarsRight/Text/Text.tsx`                                       | 221 lines: textarea, font, size, line height, align, B/I, Apply/Clear         |
| Font picker                | `src/components/ToolbarsRight/Text/FontSelect.tsx`                                 | Hard-coded 14-font `FONTS` array, hover-preview + Escape/outside-click revert |
| On-canvas rect + overlay   | `src/components/Main/TextToolArea.tsx`                                             | `useRect` drag-to-size, repaint on text change                                |
| Auto-sizing rect           | `src/util/rect.ts` `calculateNewRect`                                              | Grows right/left per align; height from `lineCount * fontSize * lineHeight`   |
| Tests                      | `src/components/ToolbarsRight/Text/__tests__/`, `src/tools/__tests__/text.test.ts` | jsdom only                                                                    |

The whole tool is **one flat `TextToolArgs` record with no per-run formatting and no per-character
run attributes**. That single fact drives most of §4 and §5.

Deliberately commented out and worth knowing about: `TextToolArea.tsx:63-137` is a
`beforeinput`/`composition`/`keydown` handler that would have done real on-canvas caret editing with
`updateLastHistoryItem`. It is dead code, not a plan.

---

## 2. Type layer kinds

Photoshop has two kinds of type layer, and they are not interchangeable.

**Point type** — click once, type. One line, no bounding box, no wrapping. Each line you press
Enter into is a separate paragraph. There is no box to resize, so a point layer cannot be justified
and cannot be word-wrapped.

**Paragraph (box) type** — click-drag to define a bounding box, then type. Text wraps at the box
edge, the box is resizable, and justification is available. When the text outgrows the box, a
**small box-with-a-plus overflow icon** replaces the resize handle in the corner of the boundary.

The two convert into each other: `Type > Convert to Paragraph Text` and `Type > Convert to Point
Text`. A point layer is a paragraph layer that has not been given a width yet.

- `GAP` — no point/box distinction. Every layer here is box-like: the user always drags a rect via
  `useRect`, and `renderText` hard-splits on `\n` and never wraps.
- `GAP` — no overflow indicator.
- `GAP` — no conversion between kinds.
- `OUT` — justification on point type, for the same reason Photoshop forbids it: there is no
  measure to justify against.

Photoshop's newer **Dynamic Text** (`Type > Convert to Dynamic Text`) reflows font size, spacing
and layout as the box is dragged. It explicitly does not support right-to-left text.

- `OUT` — Dynamic Text. It requires reflowing a _text layout_ during a drag gesture, which is the
  same machinery a live text editor needs. Revisit when §3 exists.

## 3. Edit mode, commit, cancel

Photoshop has an explicit **edit mode**. Clicking a type layer with the Type tool enters it, and
the options bar swaps the tool options for a **Commit** and a **Cancel** button. That pair _is_ the
edit-mode indicator — there is no other visual cue.

Commit: the Commit button · `Ctrl/Cmd+Return` · numeric-keypad Enter · selecting any other tool ·
clicking any layer in the Layers panel · clicking away on the canvas · losing application focus.

Cancel: the Cancel button · `Esc`, **only if** `Preferences > Type > Use Esc key to commit text` is
unchecked. That preference is the reason `Esc` is not a hard contract: with the default setting
`Esc` commits, and to cancel you must first change a preference.

Also: clicking the `T` thumbnail in the Layers panel enters edit mode **and** selects all the text.

- `GAP` — no edit mode. `Text.tsx:82-89` `applyText` is the commit, and it is a one-shot
  "type into the textarea, press Apply, get a layer". There is no way back into a placed text layer
  to change a character.
- `GAP` — no cancel. `clear()` (`Text.tsx:91-93`) discards the pending text and is not a cancel of
  a partially-typed layer.
- `OUT` — the `Esc`-commits-by-default preference. It exists to serve a modal transform state we do
  not have.

`Text.tsx:82-89` deserves a specific note. `appliedArgsRef` is compared by **object identity** and
set before `createLayerFromTool`. It exists to stop a React StrictMode double-invoke from creating
two layers. That is a workaround for a lifecycle problem, not an idempotency guarantee — and it is
the only thing standing between a double-`onChange` and a duplicated layer. Any real commit/cancel
model has to make `createLayerFromTool` itself idempotent on a committed-text id instead.

## 4. Character formatting

Photoshop's Character panel is per-character or per-selection. It is not a document-wide switch.

**Font and style:** family · style (Regular / Bold / Italic / …) · size. Styles are enumerated **per
family** — a family with no italic has no italic entry, rather than offering a synthetic one.

**Style attributes:** Faux Bold · Faux Italic · All Caps · Small Caps · Superscript · Subscript ·
Underline · Strikethrough. Faux styles are the synthetic ones Photoshop generates when the font
lacks the real cut. Small caps uses the font's real small caps when present and generates faux small
caps when not. Underline and strikethrough are **always the same colour as the type**, and on
vertical type underline runs beside the text and strikethrough through it.

**Spacing:** Leading · Tracking · Kerning · Baseline shift · Vertical scale · Horizontal scale.

- Leading is Character-panel-only in Photoshop (not on the options bar) and is `Auto` by default;
  auto-leading is **120% of the type size** and that percentage is itself a setting, in the
  Paragraph panel menu under Justification. On 30pt type, auto-leading is 36pt.
- Tracking and manual kerning are **measured in 1/1000 em**, a unit relative to current type size.
  In a 10pt font 1em = 10pt, so tracking 50 is 0.5pt of extra space. Both are **cumulative**, and
  both are editable at the same time — you can adjust individual letter pairs and then tighten a
  block without disturbing them.
- Kerning has three modes: **Metrics** (the font's own kern pairs, the default), **Optical** (from
  glyph shapes), and **manual** (a number). Manual kerning is only available with the **insertion
  point between two characters** — with a range selected, the Kerning field is disabled and you must
  use tracking instead. When the caret sits between two characters, the Character panel shows
  _kerning_ values; when a range is selected, it shows _tracking_ values. Tracking and Kerning
  cannot both show a live value at the same time.
- Baseline shift is in the same 1/1000 em unit.
- Vertical/horizontal scale rescale the glyphs.

**Colour:** type colour is per-selection, changed from a swatch on the options bar or the Character
panel.

- `HAVE` — font family (`Text.tsx:33`), size as a **px** slider 8-500 (`Text.tsx:136-144`), Bold and
  Italic as booleans (`Text.tsx:70-80`), colour (`Text.tsx:17-20`).
- `PARTIAL` — Bold/Italic are booleans, not a style axis. Photoshop's model is family + style, and
  the family determines which styles exist. `FontSelect.tsx:5-20` has a 14-family array and no
  per-family style list, so `bold` synthesises rather than selecting.
- `PARTIAL` — size is in **px**, and the label says `px` (`Text.tsx:134`). Photoshop's type size
  unit is **points**, and points are resolution-dependent (72pt = 1 inch) while CSS px are
  device-independent (96px = 1 inch). The 4/3 factor matters for export and for any print workflow.
  See §9.
- `PARTIAL` — leading. `lineHeight` is a unitless ratio 0.5–2.25 (`Text.tsx:157-163`) applied as
  `y += fontSize * lineHeight` (`text.ts:49`). Photoshop's default auto-leading is 1.2, so 1.1 is
  _tighter_ than Photoshop's out-of-the-box setting, and there is no "Auto" mode and no absolute
  leading in points.
- `GAP` — tracking, kerning, baseline shift, vertical/horizontal scale.
- `GAP` — faux small caps, superscript, subscript, underline, strikethrough.
- `OUT` — per-character attributes. The document model has no run concept; a text layer has one
  style for all of it. Every "per character" feature above is blocked on §6.

### 4.1 Anti-aliasing

Photoshop's rendering mode is a **per-character** setting with five levels, in the Character panel
and under `Type > Anti-Alias`:

| Value    | Behaviour                        | Use for                           |
| -------- | -------------------------------- | --------------------------------- |
| `None`   | No anti-aliasing; jagged edges   | Pixel fonts, web that you control |
| `Sharp`  | Sharpest of the smoothed options | Small sizes, ~9-12pt              |
| `Crisp`  | Somewhat sharp                   | Small point-sized bitmap text     |
| `Strong` | Heavier                          | Most graphics work                |
| `Smooth` | Smoothest                        | Type over 14pt                    |

`Smooth` is the current best-practice default for body-size type; `None` is the one that visibly
breaks.

- `OUT` — the setting. There is no equivalent: Canvas 2D delegates glyph rasterisation to the
  platform font rasteriser and offers no selectable edge treatment.
- `OUT` — per-character scope of it. Platform AA cannot be switched per range anyway.
- **The export consequence is real and is the actual requirement here.** Photoshop's mode is a
  _document_ property that survives into PSD, TIFF and PDF. Ours would be a _rendering-time_ choice
  the host browser makes. If pixel-identical export across machines is a goal, the Text tool cannot
  own glyph rasterisation — see §11.

## 5. Paragraph formatting

The Paragraph panel is **per-paragraph**, and applies to one paragraph, a range of paragraphs, or
the whole layer (via the Layers panel).

**Alignment** — horizontal type: left / center / right, leaving the opposite edge ragged.
Vertical type: top / center / bottom.

**Justification** — **paragraph type only**, never point type. Four modes: Justify Last Left · Justify
Last Centered · Justify Last Right · Justify All. Justification stretches word, letter and glyph
spacing rather than the spaces alone, and its tuning lives in the Paragraph panel menu:

- Word spacing, 0–1000%, where 100% adds no extra space.
- Letter spacing, −100% to 500%, where 100% adds one full space width between letters.
- Glyph scaling, 50–200% of horizontal glyph width, with 100% meaning height is not scaled.
- **Auto leading**, default 120%.

These spacing options apply to the **entire paragraph**; to tighten a few characters instead, use
tracking.

**Indents** — left indent · right indent · first-line left indent, all measured from the bounding box
or containing line.

**Spacing** — space before paragraph · space after paragraph.

**Hyphenation** — off by default, driven by the language dictionary (each dictionary carries
hundreds of thousands of words with syllable breaks). Advanced options: Words Longer Than N Letters
(default 2) · After First N Letters (default 2) · Before Last N Letters (default 2) · Hyphen Limit
(max consecutive hyphenated lines) · Hyphenation Zone (distance from the right edge) ·
Hyphenate Capitalized Words.

**Asian text options** — `Preferences > Type > Show Asian Text Options` gates a Set Tsume control.
Justification and kerning/tracking adjustments do **not** apply to double-byte CJK characters.

- `HAVE` — left / center / right alignment (`Text.tsx:64-68`, `text.ts:29-41`).
- `PARTIAL` — alignment applies to the whole layer, not a paragraph. `renderText` sets a single
  `ctx.textAlign` and every line follows it.
- `GAP` — justification, all four modes, with word/letter/glyph spacing and auto-leading
  percentage.
- `GAP` — indents, space before/after.
- `GAP` — hyphenation and all six of its settings.
- `OUT` — vertical-type top/center/bottom, Set Tsume, CJK-specific justification rules. These need
  the vertical type orientation that §2 does not have and a CJK dictionary we do not ship.

**Note on the dead `util/text.ts`.** All 33 lines are commented out, and they are the only
justification implementation ever attempted here: `drawJustifiedText` + `justifyLine`, with a
hard-coded `y += 20` and a division by `words.length - 1` that is `0/0` for a single-word line.
It is a sketch, not a reference. The `+ 1` in the gap count is the right instinct (trailing spaces
are not rendered) and the rest needs writing.

## 6. The blocking requirement: a run model

Almost everything in §4 and §5 marked `GAP` is blocked on one missing structure, and this is the
largest single item in this document.

Photoshop stores a type layer as: a character stream plus **style runs** over contiguous ranges of
it, and **paragraph runs** over the stream. Every per-character and per-paragraph feature is a
property of a run. Formatting a selection creates or splits a run; the character count, the glyph
shaping and the layout all follow from `stream + runs`.

Today `TextToolArgs` is `{ text, fontSize, lineHeight, fontFamily, align, bold, italic, color }` —
one style, applied to all of `text`. There is no way to express "the first three words are bold" and
no way to express "this paragraph is justified and that one is not", because there is no place in
the type to put either fact.

Minimum viable shape:

```ts
type TextRun = {
  start: number; // index into the plain-text string, half-open
  end: number;
  style: TextStyle; // font, size, weight, italic, color, tracking, kerning, …
};
type TextParagraph = {
  start: number; // index into the plain-text string
  end: number;
  style: TextParagraphStyle; // align, justify, indents, spacing, hyphenation
};
type TextStyle = {
  fontFamily: string;
  fontSize: number; // §4: points, not px
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: string;
  letterSpacing: number; // 1/1000 em, Photoshop's unit
  baselineShift: number; // 1/1000 em
  verticalScale: number;
  horizontalScale: number;
  fauxBold: boolean;
  fauxItalic: boolean;
  allCaps: boolean;
  smallCaps: boolean;
  superscript: boolean;
  subscript: boolean;
  underline: boolean;
  strikethrough: boolean;
  kerning: { mode: 'none' | 'metrics' | 'optical' | number };
};
```

Consequences that must be designed for, not discovered later:

- **Undo granularity.** Photoshop records text edits in the History panel, and `Edit > Undo` names
  the action. A run split is a document change. Whatever appends to `HistoryItem[]` must treat
  "retyped a character" and "split a style run" as first-class entries. This repository's
  `HistoryItem[]` is the **production replay authority** (see `AGENTS.md` → Architecture status), so
  getting the granularity wrong here is a replay bug, not a UI bug.
- **Layer identity.** A text layer is no longer fully described by its pixels. A run change must
  re-render **and** re-enter history; the layer cannot be treated as an opaque bitmap.
- **Selection.** Runs make selection ranges meaningful, and selection is what makes every
  per-character feature reachable. §3's edit mode and a caret/selection model are prerequisites,
  not parallel work.

## 7. Selection and caret

Photoshop's selection semantics inside a text flow, which a canvas text editor must reproduce:

| Gesture                    | Selects                 |
| -------------------------- | ----------------------- |
| Click                      | Places caret            |
| Double-click               | The word                |
| Triple-click               | The line                |
| Quadruple-click            | The paragraph           |
| Quintuple-click            | All text in the box     |
| `Shift`+click              | Extends                 |
| `Shift`+`←`/`→`            | One character at a time |
| `Shift`+`Cmd/Ctrl`+`←`/`→` | One word at a time      |

Plus: double-clicking the `T` thumbnail in the Layers panel enters edit mode **with everything
selected**.

- `GAP` — the whole model. There is no caret and no selection; text entry is a `<textarea>` in the
  toolbar, and the canvas shows an uneditable render of it.
- `GAP` — the caret-dependent Kerning/Tracking field swap (§4) is impossible without this.

**IME.** `TextToolArea.tsx:81-87` has the `compositionstart`/`compositionend` scaffolding commented
out with the note that the browser fires composition events during IME input. Any caret model has to
be built composition-aware from the start, or CJK and Indic input will corrupt on the first
composed keystroke. The correct shape is to let the browser own composition and treat the caret as
hidden-but-real during a composition, rather than intercepting `keydown`.

## 8. Fonts

- `HAVE` — a font picker with hover-preview, portal-anchored positioning, and Escape / outside-click
  revert to the pre-open value (`FontSelect.tsx`).
- `PARTIAL` — the font list is **14 hard-coded families** (`FontSelect.tsx:5-20`).
- `GAP` — style enumeration per family (§4).
- `GAP` — variable fonts. Photoshop exposes `wght` and `opsz` axes from the Properties panel;
  Canvas 2D reaches them only through a CSS `font-variation-settings`-shaped font shorthand that is
  not part of the canvas font parser in any shipping browser. Treat as a research item.
- `GAP` — OpenType layout features. `liga`, `calt`, `smcp`, `ss01`-`ss20`, `onum`, `tnum`, `zero`,
  `sups`, `subs`, `frac` and the rest. Canvas 2D exposes none of them; the shaper is the platform's
  and takes no feature arguments. The `cv01`-`cv99` and `ss01`-`ss20` families are the user-visible
  ones, and a workaround is to resolve the alternate glyph through a font parser and address it by
  glyph id — a real project, not a checkbox.
- `GAP` — **font fallback on a missing family.** A document saved with a font that is not installed
  must still open, and Photoshop surfaces this as a first-class problem: `Type > Manage Missing
Fonts`, a per-layer "font is missing" state in the Layers panel, and a default replacement
  (Myriad Pro Regular for Roman). A web editor cannot assume the font exists, so this is a
  first-class requirement, not an error path.
- `OUT` — Adobe Fonts / Typekit cloud sync, `Type > Match Font` (identify a font from a rasterised
  selection), and the on-canvas preview of uninstalled cloud fonts. All three require font files
  this application does not ship and, for Match Font, an image-matching model.
- `OUT` — the font engine is loaded lazily and only when a document has a type layer, the Type tool
  is selected, or the Character panel is visible. Interesting for our own perf work, not a
  requirement.

## 9. Coordinates, units, and export

Three units are in play and this tool currently conflates two of them.

| Concept          | Photoshop                        | This repo               |
| ---------------- | -------------------------------- | ----------------------- |
| Type size        | points (1/72 in)                 | **px** (`Text.tsx:134`) |
| Body unit        | pixels                           | pixels                  |
| Inter-line space | points, or % of size (auto 120%) | unitless ratio          |
| Tracking/kerning | 1/1000 em                        | n/a                     |

- `OUT` — switching the type size unit to points. Our canvas is a fixed pixel raster with no
  physical resolution attached, so points have no denominator. `ctx.font` parses `px` and a handful
  of absolute units; a document-level `dpi` would make `pt` meaningful but is a document-model
  change, not a Text-tool change. **The requirement is that the stored value names its unit**, so
  a future points migration is a data migration and not an ambiguity.
- **Export.** Photoshop text stays vector in PSD, PDF and EPS, and uses those outlines on print.
  Canvas-rendered text is pixels from the moment it is drawn. Anything that leaves this application
  as a bitmap is final; there is no re-render at a larger size and no "Update All Text Layers"
  after a font arrives. **This is a hard architectural limit of the renderer, not a missing
  feature** — record it once here so it is not rediscovered per-export-baseline.
  - `OUT` — vector text output, PDF/EPS with live text, and the post-save "Update All Text Layers"
    conversion for legacy bitmap type layers.

## 10. Transforms

**Point type** has a transformable bounding box **even while in edit mode**: `Cmd/Ctrl`-drag shows
the box, and its handles scale, skew and rotate the type. `Shift` constrains proportions, `Alt`
keeps the centre fixed, `Cmd/Ctrl` explores skewed angles.

**Paragraph type** — the box resizes; the type inside reflows. `Cmd/Ctrl`-drag and the bounding-box
handles work in edit mode. A transform commit applies, and the transformed box persists.

The full set of Edit-menu transforms except **Perspective** and **Distort** is allowed without
rasterizing. To transform _part_ of a type layer, it must be rasterized first.

- `HAVE` — the `useRect` drag in `TextToolArea.tsx:24-39` resizes the layer box, and
  `calculateNewRect` (`util/rect.ts:116-154`) re-lays-out the text on font/size/family/line-height
  change. It grows the box in the direction alignment implies, and preserves it when the new text
  fits.
- `PARTIAL` — resize only. No scale, skew, rotate, and no `Cmd/Ctrl`-drag transform in edit mode,
  because there is no edit mode.
- `GAP` — reflow on box resize. There is no wrapping, so the box currently has no typographic
  effect on the text at all; it only clips.

## 11. Non-destructive and destructive conversions

The rasterization boundary, and it is the same one every raster tool in this repo already sits on.

**Editable after** (Photoshop's list): change type orientation · apply anti-aliasing · convert
between point and paragraph type · create a work path from type · Edit-menu transforms except
Perspective and Distort · layer styles.

**Destructive**: `Layer > Rasterize > Type` — irreversible, and afterwards the words and the font
are gone. Applying a brush, eraser, paint bucket, Content-Aware Fill or a filter to a type layer
prompts to rasterize first. `Type > Convert to Shape` turns text into a **shape** layer: still
vector, no longer editable as text, and now deformable with the Direct Selection tool. `Type >
Create Work Path` produces a separate path **and keeps the type layer intact**.

Adobe's own guidance is to duplicate the layer before rasterizing, because there is no undo past
it.

- `OUT` — rasterize prompts and the rasterize menu. Once the layer is a bitmap at commit time
  (`createLayerFromTool`), it is already rasterized and every tool on it works.
- `GAP` — Create Work Path. Cheap and useful: glyph outlines are reachable via
  `Path2D`/`TextMetrics` on some platforms and via a font parser everywhere.
- `OUT` — Convert to Shape. Needs a vector document model this repository does not have.
- `OUT` — text as a layer mask / clipping mask. Needs the run model plus raster output at an
  arbitrary alpha threshold.

## 12. Text on paths, warp, and fill

- **Text on a path** — click the path with the Type tool (cursor becomes an I-beam with a dotted
  circle) and type. The Paths-selection tool then drags the text along the path. Baseline shift
  moves text above or below the path. Dragging a path anchor reshapes the flow live. The text stays
  fully editable, and the path can be deleted without killing the text.
- **Text inside a shape** — the same click-to-type on a closed shape's path, flowing around the
  inside.
- **Warp Text** — `Type > Warp Text`, ~20 presets (Arc, Arc Lower, Arc Upper, Arch, Bulge, …), each
  with a **Bend** slider, horizontal and vertical distortion, and H/V orientation. Unlike Free
  Transform, **warped text stays fully editable** — you can still change the words, font and colour
  with the warp intact. `None` unwarps. Warp is **unavailable when Faux Bold is applied.**
- **Fill text with image** — the type layer's fill comes from an image rather than a colour.

- `OUT` — all four. Text on a path needs path sampling; warp needs per-glyph placement along a
  deformed baseline; fill-with-image needs a layer's fill source decoupled from its colour. Each is
  a project, and warp's editable-after-warping property is the expensive part.

## 13. Spelling, hyphenation, and search

- **Check Spelling** — per language dictionary, selectable per selection or per layer. Layers that
  are **hidden or locked are not checked**. A word not in the dictionary is offered Ignore / Ignore
  All / Change To / Add to Dictionary, and the run is highlighted in the document.
- **Find And Replace Text** — document-wide, across **visible and unlocked type layers only**, with
  case and whole-word options.
- **Hyphenation** — dictionary-driven, see §5.

- `GAP` — all three. `Intl.Segmenter` with `granularity: 'word'` gives word boundaries for the
  double-click selection and for whole-word search; the browser exposes no per-language hyphenation
  patterns, so hyphenation needs a shipped pattern set.
- `OUT` — the personal dictionary and the hidden/locked-layer rules as a rule rather than as
  behaviour. The dictionary is user data with a file format, and it is not this application's job.

## 14. Priorities

Ordered by what unblocks the most per unit of work, not by what Photoshop does first.

| #   | Item                                             | Why here                                                              |
| --- | ------------------------------------------------ | --------------------------------------------------------------------- |
| 1   | **Run model** (§6)                               | Blocks every per-character and per-paragraph feature                  |
| 2   | **Edit mode + caret + selection** (§3, §7)       | Blocks commit/cancel, kerning, IME, and §6 usability                  |
| 3   | **Text wrapping + overflow indicator** (§2)      | Makes the box mean something; currently decorative                    |
| 4   | **Point vs paragraph type** (§2)                 | Reframes the box from decoration to a type kind                       |
| 5   | **Tracking, kerning, baseline shift** (§4)       | Highest-frequency typographic control, and `ctx.letterSpacing` exists |
| 6   | **Character style attributes** (§4)              | Underline, strikethrough, caps, super/subscript                       |
| 7   | **Justification** (§5)                           | `util/text.ts` is a sketch; needs writing properly                    |
| 8   | **Font fallback / missing-font state** (§8)      | A document from a collaborator must always open                       |
| 9   | **Paragraph indents + spacing** (§5)             | Follows the run model, low marginal cost                              |
| 10  | **Per-family styles, undo granularity** (§4, §6) | Needs §6 and the history model                                        |

## 15. Platform constraints

The browser is not Photoshop's text engine, and several requirements above die on that. What Canvas
2D actually offers, and the fallback cost where it is missing.

| Photoshop feature     | Canvas 2D                                                                              | Status                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Kerning (metrics)     | `ctx.fontKerning` — `auto`/`normal`/`none`                                             | Available                                                                                                      |
| Tracking              | `ctx.letterSpacing` — CSS `<length>`, default `0px`                                    | **Baseline 2025** (Mar 2025) — needs a feature check and a manual per-glyph fallback                           |
| Word spacing          | `ctx.wordSpacing` — CSS `<length>`, default `0px`                                      | **Baseline 2025** (Mar 2025), same caveat                                                                      |
| Small caps / all caps | `ctx.fontVariantCaps`                                                                  | Available                                                                                                      |
| Condensed / expanded  | `ctx.fontStretch`                                                                      | Available                                                                                                      |
| Ligature control      | `ctx.textRendering` — `auto`/`optimizeSpeed`/`optimizeLegibility`/`geometricPrecision` | **Limited availability**; only `optimizeSpeed` disables ligatures/kerning, and it is not universally available |
| Baseline direction    | `ctx.direction` — `ltr`/`rtl`/`inherit`                                                | Available (direction only, not full bidi shaping)                                                              |
| Language for shaping  | `ctx.lang`                                                                             | Available                                                                                                      |
| Anti-aliasing mode    | —                                                                                      | **Unavailable** (§4.1)                                                                                         |
| OpenType features     | —                                                                                      | **Unavailable** (§8)                                                                                           |
| Variable font axes    | —                                                                                      | **Unavailable** (§8)                                                                                           |
| Auto-leading 120%     | —                                                                                      | Reproduce arithmetically; the value is a font-independent default, so a constant is exact                      |
| Indent / space before | —                                                                                      | Reproduce in layout code                                                                                       |
| Hyphenation           | —                                                                                      | Needs shipped patterns (§13)                                                                                   |

**Baseline 2025 is not a floor to assume.** `letterSpacing` and `wordSpacing` shipped in March 2025.
The e2e suite runs system **Chrome** only (`playwright.config.ts:93-102`), so CI will not catch a
regression in Firefox or Safari. Any use of these properties must be feature-detected at the point
of use, with a measured manual fallback, and the fallback must be exercised by a unit test that
deletes the property — jsdom will not exercise the real one either way.

The consequence worth stating plainly: **the Text tool's glyph rasterisation is the host browser's,
not ours.** Anti-aliasing, hinting, subpixel positioning and the `textRendering` hint all sit below
`fillText`. Any requirement that says "render the text the way Photoshop renders the text" is
unreachable, and any export baseline that depends on it will be host-dependent rather than a
property of the code.

## 16. Verification

Per `AGENTS.md` → Definition of Done, every item above needs a test that fails without the change.

- **jsdom (`npm run test`)** — layout arithmetic, run splitting and merging, selection-range
  arithmetic, justification distribution, indent maths. jsdom cannot measure glyphs, so every
  measurement input must be injectable: `measureText` and the font metrics table are seams, not
  globals. The `getTextWidth` call in `util/rect.ts:134` reaches into a live context; that has to
  become an injected seam before any of §5 or §6 is testable.
- **Playwright (`npm run test:e2e`, headless, Chrome)** — caret placement, click-to-word/line/
  paragraph selection, IME composition, box drag reflow, overflow indicator appearance. Real input
  via `page.mouse` / `page.keyboard`, per the test traps in `AGENTS.md`.
- **Rendered output** — a text layer's pixels are the only place wrapping, tracking and
  justification are actually observable. These need a pixel assertion, not a DOM assertion. jsdom
  `toBeVisible()` is not evidence about glyphs.
- **Not pinned by a test** — anti-aliasing and OpenType features. They are host behaviour. Say so
  rather than writing a test that passes for the wrong reason.

## 17. Open questions

1. **Does a text layer stay editable, or commit once?** Today: commit once, immediately, to a
   bitmap. Everything in §3 and §6 assumes the layer survives. That is the single decision the rest
   of this document waits on.
2. **Where does the run model live?** `HistoryItem[]` is production replay authority. Do runs go
   into the history entry, or into a layer property the history entry references? The second keeps
   entries small; the first keeps replay total.
3. **Is a text layer rasterized at commit or lazily?** Committing immediately means no re-render at
   export resolution and no missing-font recovery. Lazily means the layer must survive save/load
   with its text model intact, which is the durable-document question, not the Text-tool question.
4. **Do we implement wrapping, or ship it as out of scope?** The bounding box is currently
   decorative. Wrapping is the largest visual-quality jump and the largest test surface.
5. **Which browser is the floor?** §15's Baseline-2025 properties decide whether tracking and word
   spacing are one line or a font-metrics engine. CI is Chrome-only today.

---

## 18. Sources

- [Create type in Photoshop](https://helpx.adobe.com/photoshop/using/creating-type.html) — point vs
  paragraph, edit mode, commit, what stays editable
- [Edit text in Photoshop](https://helpx.adobe.com/photoshop/using/editing-text.html) — commit and
  cancel paths, `Use Esc key to commit text`, spell check, find and replace, rotation
- [Format characters in Photoshop](https://helpx.adobe.com/photoshop/using/formatting-characters.html)
  — faux styles, caps, super/subscript, underline and strikethrough colour, style hierarchy,
  selection by click count
- [Line and character spacing in Adobe Photoshop](https://helpx.adobe.com/photoshop/using/line-character-spacing.html)
  — leading and auto-leading, kerning modes, the caret-dependent field swap, 1/1000 em units,
  cumulative tracking and manual kerning
- [Format paragraphs in Photoshop](https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html)
  — alignment, all four justification modes, word/letter/glyph scaling ranges, indents, paragraph
  spacing
- [A Comprehensive Introduction to the Type Tool (Tuts+)](https://design.tutsplus.com/tutorials/a-comprehensive-introduction-to-the-type-tool--psd-2905)
  — the five anti-aliasing levels and their intended use, the six hyphenation settings with
  defaults
- [Horizontal and vertical type tool options (Photoshop Help)](http://www.photoshopforphotographers.com/3101-1901/Help_guide/tp/Type_tools.html)
- [AntiAlias — Photoshop Scripting Reference](https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html)
  — the five `AntiAlias` constants
- [When to rasterize your type and shape layers (Adobe Learn)](https://www.adobe.com/learn/photoshop/web/rasterize-type-shape-layer)
  — the rasterize prompt, what is lost, and the duplicate-first guidance
- [Convert text to shapes or work paths in Photoshop](https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/convert-text-to-shapes-or-work-paths.html)
- [Warp and unwarp text in Photoshop](https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html)
  — Bend/Distort, and that warped text stays editable
- [Modify text paths in Photoshop](https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/modify-text-paths.html)
- [Replace missing fonts in Photoshop](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/replace-missing-fonts.html)
  — `Type > Manage Missing Fonts`, the default replacement
- [About fonts (Adobe Help Center)](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/about-fonts.html)
  — font type icons, the faux-style definition
- [Use OpenType variable fonts in Photoshop](https://helpx.adobe.com/photoshop/desktop/text-typography/select-manage-fonts/use-opentype-variable-fonts.html)
- [OpenType font features (Adobe Type)](https://www.adobe.com/products/type/opentype.html)
- [Registered features, OpenType 1.9.1 (Microsoft Learn)](https://learn.microsoft.com/en-us/typography/opentype/spec/featurelist)
- [Text Options for Photoshop CC (dummies)](https://www.dummies.com/article/technology/software/adobe-products/photoshop/text-options-for-photoshop-cc-163691)
  — options-bar contents, hover-to-preview font cycling, selection by click count
- [MDN: `CanvasRenderingContext2D`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)
  — the full text-layout property list
- [MDN: `letterSpacing`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/letterSpacing)
  and [`wordSpacing`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/wordSpacing)
  — Baseline 2025
- [MDN: `textRendering`](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/textRendering)
  — limited availability
- [It's always been you, Canvas2D (Chrome for Developers)](https://developer.chrome.com/blog/canvas2d)
  — the text-modifier set Chrome added
- [Editable Text Layers (psapi)](https://photoshopapi.readthedocs.io/en/stable/concepts/text-layers.html)
  — an independent implementation of the style-run/paragraph-run model, including
  point-vs-box and orientation; the closest available confirmation of the §6 shape
- [Troubleshoot fonts issues in Adobe Photoshop](https://helpx.adobe.com/in/photoshop/kb/troubleshoot-fonts-photoshop.html)
  — lazy text-engine loading, font cache
