# Selection family — research notes

The seven `ToolName`s in this family are the selection tools, and they share a shape that is
worth stating once rather than seven times: in Photoshop every one of them carries the same
four-mode combination control in its options bar, and four of the five that draw a border also
carry the same Feather and Anti-alias pair. The UXP scripting reference makes the reason
explicit — `Selection` is a pixel channel, not a vector, so `selectRectangle`, `selectEllipse`
and `selectPolygon` each take a `feather` (default `0`) and an `antiAlias` (default `true`)
argument, and each takes a `SelectionType` of `REPLACE`, `EXTEND`, `SUBTRACT` or `INTERSECT`
for what to do with an existing selection. The combination modes are therefore per-pixel
boolean operations on a coverage mask, and nothing about them lives on the tool.

## Second-pass audit (line numbers re-derived; three findings no longer true)

This file was written against a tree that commit `7f3b0d19` ("fix(selection): the marquee's
modifiers, the wand's Contiguous, the lasso's Frequency") moved underneath. That commit fixed
three of this file's headline findings, and an earlier version of this record asserted each as a
current defect. Every `file:line` in the data file has also drifted, because that commit and its
neighbours inserted and removed lines in the very files this record cites.

**Three findings are now stale and the data file says so.** The rectangular marquee's
Shift/Alt/Shift+Alt are implemented, not absent; the Magic Wand's `Contiguous` is `present`, not
permanently-on-and-unreachable; the Magnetic Lasso's `Frequency` is `present`, not inverted. Each
correction is in the data file's own `appNotes` with the code that proves it, so a reader who
arrives from the table sees the current state and the reader who remembers the old text sees
exactly why it changed. Nothing was deleted: a finding that silently vanishes is indistinguishable
from one that was never right.

**Two `partial` verdicts were re-derived rather than carried.** The Magnetic Lasso's `Width` was
`present` on the reasoning that the control is a real detection-width slider wired to the edge
detector. It is `partial`, because the app renders a hard 1–64px ceiling
(`FeatherMagneticLasso.tsx:288`-`:289`) and Adobe states the field only as "a pixel value" with
no maximum at all — an app-invented ceiling is a range divergence, exactly what `partial` names.
The Quick Selection's `Size` stays `partial` on a second ground this pass added: the brush slider
runs 1–500px and Photoshop exposes Size together with Hardness in the same control.

**The strongest claim in the previous pass is now the one that most needed checking.** It called
the Quick Selection bar's "Shift and Alt drag on the canvas" hint "the only false claim in the
family a user reads without opening anything". `7f3b0d19` removed the promise rather than
implementing the gesture, and `QuickSelection.tsx:105`-`:105` now carries a comment naming
Photoshop's Alt-drag tip resize and Shift-drag circular constraint as deliberately unimplemented,
over a hint that says only what the gesture does. The finding was accurate when written, it was
the sharpest one in the file, and it is closed. It is kept in the data file's `appNotes` because
a description that says only "this works" is less useful to the next reader than one that says
"this used to lie here".

**Citation discipline.** Every `options[].appRef` and every `implementationRefs` entry was
re-derived by reading the cited line in this worktree, not by trusting the prior pass. That
moved 24 of them. The most consequential single drift: the notes had cited
`src/util/selection.ts:554`-`:581` for `copyPolygonSelectionToCanvas` and its "clips with no
anti-aliasing" property; that line range is now an unrelated error-class constructor, and the
function is at `:554`, with the `ctx.clip()` that carries the claim at `:581`. Every citation in
the data file now resolves to a line that is the wiring, and none points at a blank line or a
neighbouring statement.

Target version: **Photoshop 2025–2026**, with two controls named by their older labels where
Adobe's own documentation is version-split (see the Quick Selection and Magic Wand entries).

Every claim below was re-verified against sources opened during this pass. The research corpus
at `/Users/bkalynovskyi/ph/.kilo/plans/ps-research/` was read first and used as a starting
index, but nothing was transcribed from it: where it disagrees with what a live source said
this pass, the source wins, and the two places it loses are recorded at the end.

## What is true of all seven

- **Combination modes.** `New / Add To / Subtract From / Intersect With` appears on the marquee
  tools, the lasso tools and the Magic Wand. The Quick Selection is the exception, with three —
  New, Add to and Subtract from, and no Intersect. That is a real divergence, confirmed below, and
  the one place in the family where a selection tool's bar has fewer modes than its siblings. One
  Adobe page contradicts it and is disclosed in the Quick Selection section rather than argued
  away.
- **No selection tool reads a combination-mode modifier, and most read no modifier at all.**
  A grep for `shiftKey|altKey|metaKey|ctrlKey` across `src/components/Main/*.tsx` returns
  production hits in `CloneStampToolArea`, `EllipticalSelectionToolArea`,
  `FeatherMagneticLassoToolArea`, `RectangularSelectionToolArea`, `ShapeToolArea` and
  `TextToolArea` only. Of the seven tools here, that leaves exactly three whose `modifiers[]`
  rows describe anything real: the rectangular marquee (Shift → square, Alt → from centre,
  `RectangularSelectionToolArea.tsx:74`-`:75` asking for them and
  `useRect.ts:400`-`:403` sampling them per pointer event), the elliptical marquee
  (`EllipticalSelectionToolArea.tsx:176`-`:177`, as `constrainToCircle` and `fromCentre`), and
  the magnetic lasso's one `Alt` read (`FeatherMagneticLassoToolArea.tsx:458`, the freehand
  segment). The freehand lasso, polygonal lasso, Magic Wand and Quick Selection read no modifier
  key whatsoever, so every combination-mode row on those four — and the Quick Selection's two
  modifier rows — is a Photoshop binding with no implementation. The `options[]` rows already
  said `missing`; the `modifiers[]` rows did not say anything, which read as implemented. They
  are kept, because the file describes Photoshop, and each absence is now stated in `appNotes`
  with the file that proves it.
  **`RectangularSelectionToolArea` is on that list because of the second pass.** The previous
  version of this section put it there and then reported — wrongly — that the marquee's
  Shift/Alt did nothing during a fresh drag, on the strength of reading `useRect`'s single
  `shiftKey` hit as the whole story. It is not: that read is inside `getEdgeAtPoint`, which runs
  on a HANDLE RESIZE, and the fresh-drag path is separate and opt-in. A tool area that asks for
  a modifier is the check that should have been run first.
- **The keyboard.** `src/components/Common/AppKeyboardShortcuts.tsx` is the app's complete
  global table. It binds `Z`/`Y` (undo, redo), `Cmd/Ctrl+C` (copy the selection), `Cmd/Ctrl+V`
  (paste), `Cmd/Ctrl+J` (layer via copy), and the tool letters `V` (reposition), `I`
  (eyedropper), `J`, `C`, `B`, `U`, `T`, `L`, `W`, `G`, `O`, `M`, `P` — of which `B`, `U`, `L`,
  `W`, `G`, `O`, `M` and `P` each have a `Shift+<letter>` twin that cycles its flyout, and the
  rest are singletons — plus the single-tool tiles `E` (eraser) and `S` (clone stamp). It binds
  no `[`, `]`, `,`, `.`, `Caps Lock`, or `Return`.
  The two click-built lassos register four keys of their own on
  their own gesture — `Escape`, `Enter`, `Backspace`, `Delete`
  (`PolygonClickToolArea.tsx:922`-`:958`, `FeatherMagneticLassoToolArea.tsx:543`-`:579`) — and
  that is the whole of the per-tool keyboard. Every Photoshop binding in this family's
  `shortcuts[]` that is not a tool letter is therefore in one of two states: bound as `Enter`
  or `Delete` on those two tools, or unbound everywhere. The unbound ones are kept, as the
  file describes Photoshop, and named as unbound in `appNotes`.
- **The app has no `Select` menu.** There is no `Select All`, `Deselect`, `Inverse`,
  `Color Range`, `Modify > Feather/Expand/Contract/Border/Smooth`, `Grow`, `Similar`,
  `Refine Edge`, `Select and Mask` or `Transform Selection` anywhere in the application. The
  only deselect is the `Clear` button the rectangular, elliptical, freehand, magnetic, wand and
  quick-selection bars render, bound to `clearSelections`. This removes Photoshop's two most
  important follow-ups for the wand and the quick selection outright.
- **`Select and Mask` is on every bar, not just the wand's.** Adobe's 2022 Select-and-Mask tutorial
  puts it this way: "Open the Select and Mask workspace by choosing Select > Select and Mask, or
  by clicking Select and Mask in the Options bar **for any of the selection tools**." Two
  **current desktop pages** also name it on their own tools' bars — the Quick Selection's ("Select
  Select and Mask to refine the selection further") and the Magic Wand's ("Select Select and Mask to
  further refine or preview the selection as a mask"), both 2025-11-04 — and a third, Adobe's own
  feather-edges product page, reaches it from the Quick Selection ("Mask it: Choose Select and Mask
  from the options bar"), with a fourth naming it on a lasso bar
  (`helpx.adobe.com/ph_fil/photoshop/how-to/retouch-remove-background.html`). A fifth, and the
  strongest, is Adobe's **current desktop `refine-and-soften-selection-edges` page**
  (2025-10-27, last updated 2026-02-23), which says flatly that "Selecting Select and Mask from
  the options bar or from Select > Select and Mask gives you access to dedicated tools for refining
  edges" and frames the whole page around it — a page whose subject is the options bar itself.
  It is therefore recorded as a `missing` control on all seven tools rather than on the one whose
  own page happens to name it. The seven-tool generalization no longer rests on the 2022
  sentence alone; see the Quick Selection section. The workspace it opens is documented by Adobe
  (`refine-your-selection-and-mask.html`, last updated February 2026) as carrying a Refine Edge
  Brush for soft edges, a plain Brush for manual work, View Modes of `On Black`, `On White`,
  `Black and White`, `On Layers` and `Show Edge`, and an `Output To` menu that can produce a
  selection, a layer mask, a new layer or a new document.
- **Adobe now enumerates which tools carry `Anti-alias` and which carry `Feather`, and it is not
  the shape this file's tables assume.** The same 2026-02-23 page states: anti-aliasing "can be
  enabled for tools such as the **Lasso, Polygonal Lasso, Magnetic Lasso, Elliptical Marquee, and
  Magic Wand**" — five tools, and **the Rectangular Marquee is not among them** — while
  "Feathering can be applied when using tools like the **Rectangular Marquee, Lasso, Polygonal
  Lasso, or Magnetic Lasso**" — four, and **the Magic Wand is not among them**. Both lists say
  "such as" and "like", so neither is a closed enumeration, but together they are the first
  Adobe desktop statement found of the set membership in either direction, and they are what
  this file's per-tool rows now rest on. It confirms as a byproduct that the marquee family's
  `Anti-alias` row belongs to the **elliptical** tool alone, which the file already said, and it
  is why the Magic Wand's row carries no `Feather` and the rectangular marquee's carries no
  `Anti-alias`.
- **The app has one active selection.** `committedSelectionUpdate` in
  `src/contexts/useSelectionHistory.ts:48`-`:55` deactivates every existing selection on a
  `create` commit, so there is no model in which a second selection can be unioned, subtracted
  from or intersected with the first. Every combination mode in this family is therefore
  `missing` for a structural reason, not an oversight in one bar.
- **The selection is a single point path.** `Selection` in `src/contexts/general-types.ts:61`
  carries a `points` polyline and no mask, and `SelectionSourceTool` at `:17` in the same file
  has no `elliptical-selection` or `quick-selection` member. The elliptical marquee and the
  quick selection both commit under a borrowed `'magic-wand'` identifier so that their outlines
  carry neither draggable anchors nor an anchor hit-test.

## Rectangular Marquee Tool — `rectangular-selection`

Photoshop's bar, left to right: the four combination modes, `Feather`, `Style`, and the
`Width`/`Height` fields that `Fixed Ratio` and `Fixed Size` expose. `Normal` takes its
proportions from the drag and greys the numeric fields out. `Fixed Ratio` is documented as
setting "a height-to-width ratio", entered as two decimal fields — the worked example on the
page is 2 in one and 1 in the other for a box twice as wide as it is high — and `Fixed Size`
"specifies set values for the marquee's height and width" in whole pixels. Both styles accept
document units (`in`, `cm`) as well as `px`.

Modifiers: `Shift` constrains to a square, and the page is explicit that "release the mouse
button before you release Shift to keep the selection shape constrained"; `Alt`/`Option` drags
from the center.

### Options table

| Control                                       | Photoshop                                                                 | App status | App ref |
| --------------------------------------------- | ------------------------------------------------------------------------- | ---------- | ------- |
| New / Add To / Subtract From / Intersect With | four modes, also Shift/Alt/Shift+Alt                                      | `missing`  | —       |
| Feather                                       | pixel radius, default 0, set before the selection                         | `missing`  | —       |
| Style                                         | Normal / Fixed Ratio / Fixed Size                                         | `missing`  | —       |
| Width and Height                              | decimal pair for Fixed Ratio, whole pixels for Fixed Size, units accepted | `missing`  | —       |
| Select and Mask                               | on every selection tool's bar                                             | `missing`  | —       |

**App fidelity: partial.** `RectangularSelectionToolArgs` is `{ rect?, toolName }` and
`defaultSettings['rectangular-selection']` is `{ toolName: 'rectangular-selection' }` — the
tool declares no settings at all, so there is nothing that could be `inert`. Its bar renders a
sentence and three buttons.

**The modifier finding, and its correction.** This section previously read that the marquee's
Shift/Alt were not implemented, on the strength of a whole-file grep for
`event.ctrlKey || event.metaKey || event.shiftKey` in `useRect` returning **one** hit at `:97`,
inside `getEdgeAtPoint` — the HANDLE RESIZE path, where it locks the aspect ratio to the one the
rect already has. The premise was that nothing reads Shift during the initial drag. That is
false, and it was false when written: a grep that finds one hit in a hook shared with crop and
the Move tool is evidence of a narrowed search, not of an absent feature.

There are now three, and the two added by `7f3b0d19` are the fresh-drag ones.
`sampleFreshDragModifiers` (`src/hooks/useRect.ts:400`-`:403`) samples `event.shiftKey` and
`event.altKey` per pointer event into a ref; `adjustFreshPoint` (`:314`-`:329`) applies them;
and `RectangularSelectionToolArea.tsx:74`-`:75` opts in by passing `constrainToSquare: true` and
`fromCentre: true`. All three rows of the data file's `modifiers[]` are real, including
Shift+Alt, which the code gets right in a way worth naming: the square is taken on the **radius
per axis before the drag is mirrored**, so Shift+Alt is a square centred on the press point rather
than one that has drifted off it. Sampling per event rather than at press time means Shift pressed
halfway through a drag takes hold immediately, and `:502` samples once more before the commit so
that a modifier released between the last move and the pointer-up governs the rect actually
committed. The handle RESIZE is deliberately untouched, which is what keeps the resize's
aspect-ratio lock a separate feature from the marquee's Shift.

**The `M` group has two members, not four.** `marqueeGroup` in
`src/components/Common/AppKeyboardShortcuts.tsx:26` is `['rectangular-selection',
'elliptical-selection']` and the same two names are all `toolbar-mapping.ts:145`-`:146` lists
under the marquee tile. Adobe documents four marquee tools — Rectangular, Elliptical, Single Row
and Single Column — so two of Photoshop's four are real tools the app simply does not have, and
an earlier version of the data file described the `M` cycle as running through
"single-row/column variants" that do not exist in the app. Both entries now say the group is the
rectangular and the elliptical marquee, and `appNotes` records that the app has no single-row or
single-column marquee at all. This is a missing capability, **not** a claim that Photoshop lacks
the tool.

## Elliptical Marquee Tool — `elliptical-selection`

Same bar plus `Anti-alias`, and the marquee tools are the only place Adobe offers it: "Turn
anti-aliasing on or off for the Elliptical Marquee tool." Modifiers: `Shift` for a circle,
`Alt`/`Option` from the center.

### Options table

| Control                                       | Photoshop                                          | App status | App ref                       |
| --------------------------------------------- | -------------------------------------------------- | ---------- | ----------------------------- |
| New / Add To / Subtract From / Intersect With | four modes                                         | `missing`  | —                             |
| Feather                                       | pixel radius, default 0                            | `missing`  | —                             |
| Anti-alias                                    | on by default; marquee tools only                  | `missing`  | —                             |
| Style                                         | Normal / Fixed Ratio / Fixed Size                  | `partial`  | `EllipticalSelection.tsx:98`  |
| Width and Height                              | decimal pair (ratio) / whole pixels (size) / units | `partial`  | `EllipticalSelection.tsx:116` |
| Select and Mask                               | on every selection tool's bar                      | `missing`  | —                             |

**App fidelity: `implemented`** — the one verdict in the family that moved this pass, and the one
that now reaches the shipped tooltip, so it is recorded at more length than any other entry here.
It was re-litigated by a second reader who argued for `partial` on the strength of the `partial`
definition rather than the `implemented` one, and that argument is set out below in the form it
was made, because the next reader should have to re-answer it rather than rediscover it.

**The argument for `partial`, as it was put.** `types.ts:89`-`:91` defines `partial` at the tool
level as doing something Photoshop's tool also does but "**not the same something**: a wrong
default, **a wrong algorithm**, a control welded to one of its states, a gesture that does
something else" — and it names the algorithm clause explicitly, which the `implemented` definition
at `types.ts:86`-`:88` does not. The record's own `appNotes` concede the algorithm clause's subject
matter: the committed outline is "a sagitta-bounded inscribed ring rather than a true ellipse". So
the primary gesture — drag corner to corner, get an ellipse — does not produce the thing the primary
gesture produces in Photoshop, which is all `partial` requires. The second reader added a
counterweight: the polygonal lasso is _Photoshop's own tool_, holds a point path for the same
reasons, and is scored `partial` in this same file, so the point-path bound cannot be what earns
this tool its `implemented`.

**Why the verdict stands.** The clause that bites is "a wrong algorithm", and this file already
gives that phrase an operational meaning twice, in its own text. The Quick Selection entry says
"the gap is the algorithm, not the bar" about a region grow that stops at a _colour_ boundary where
Photoshop's stops at an image _edge_ (see the Quick Selection section below); the magnetic lasso's
inverted `Frequency` is the same kind of finding. Both compute a different thing from the one
Photoshop documents, and both are `partial` on that basis. The elliptical marquee does not:
`applyRatio` (`src/tools/ellipticalSelection.ts:121`-`:131`) is the width-to-height ratio Adobe's
own worked example states, `resolveEllipseRect` (`:155`-`:204`) makes `fixed-size` ignore the drag
with the press point supplying only the centre, and `EllipticalSelectionToolArea.tsx:176`-`:177`
passes `event.shiftKey` and `event.altKey` as `constrainToCircle` and `fromCentre`, which are
Photoshop's two modifiers. The tessellation is a bounded _representation_ of the same computation,
not a different computation, and the bound is derived from the radius rather than fixed
(`ellipseVertexCount`, `:217`-`:225`), so the error does not grow with the shape the way a shortcut
would.

**The comparison that decided it.** This tool's own boundary fidelity is dominated by the
`Anti-alias` row this table already scores `missing`. Photoshop's marquee edge is a coverage ramp
about a pixel wide; this app's is a hard step — `copyPolygonSelectionToCanvas`
(`src/util/selection.ts:554`-`:581`) clips the canvas to the polygon with no anti-aliasing. So the
quarter-pixel inward chord bias and the missing anti-aliasing are two errors on the same boundary,
and the second is several times the first. Scoring the polygon as "a wrong algorithm" while scoring
the anti-aliasing as a missing capability would rank a quarter-pixel representation error above a
full-pixel edge difference, which is the ranking no reading of the word "wrong" survives. The
reviewer's own framing — that the committed geometry "is not the ellipse Photoshop commits" — is
true, and it is also true of a hair's breadth of nothing at all; the clause is about which thing
the tool computes, and this tool computes the thing.

**The bound, measured rather than asserted.** `ELLIPSE_MAX_SAGITTA_PX` is `0.25`
(`src/tools/ellipticalSelection.ts:77`). Evaluating `ellipseVertexCount` at r = 1, 5, 10, 13, 50,
100, 500, 1000, 2000, 4000, 10000, 26265, 30000, 60000 and 100000 gives a realised chord sagitta
of 0.019px to 0.250px, inside the 0.25px bound at every radius up to about 26,265px, which is where
the 720-vertex cap (`ELLIPSE_MAX_VERTICES`, `:91`) begins to bind and the error starts growing
linearly instead — 0.29px at r = 30,000, 0.95px at r = 100,000. **The comment at
`src/tools/ellipticalSelection.ts:87` says the cap is reached "at a radius of roughly 5.7k px",
which is wrong by about 4.6x; the real figure is about 26.3k.** It errs in the safe direction, so
the code is better than its own comment claims, and this pass cannot edit that file — recorded here
for whoever owns it. Nothing an editor can open comes near a 52,530px-wide ellipse, so the cap is
not reachable in practice.

**Two premises in the earlier version of this entry that do not survive, both load-bearing.** (1) The
bound is "a quarter-pixel bound imposed by a data model that holds a point path and cannot hold a
curve", and the summary of that was "a data-model limitation of a kind Photoshop shares". Photoshop
shares no such limitation: its marquee commits a coverage mask, not a point path, so the bound is
the app's own choice, sized so that it cannot be seen. The argument cannot stand on a shared
limitation, because there is not one. (2) The bound is "the same class of bound as the polygonal
lasso, which _is_ Photoshop's tool". The polygonal lasso has no bound at all: a polygon of straight
segments between user-placed anchors _is_ what that tool draws, so `Selection.points` is its exact
representation and its geometry diverges from Photoshop's in no respect whatsoever. It is `partial`
for four other reasons — no modifier is read (`PolygonClickToolArea` reads none), no feather exists
on any path, the bar's one control is an app-invented Outline/Fill toggle, and there are no
Copy/Paste/Clear buttons — which is what its own entry says when it calls the tool "the most
_gesturally_ faithful tool in the family" and scores it `partial` anyway. The reviewer leaned on
that same fact and it does not survive either: the one thing that earns the polygonal lasso its
`partial` is a _gesture_ that does something else, a category the elliptical marquee does not have.
Read correctly, that entry is a precedent _for_ this verdict, not against it.

**The cost, stated rather than waved.** At 400% zoom and above on a several-thousand-pixel ellipse,
the chord facets are visible on the ants. A copy of an elliptical selection loses at most the
boundary sliver — for a 1000px-radius circle, under 0.03% of the area, all of it inside a one-pixel
ring — on a tool that draws no anti-aliased edge at all. And four of the six controls in the table
above are `missing`, so `implemented` is a claim about what the tool does to the document, never
about the bar: `types.ts:73`-`:77` says so, and the claim is exactly as wide as that.

**What would flip it.** The verdict rests on the bound being bounded, so the moment the app commits
the ellipse as a coverage mask or an analytic path — or the moment `ellipseVertexCount` stops
being a function of the radius — the argument collapses and the verdict must go to `partial`: it
would then be the same finding as the Quick Selection's, an algorithm that computes a different
thing. The other way to flip it is a rule rather than a fact: a reader who holds that _any_ sub-pixel
representation error is "a wrong algorithm" has made every correctly-implemented tool in this
record `partial`, and should say so plainly, because that is an edit to `types.ts` and not to this
file.

**The two `partial` verdicts are both about the _shape of the fields_**:
Fixed Ratio is a single `Ratio` number (floor `0.05`, ceiling `20`) where Photoshop's is a pair
of decimals, and Fixed Size is a plain pixel `input[type=number]` where Photoshop's accepts
`in` and `cm`. **The ratio itself is not a divergence, and an earlier version of this file said it
was.** It used to claim the app "cannot express a ratio the way Photoshop states one", which is
wrong on Adobe's own wording: Fixed Ratio "Sets a height-to-width ratio. Enter values (decimal
values are valid) for the aspect ratio. For example, to draw a marquee twice as wide as it is
high, enter **2 for the width and 1 for the height**"
(`https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html`) — which is a
width-to-height ratio, which is exactly what `applyRatio` computes
(`src/tools/ellipticalSelection.ts:121`-`:131`) and exactly what the bar's hint tells the user,
`Drag at ${args.fixedRatio}:1` (`EllipticalSelection.tsx:90`). What the app loses is expressiveness
in the field, not fidelity in the geometry: the ratio must be entered as one number with a floor of
0.05, where a Width/Height pair can take any two decimals. `resolveEllipseRect` does implement
`fixed-size` the way Photoshop does —
ignoring the drag, with the press point only supplying the center, so a click is a complete
gesture — and `EllipticalSelectionToolArea` passes `event.shiftKey` as `constrainToCircle` and
`event.altKey` as `fromCentre`, which are exactly Photoshop's two modifiers.

**The tessellation finding.** The committed ellipse is a polygon, not a curve: `ellipseVertexCount`
solves for the vertex count that keeps the chord's sagitta at or under a quarter of a pixel, so
the outline is visually a circle and is not one in the data. Worth stating because a selection
that is a point path cannot be a true curve without this, and because the app's own hit test and
outline renderer agree on the polygon. The bound, its measured reach and the cap that ends it are
in the verdict section above, which is where the decision it drives is argued.

**The shipped value is not this file's value yet.** `tooltips.ts:29` still projects
`implementation: 'partial'` for this tool: that file is generated from all eight families and is
regenerated once, after every family lands (the message of `5909f5f` says so explicitly), and this
pass may not run `npm run docs:tools`. So the browser currently shows `partial` for a record that
says `implemented`, and `scripts/__tests__/tool-descriptions.test.mjs:125` fails on the projection
until that regeneration runs. Anyone landing this family must run it, or the flip will look
unlanded.

## Lasso Tool — `freehand-lasso`

Photoshop's bar is the three controls: the four combination modes, `Feather`, and `Anti-alias`
— and Adobe is explicit that the Anti-alias box is "selected by default" for this tool. Drag
draws the border, release closes it, and Photoshop "will help complete your shape by connecting
small gaps between your end point and starting point".

### Options table

| Control                                       | Photoshop                     | App status | App ref |
| --------------------------------------------- | ----------------------------- | ---------- | ------- |
| New / Add To / Subtract From / Intersect With | four modes                    | `missing`  | —       |
| Feather                                       | pixel radius, default 0       | `missing`  | —       |
| Anti-alias                                    | on by default                 | `missing`  | —       |
| Select and Mask                               | on every selection tool's bar | `missing`  | —       |

**App fidelity: partial.** No Photoshop control is on this bar. The one control it does render
is labelled `Mode` and toggles between `Outline` and `Fill`; that is the app's own invention
and it changes how the committed border is painted, not how a gesture combines with an existing
selection — so it shares a name with the thing it is not. `LassoToolArgs` carries `alpha`,
`lineWidth`, `color` and `fill`, none of which Photoshop puts on this bar.

**Shortcut gap.** Photoshop binds `Return`/`Enter` to select the tool and focus the `Feather`
field, so a feather can be typed before the next trace. Nothing in the app binds it.

**Modifier gap.** None of this tool's Photoshop modifiers is implemented, and neither is the
`Space`-to-Hand mid-trace binding. The freehand lasso is drawn by `PolygonClickToolArea` — the
same component as the polygonal lasso, reached through the shared `interactionMode === 'lasso'`
branch at `src/components/Main/Main.tsx:85`/`:210` — and that file reads no modifier key at all.
The `modifiers[]` rows are kept because the file describes Photoshop; the absence is stated in
`appNotes` rather than by deleting the rows.

## Polygonal Lasso Tool — `polygonal-lasso`

Identical three-control bar. The gesture is where this tool lives, and Adobe's page is
complete about it: click to set the starting point; `Alt`/`Option`-drag to draw a freehand
segment; `Delete` to erase recently drawn straight segments; and **four** documented ways to
close — click the starting point (a closed circle appears next to the pointer),
`Ctrl`-click or `Cmd`-click, double-click / `Enter` / `Return` for a magnetic segment, with
`Alt`-double-click closing on a straight one.

**Two gestures the data file was missing, both Adobe's, both now added.** (a) The 45° constraint:
"To draw a straight line at a multiple of 45°, hold down Shift as you move to select the next
segment." The data file's `modifiers` listed only "Shift — Sets the gesture to Add to Selection",
which is also true and also documented, so Shift now carries **two** entries rather than one. (b)
The fourth close gesture: "If the pointer is not over the starting point, double-click… or
**Ctrl-click (Windows) or Command-click (Mac OS)**." The data file's `purpose` said the border "has
three ways in" and enumerated three; it now says four and carries the modifier-click.

### Options table

| Control                                       | Photoshop                                                         | App status | App ref |
| --------------------------------------------- | ----------------------------------------------------------------- | ---------- | ------- |
| New / Add To / Subtract From / Intersect With | four modes                                                        | `missing`  | —       |
| Feather                                       | pixel radius, default 0                                           | `missing`  | —       |
| Anti-alias                                    | on by default; visible effect only on Alt-drawn freehand segments | `missing`  | —       |
| Select and Mask                               | on every selection tool's bar                                     | `missing`  | —       |

**App fidelity: partial**, and this is the most _gesturally_ faithful tool in the family — the
click-to-add-anchor, double-click close, right-click close, `Enter` close, `Delete` anchor
removal and `Escape` abort are all registered in `PolygonClickToolArea` — against the
least complete bar. The bar is forty lines: one Outline/Fill toggle and a hint. It is also the
only bar in the family with no Copy, Paste or Clear buttons, which the freehand and magnetic
lasso bars beside it both render.

**Modifier gap, and it is larger than the combination modes.** `PolygonClickToolArea` reads no
modifier key, so _none_ of this tool's `modifiers[]` rows is implemented: not the 45° constraint
added in an earlier pass, not the `Alt`-drag freehand segment, not the `Alt`-double-click straight
close, and not the three combination modes. The `Enter` and `Delete` `shortcuts[]` rows **are**
bound (`:922` and `:944`); the `Return` row's Feather-focus half is not, because the bar has no
Feather field to focus. The rows stay and the absence is stated in `appNotes`.

**The feather claim that was wrong.** The data file used to say a feather set on any selection
tool "is only reachable by re-making the selection with the tool". Neither half of that is true.
Re-making a selection applies no feather at all — `featherRadius` is a field of
`FeatherMagneticLassoToolArgs` alone (`src/tools/featherMagneticLasso.ts:6`), and it is the only
tool area that writes it into the selection's metadata (`src/components/Main/FeatherMagneticLassoToolArea.tsx:394`).
And the magnetic lasso's feather is not a selection feather: `copySelectionToCanvas` routes
**only** the magnetic lasso through `copyFeatheredPolygonSelectionToCanvas`
(`src/util/selection.ts:834`-`:840`), so the radius softens the copied alpha mask and leaves the
selection the marching ants are drawn from unchanged. The corrected sentence is in `appNotes` and
is deliberately narrower than the one it replaces.

**Correction to the research corpus.** `01-photoshop-reference.md` §1.5 attributes to this tool
a click-and-drag that produces a _smooth anchor with drag-set tangent handles_, cited to [8][9].
The current Adobe page does not say that: it says to hold `Alt`/`Option` **and drag** to draw a
freehand **segment**, and to hold `Alt`/`Option` and double-click to close with a **straight
segment**. The drag-handle claim was not re-established from a live source and has been left
out of the data file. The corpus's own `Alt` + drag freehand-segment claim and its closing
gestures survived re-verification; its `Backspace` wording did **not** — Adobe says "To erase
recently drawn straight segments, press the **Delete** key", and `Backspace` is the Mac keyboard's
name for that key rather than Adobe's word. The data file's `appNotes` and this section both
said "Backspace and Delete"; both now say `Delete`.

## Magnetic Lasso Tool — `feather-magnetic-lasso`

The most densely specified bar in the family. Adobe's page gives `Width` as a pixel value
("The Magnetic Lasso tool detects edges only within the specified distance from the pointer"),
`Contrast` as a percentage, and `Frequency` as a rate:

> To specify the rate at which the lasso sets fastening points, enter a value between 0 and 100
> for Frequency. **A higher value anchors the selection border in place more quickly.**

Two third-party sources agree on the direction and add the defaults: `photoshopessentials.com`
gives a default Frequency of 57 and states "The higher the value, the more anchor points will be
added"; `lifewire.com` documents the same `Feather / Width / Contrast / Frequency` set and the
`[`/`]` width keys. `Stylus Pressure` is documented on Adobe's page as a fourth edge-detection
option. The tool is "not available for 32-bits-per-channel images".

### Options table

| Control                                       | Photoshop                                                                | App status | App ref                        |
| --------------------------------------------- | ------------------------------------------------------------------------ | ---------- | ------------------------------ |
| New / Add To / Subtract From / Intersect With | four modes                                                               | `missing`  | —                              |
| Feather                                       | pixel radius, default 0                                                  | `partial`  | `FeatherMagneticLasso.tsx:272` |
| Anti-alias                                    | on by default                                                            | `partial`  | `FeatherMagneticLasso.tsx:351` |
| Width                                         | pixel detection radius; `[`/`]` adjust; `Caps Lock` shows it as a circle | `partial`  | `FeatherMagneticLasso.tsx:285` |
| Contrast                                      | 1%–100%                                                                  | `partial`  | `FeatherMagneticLasso.tsx:298` |
| Frequency                                     | 0–100 rate; **higher anchors the border sooner**                         | `present`  | `FeatherMagneticLasso.tsx:311` |
| Stylus Pressure                               | checkbox; narrows Width under stylus pressure                            | `missing`  | —                              |
| Select and Mask                               | on every selection tool's bar                                            | `missing`  | —                              |

**App fidelity: partial.**

**The Frequency inversion — found, argued, and then FIXED.** The previous version of this section
reported that the app stored `frequency` as a maximum path length in pixels and gated on
`if (pathLength(segment.path) < args.frequency) return false;`, so that longer spacing meant
_fewer_ anchors: the exact opposite of Adobe's **"A higher value anchors the selection border in
place more quickly."** That finding was correct, and it was the most carefully hedged in the
file — Adobe's sentence is narrower than the finding, and the step from "anchors sooner" to
"lays fastening points down more densely" is a third-party reading, not Adobe's.

`7f3b0d19` fixed it, and this record was not updated. It is now Adobe's own range and direction:
`MAGNETIC_LASSO_FREQUENCY_MIN`/`_MAX` are `0`/`100` (`src/tools/featherMagneticLasso.ts:20`-`:21`,
under the comment `Adobe's Frequency range: "between 0 and 100"`), the bar's readout is a plain
number with no `px` suffix (`FeatherMagneticLasso.tsx:311`), and the direction is decided in
exactly one function — `magneticLassoAnchorSpan` (`:43`-`:54`) — which maps Frequency 0 to the
longest 120px anchor span and Frequency 100 to the shortest 8px one. The gate is now
`pathLength(segment.path) < magneticLassoAnchorSpan(args.frequency)`
(`FeatherMagneticLassoToolArea.tsx:476`). The bar's own help text was rewritten to Adobe's
wording rather than the app's. The row is `present`.

**The lesson worth carrying: a `partial` finding is a snapshot, not a verdict.** This file spent
three findings on defects that were fixed between the pass that found them and the pass that
re-read them, and the band of this file's claims about the Magnetic Lasso's `Frequency`, the
Wand's `Contiguous` and the marquee's modifiers all had to be walked back. The failure was not
the finding — it was treating a `file:line` reading as durable.

**`Width` is now `partial`, and it is the one verdict this pass moved in the other direction.** It
was `present` on the reasoning that the control is a real detection-width slider wired to the
edge detector, which is true. It is `partial` because the app renders a hard 1–64px ceiling
(`FeatherMagneticLasso.tsx:288`-`:289`) and Adobe states the field only as "a pixel value" with no
maximum — so the ceiling is the app's own, and an app-invented bound is a range divergence, which
is precisely what `types.ts:19`-`:20` names. Contrast has the same shape of defect for a smaller
reason: it allows 0% where Adobe's documented range starts at 1%.

**`Feather` and `Anti-alias` are the same divergence, and are both `partial` for it.**
`args.featherRadius` and `args.antiAlias` are both written into the selection's metadata at commit
(`src/components/Main/FeatherMagneticLassoToolArea.tsx:394`-`:396`) and both are read back in
exactly **one** place, `copySelectionToCanvas` → `copyFeatheredPolygonSelectionToCanvas`
(`src/util/selection.ts:836`-`:837`). So both reach the **copied alpha mask** and nothing else:
un-ticking Anti-alias changes the copy and leaves the selection the marching ants are drawn from
untouched, which is exactly what `Feather` already said.

**The 100-pixel cap was never a divergence.** It was carried as one because the app's slider stops
at 100 (`FeatherMagneticLasso.tsx:275`) and because "Adobe never states the field's bound" was
recorded in `## Unverified`. Adobe does state it, and states the same number: "In the text box,
enter a value of between 0 and 100 pixels" (`https://www.adobe.com/products/photoshop/feather-edges.html`).
The `0.1–1000` figure that made the two look different is the UXP range for the
`Select > Modify > Feather` **command**, a different control applied to an existing selection. What
is genuinely missing behind both sliders is that command, and both sliders' real divergence is the
scope — copied mask, not selection. Because `copySelectionToCanvas` routes only this tool through
the feathered path, it is the only tool in the family where a feather control does anything at all.

**Three app-only controls.** `Snap` (0–1, described by the bar's own help text as "how
strongly the cursor is pulled toward detected edges"), `Smooth` (0–10 px path simplification),
and the `Preview feather` outline. None has a Photoshop counterpart, so none appears in the
`options` array; they are recorded here and in `appNotes`.

**Shortcut gap.** `[`/`]`, `,`/`.`, `Caps Lock` and `Return` are documented by Adobe or by two
independent third parties; none of them is bound in the app, whose complete global table is
`src/components/Common/AppKeyboardShortcuts.tsx`. `Delete` **is** bound, on this tool's own
gesture (`src/components/Main/FeatherMagneticLassoToolArea.tsx:573`), and so is `Enter`
(`:551`) — an earlier version of this file grouped `Delete` with the unbound keys and was wrong.

**Modifier gap — the one real modifier in the family.** This tool reads `Alt`, and only as
`magneticEnabled: !event.altKey` at `src/components/Main/FeatherMagneticLassoToolArea.tsx:458`.
That single read is what makes the freehand-segment row true. Everything else is absent: `Shift`,
`Alt`-as-a-combination-mode, `Shift+Alt`, and the `Alt`-double-click straight close — the
double-click detector calls `finishSelection` without consulting a modifier. So the `modifiers[]`
list is a Photoshop description annotated, not an app capability list, and the annotation is in
`appNotes`.

## Magic Wand Tool — `magic-wand`

This is the tool whose bar changed most in the corpus's window and where the current Adobe page
is the better source. The 2025-11-04 page lists the bar in full — `Sample Size`, `Tolerance`
("from 0 (narrow) to 255 (broad)"), `Anti-alias`, `Contiguous`, `Sample All Layers` — while the
2023 how-to page lists only `Tolerance`, `Anti-aliased`, `Sample All Layers` and `Contiguous`
alongside the four combination modes.

**Every default on this bar is the weak half of the entry, and the data file now says so.**
`photoshopessentials.com` and Adobe's **Photoshop Elements** page agree that `Tolerance` runs 0–255
defaulting to 32, `Contiguous` on, `Anti-alias` on and `Sample All Layers` off — but neither is a
desktop Photoshop page, and Adobe's current 2025-11-04 desktop page gives the Tolerance **range and
no default at all**. The `Tolerance` row, the `Sample All Layers` row and — for consistency,
since the identical evidence gap applies — the `Contiguous` and `Anti-alias` rows each now name
their own provenance inline instead of asserting a default flatly. The four _ranges_ and
_effects_ are Adobe's and are stated without qualification.

The `32` also sits in a source list that is otherwise Adobe-first, which is what made it read as
sourced. The closest Adobe-desktop statement of any of these four defaults was not found; the
Elements page is `https://helpx.adobe.com/ca/photoshop-elements/using/making-selections.html`, and
it is a different product. See `## Unverified`.

### Options table

| Control                                       | Photoshop                                                                     | App status | App ref            |
| --------------------------------------------- | ----------------------------------------------------------------------------- | ---------- | ------------------ |
| New / Add To / Subtract From / Intersect With | four modes; `Shift`-click adds, `Alt`-click subtracts                         | `missing`  | —                  |
| Sample Size                                   | how much image is sampled for sensitivity                                     | `missing`  | —                  |
| Tolerance                                     | 0–255 (Adobe); the 32 default is third-party                                  | `partial`  | `MagicWand.tsx:63` |
| Anti-alias                                    | on by default, third-party / Elements                                         | `missing`  | —                  |
| Contiguous                                    | on by default, third-party / Elements; off = same colors throughout the image | `present`  | `MagicWand.tsx:77` |
| Sample All Layers                             | reported off by default, CS5-era third-party                                  | `missing`  | —                  |
| Select and Mask                               | on every selection tool's bar                                                 | `missing`  | —                  |

**App fidelity: partial.**

**Modifier gap.** `MagicWandToolArea` reads no modifier key — a grep for
`shiftKey|altKey|metaKey|ctrlKey` in that file returns nothing. The wand's
`modifiers[]` rows (Shift-adds, `Alt`-subtracts, `Shift+Alt`-intersects) are therefore
Photoshop's bindings with no implementation here, and they were unannotated until this pass. The
rows are kept, because the file's job is to describe Photoshop's tool, and the absence now
appears in `appNotes`.

**`Contiguous` was the finding here, and it is now `present`.** The previous version of this
section reported it `missing` on a careful reading: absent from `MagicWandToolArgs`, so neither
declared nor rendered, with the behaviour nonetheless latent — `MagicWandSelectionOptions` carried
a `contiguous?: boolean` and the util took the contiguous branch unless the value was
_explicitly_ `false`, while the tool area built its options from `tolerance` and `smoothing`
alone, leaving the non-contiguous branch unreachable from the toolbar. That was true, and it was
the exact definition of a defect a documentation pass should not call `present`.

`7f3b0d19` made the latent branch reachable, and this record was not updated. `contiguous` is now
a declared field of `MagicWandToolArgs` carrying Adobe's own sentence as its doc comment
(`src/tools/magicWand.ts:7`-`:12`), seeded `true` in `settings.ts:127` so that no default click
changes what is selected, and rendered as a checkbox wired to `patchToolArgs`
(`MagicWand.tsx:76`-`:79`), sitting where Adobe puts it — straight after `Tolerance`. The commit
notes the placement decision, and the status is `present`: the control is rendered, it is wired,
and unticking it now takes the non-contiguous path, which is the selection that makes the wand
useful on a repeated sky or a duplicated product shot.

The `inert` question this section raised is now a useful contrast rather than a live finding.
`Contiguous` was the case that a boolean flag exists in a util and a branch nobody can reach —
`inert` in everything but name, and the one that would have justified a fifth status if the bar
had rendered it. It was correctly filed `missing` rather than `inert`, because nothing was on
screen. Had a chip been drawn for it, `inert` would have been the right value and the screenshot
would have been the tell.

**`Sample All Layers` is missing in the worst way: it is permanently on.** The tool area passes
`canvasRef.current` to `createMagicWandSelectionFromCanvas`, i.e. the merged document canvas, so
the app behaves as though the box were always ticked while the bar shows no box.

**`Smooth` is not `Anti-alias`.** The bar's second slider has no Photoshop counterpart: it is
passed through as `smoothing` and consumed by `simplifyClosedPath`, which removes boundary
vertices. Anti-aliasing blends coverage at the staircase; simplification deletes the staircase.
The tool also reports a live selected-pixel count in its hint box, which Photoshop's bar does
not, and which is worth knowing is the mask's count rather than the committed polygon's — the
commit refuses a region with an enclosed hole, so the two can disagree.

**`Refine Edge`.** Documented on Adobe's own product page, reached from the options bar's
`Select and Mask` and carrying `Radius`, `Smart Radius`, `Smooth`, `Feather`, `Contrast`,
`Shift Edge`, `Decontaminate Colors` and `Output To`. None of it exists in the app, and neither
does the `Select and Mask` workspace it opens.

## Quick Selection Tool — `quick-selection`

The thinnest-covered tool in the corpus, researched from scratch, then researched again after the
mined corpus row for it was recovered. That row is confirmed on both of its load-bearing points
and is contradicted on nothing.

### Three modes, not four

This is real, and it is the one place in the family where a selection tool's bar has **fewer**
combination modes than its siblings. Adobe's 2025-11-04 desktop page lists the control as "New
selection, Add to selection, or Subtract from selection" — three, with no fourth item anywhere in
the list. The second source agrees and is explicit about the count: `photoshopessentials.com`
describes "a series of three icons which let us switch between the tool's three selection modes
(from left to right - New selection, Add to selection and Subtract from selection)". Every other
tool in this family is documented by Adobe with four: "New Selection, Add to Selection, Subtract
from Selection, or Intersect with Selection" appears verbatim on the marquee, lasso, magnetic
lasso and polygonal lasso pages and on the wand's.

**Counter-evidence, disclosed rather than argued away.** Two things pull the other way, and the
previous version of this file handled both badly.

1. **A claim of confirmation that the page does not carry.** That version said the four-mode list
   "appears verbatim on the marquee, lasso, magnetic lasso, polygonal lasso, wand and
   quick-selection how-to pages — **the quick-selection page included**, which is why the
   divergence is worth stating rather than inferring." A later read of
   `https://helpx.adobe.com/photoshop/using/tool-techniques/quick-selection-tool.html` in full
   found **no four-mode list on it**. The sentence is withdrawn. It is worth stating plainly that
   this was a confirmation claimed and not found, which is the failure mode the `## Unverified`
   list exists to prevent.
2. **An Adobe page that says the opposite.** `https://helpx.adobe.com/ph_fil/photoshop/how-to/add-to-subtract-from-selections.html`
   names the Quick Selection in the set of tools that can be combined and then instructs the
   reader to use **Intersect with selection** on it.

Neither was retracted by Adobe, and neither is enough to overturn the 2025-11-04 desktop page that
enumerates the three. The finding is therefore stated as what it is: **a documented divergence, not
an inference from a bar nobody enumerated** — the Quick Selection's own bar _is_ enumerated, and it
has three. The data file's three-mode claim is unchanged; what changed is the argument under it.
The `ph_fil` add-to-subtract page is also older and in a different locale line than the 2025 page.

The likely source of the "four modes" misconception is a general options-bar diagram in a
textbook that lists `New/Add/Subtract/Intersect` for selection tools collectively, immediately
before a separate section headed "The Quick Selection Tool Options" that lists only brush options
and `Enhance Edge` (`cod.pressbooks.pub/photoshopmastery1250`). The four-mode list is not
attributed to this tool on that page.

### `W`, and the `Shift+L` badge

**The bare letter re-selects; `Shift+letter` is the cycling key.** Every one of the three groups
in this family shares its letter, and an earlier version of the data file said the opposite —
that "repeated presses cycle between" the group's tools. Adobe's own keyboard-shortcut table
carries the cycling as a separate row, and the bare letter as the select:

> Lasso tool | L | L … Quick selection tool | W | W … Rectangular marquee tool | M | M …
> Elliptical marquee tool | M | M … **Switch between marquee tools | SHIFT+M | SHIFT+M**

(`helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html`, Adobe).
The general rule is stated in words by an Adobe presenter: "Photoshop assigns the same shortcut
to multiple, similar, tools. For example, all three Lasso tools have the shortcut 'L' assigned to
them. To cycle through tools that use the same keyboard shortcut, add the Shift key (for example
Shift + L will cycle through the Lasso, Polygonal, and Magnetic Lasso Tools)"
(`jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html`). All
seven `shortcuts[]` arrays are rewritten on that basis, each keeping its bare letter and gaining
the `Shift+<letter>` row for its group.

The app happens to agree with the corrected reading rather than the old one: `M`, `L` and `W` are
each bound twice in `AppKeyboardShortcuts.tsx`, once plain and once shifted, and the shifted
handler is the one that calls `cycleToolGroup`. So the `appNotes` sentences about cycling are
unchanged and the bare-letter rows are the ones that were wrong.

`W` is correct for the Quick Selection — Adobe's own how-to page opens with "Select the Quick
Selection tool (W)" — and it is the same key as the Magic Wand because the two share one Tools-panel
flyout; Adobe's wand page likewise opens "Select the Magic Wand
tool (W)". The app binds `W` to the Magic Wand tile (`toolbar-mapping.ts:52`) and gives the Quick
Selection tile no badge of its own (`:53`), which puts the badge on the flyout's primary rather
than on the second item. That is a presentation difference, not a wrong key.

The app's `Shift+L` badge on the Magnetic Lasso is a different matter and is **not** carried over
as a Photoshop fact. `Shift+L` now appears in the data file as the **Photoshop** lasso cycling key,
which is where it belongs, and the magnetic lasso's `appNotes` says explicitly that the app's badge
is its own binding for one item in a flyout and coincidentally reads the same as Photoshop's
cycling shortcut. In Photoshop all three lasso tools share `L`; `Shift+L` cycles them.

### Edge detection, and why a small brush

The mechanism, in Adobe's words:

- "Click and drag the brush across the area you want to select. **As you drag, the tool
  automatically detects image edges to create a selection for you.**" —
  `tool-techniques/quick-selection-tool.html` (Adobe, 2023-05-24)
- "This tool tries to find image edges and **automatically stops the selection there.**" —
  Adobe Learn, _Make selections_
- "The Quick selection tool will automatically detect the image edges as you drag, to create a
  selection." — `automate-selections-with-quick-selection-tool.html` (Adobe, 2025-10-29; this one
  is Photoshop _on the web_)
- "**Use the Quick Selection tool to select automatically based on similar tones and image
  edges.**" — `make-precise-selections-in-select-mask.html` (Adobe, 2022-12-28)

That last sentence is the reason the data file's `purpose` does not describe the tool as a pure
boundary tracer. Adobe's dominant framing is edge following, but Adobe also states a color prior
alongside it, so "edge following with a color prior" is the accurate description and "purely
edge following" would overstate it.

**Why a small brush at a soft edge** is the second-order fact, and it follows from the first: the
selection grows outward from under the cursor, so the brush diameter is how much of the image the
tool is allowed to reason about at any one moment. `photoshopessentials.com` states the
consequence directly — "Typically, a smaller cursor will give you more accurate results" — and
`businessinsider.com` gives the operational form of it: "You want to make the brush smaller than
the region or object you're trying to select, because if it's too large, it'll select parts you
don't want too." Adobe's own `Size` description ("Make the brush sensitive to pen pressure or
stylus wheel") and its Learn tutorial's "Experiment with adjusting the size and hardness of the
Quick Selection tool in the options bar" complete the chain. The cursor is resized with `[` and
`]`, "the same way we'd resize a brush" (`photoshopessentials.com`) — a second, independent
confirmation that the brush model is real rather than nominal.

### The sentence that distinguishes it from the Magic Wand

`photoshopessentials.com` puts it more plainly than Adobe does:

> the Quick Selection Tool is somewhat similar to the Magic Wand in that it also selects pixels
> based on tone and color. But the Quick Selection Tool goes far beyond the Magic Wand's limited
> abilities by also looking for similar textures in the image, which makes it great at detecting
> the edges of objects. And unlike the Magic Wand where we click on an area and hope for the
> best, the Quick Selection Tool works more like a brush, allowing us to select areas simply by
> "painting" over them!

Compressed: both take a contiguous region; the Wand takes it by **colour similarity from a
single click**, the Quick Selection by **following an image edge with a brush**. That sentence is
now in the Quick Selection's `purpose` and reciprocally in the Magic Wand's.

Worth noting against it: Adobe's own selection-tools overview page describes both tools
identically — "Quick Selection tool | Select specific areas of an image" and "Magic Wand tool |
Select specific areas of an image" (`selection-tools-overview.html`, 2025-11-04) — so the
distinction lives in the how-to pages, not the overview.

### `Sample All Layers`

"**Sample All Layers: Create a selection based on all the layers instead of just the currently
selected layer.**" — Adobe, 2025-11-04. The second source is `photoshopessentials.com`: "If your
document contains multiple layers and you want Photoshop to analyze all the layers when making
the selection, check the Sample All Layers option. Leaving it unchecked tells Photoshop to include
only the layer that's currently active." Its default is still not stated by either — see
`## Unverified` item 7.

### `Enhance Edge` / `Auto-Enhance`, and where the older label appears

Two names for one checkbox, and this is the one place where the addendum's framing needed
correcting rather than confirming.

- **2025, `Enhance Edge`:** "Automatically improve the edges by making them smoother and more
  refined." — Adobe, 2025-11-04.
- **2022, `Auto-Enhance`:** "**Add a checkmark to the Auto-Enhance option in the Options bar.**" —
  `use-quick-selection-tool.html` (Adobe, 2022-12-28). **This is where the `Auto Enhance` label
  appears**: an Adobe user-guide page, a beginner tutorial, and the only Adobe page found that
  uses the older name.
- **What it does**, from the one source detailed enough to say: "Checking this option will reduce
  roughness and blockiness in the selection area. **Enhance Edge automatically flows the
  selection further toward image edges and applies some of the edge refinement you can apply
  manually in the Select and Mask workspace.**" — `cod.pressbooks.pub/photoshopmastery1250`. This
  is a third-party textbook, and it is the load-bearing source for the mechanism.
- **The cost**, from two independent third parties: "selecting the Auto-Enhance option can
  produce smoother, higher quality selection edges (they tend to look a bit blocky on their own),
  but you may find the Quick Selection Tool takes slightly longer to do its thing with
  Auto-Enhance enabled" — `photoshopessentials.com`; `photoshopbuzz.com` says the same.

**A correction to my own earlier pass.** The first version of this file stated that `Auto-Enhance`
is "off by default". That was an inference from a checkbox being drawn unticked, not a sourced
default, and it is now removed from the data file. What the sources support is narrower and is what
the data file says: Adobe's 2022 tutorial instructs the user to _add_ a checkmark to it, which is
evidence it does not start enabled. The default state itself is in `## Unverified` item 7, and
**no source found in this pass — Adobe or otherwise — says `Auto-Enhance` is on by default.**

### `Select and Mask` and `Mask`

**`Select and Mask`** is sourced by Adobe six times and is on every selection tool's bar, so it is
recorded on all seven:

- "Open the Select and Mask workspace by choosing Select > Select and Mask, or by clicking
  Select and Mask in the Options bar **for any of the selection tools**." — Adobe, 2022-12-28. This
  is the sentence that generalises it to all seven, and it remains the weakest of the six because
  it is a **2022 `ph_fil` tutorial**: a beginner how-to, not a current desktop reference page, and
  on a different locale line from the 2025 documentation this entry otherwise rests on.
- "In the options bar, click Select and Mask to open the Select and Mask workspace." — Adobe
  Learn, _Make selections_.
- **Current desktop pages, which is what this claim should have leaned on.** The Quick Selection
  page ends "Select **Select and Mask** to refine the selection further"
  (`paint-a-selection-with-quick-selection-tool.html`, 2025-11-04), and the Magic Wand page ends
  "Select **Select and Mask** to further refine or preview the selection as a mask"
  (`select-areas-by-color-with-the-magic-wand-tool.html`, 2025-11-04). Both tools' own current
  desktop pages therefore name the control on their own bars, and both quotes are in the data
  file's two `Select and Mask` rows.
- **Two more, neither of which is this tool's own page, which is what makes them worth having.**
  Adobe's feather-edges product page numbers three ways to feather a selection, and the second is
  "Mask it: Choose **Select and Mask** from the options bar" — the control, on the options bar,
  reached from the Quick Selection
  (`https://www.adobe.com/products/photoshop/feather-edges.html`). And the `ph_fil` background
  removal how-to names it on a **lasso** bar
  (`https://helpx.adobe.com/ph_fil/photoshop/how-to/retouch-remove-background.html`), which is the
  group the 2022 sentence was actually doing the work for. Neither page says "for any of the
  selection tools", so the seven-tool generalization still rests on the 2022 sentence; what changed
  is that it is no longer the only thing carrying it, and that the two tools whose rows a reader is
  most likely to check do not rest on it at all.

**And the eight controls are now named identically in all seven rows.** Five of the seven copies
listed only "Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors", omitting `Smart
Radius` and `Feather`, while the Quick Selection's copy beside them listed all eight. That is a
file that described the same panel two ways, and it is resolved: every row now carries the same
sentence, and the two tools whose own pages quote the control keep that quote as a trailing
clause.

The workspace it opens is the refinement surface the quick selection feeds: "Use the Quick
Selection tool to select automatically based on similar tones and image edges. Use the **Refine
Edge Brush** tool for more precise selection of soft edges, like hair or fur. Use the **Brush**
tool to paint selections where you want them." Same page, for the Properties panel: `Smooth` for
smoother edges, `Contrast` for crisper ones, `Decontaminate Colors` plus `Amount` for a fringe of
unwanted color at a soft edge, and an `Output To` menu. Adobe's current page for the workspace
(`refine-your-selection-and-mask.html`, last updated February 2026) supplies the View Modes —
`On Black`, `On White`, `Black and White`, `On Layers`, `Show Edge` — which is the current
replacement for the old Refine Edge dialog.

**`Mask`** — the button that converts the selection to a layer mask — was the weakest claim in
this addendum, and the data file has now dropped it. It is in the mined bar row, and a layer mask
is certainly an output of this workflow (Adobe documents `Output To > Layer Mask`, and the
Layers-panel `Add layer mask` button in `fine-tune-layer-masks.html`: "The resulting layer mask is
black where there was no selection, hiding the background around the subject"). But **no Adobe page
opened in this pass documents a `Mask` button on a selection tool's options bar**, and what Adobe
documents is the **Layers panel's** button. The row also asserted a **position** — "Sits
immediately after Select and Mask and before the two checkboxes" — which no source of any kind
supports and which is the part most likely to be a reconstruction of a bar someone had in front of
them. Rather than keep a half-sourced control, the `Mask` row is removed from the data file, the
positional clause goes with it, and the surviving fact is now a sentence in the Quick Selection's
`appNotes`: there is no route from a selection to a layer mask, and the only mask the app can
produce is the bitmap its Copy button renders. The claim itself stays in `## Unverified` item 10,
which is where an unsourced claim belongs.

### Quick Mask

Quick Mask is a mode rather than a control, so it is not an `options` row. Adobe documents it as
the other way to turn a selection into something you can edit, and it is the one route from a
selection to a mask that does not go through Select and Mask:

- "Use Quick Mask mode to convert a selection to a temporary mask for easier editing. The Quick
  Mask appears as a colored overlay with adjustable opacity. You can edit the Quick Mask using any
  painting tool or modify it with a filter. Once you exit Quick Mask mode, the mask is converted
  back to a selection on the image." — `saving-selections-alpha-channel-masks.html` (Adobe)
- "By default, Quick Mask mode colors the protected area using a red, 50% opaque overlay"; "Paint
  with white to select more of an image"; "To deselect areas, paint over them with black"; "**If a
  feathered mask is converted to a selection, the boundary line runs halfway between the black
  pixels and the white pixels of the mask gradient.**" — `create-temporary-quick-mask.html`
  (Adobe, 2023-05-24)

Two consequences for this app are recorded in the Quick Selection's `appNotes`: a feathered
selection's visible border is a 50% threshold, so a user comparing the app's ants against
Photoshop's is comparing two different things, and the app has no Quick Mask mode at all, so its
only mask is the bitmap the `Copy` button renders. Adobe's own alpha-channel page makes the
durable counterpart explicit — a mask saved as an alpha channel is the persistent form, and it is
editable grayscale in the Channels panel — which the app also does not have.

The `Q` key for Quick Mask is third-party only (`photoshoptrainingchannel.com`,
`akvis.com`) and is not in the data file, whose `shortcuts` field records app bindings and where
the app binds nothing.

### Options table

| Control                      | Photoshop                                                                           | App status | App ref                  |
| ---------------------------- | ----------------------------------------------------------------------------------- | ---------- | ------------------------ |
| Tool presets                 | leftmost item; saves and recalls the tool's whole bar state                         | `missing`  | —                        |
| New / Add to / Subtract from | **three** modes, no Intersect; auto-switches to Add after the first stroke          | `partial`  | `QuickSelection.tsx:148` |
| Size                         | brush diameter, from the preset picker, with Hardness / Spacing / Angle / Roundness | `partial`  | `QuickSelection.tsx:111` |
| Select and Mask              | opens the Select and Mask workspace to refine the result                            | `missing`  | —                        |
| Sample All Layers            | makes the selection from all visible layers, not just the current one               | `missing`  | —                        |
| Auto-Enhance (Enhance Edge)  | smoother, more refined edges; flows toward image edges; slower                      | `missing`  | —                        |

**App fidelity: partial**, and the gap is the algorithm, not the bar. (The `Mask` row that used to
sit between `Select and Mask` and `Sample All Layers` is gone from this table and from the data
file; see the `Mask` subsection above and `## Unverified` item 10.)

**The `Tolerance` slider is not a Photoshop control.** This remains the single most important
correction in this pass. Photoshop's Quick Selection has **no** `Tolerance`; Tim Grey's
controlling-the-tool article states it directly — "the Quick Selection tool does not include a
setting such as the Tolerance control for the Magic Wand tool" — and no Adobe page for the tool
lists one, across the 2022, 2023 and 2025 versions. The app's slider is passed straight to
`floodFill` as a per-channel distance, which makes it the Magic Wand's `Tolerance` wearing the
Quick Selection's name, and it is the mechanism by which this tool's selections differ from
Photoshop's at all.

**The consequence, which is the real finding.** `growAlongStroke` re-seeds a region grow at
every dab along the stroke, using `floodFill(imageData, seed, { tolerance, contiguous: true })`.
Photoshop's tool "tries to find image edges and automatically stops the selection there" and
"automatically detects image edges as you drag". A flood fill stops at a _color_ boundary, not
at an _edge_, so the app's region grow will run through a soft, continuous gradient that
Photoshop would stop at, and will stop short of a hard edge between two colors that differ more
than the tolerance. It is a region-growing brush, not an edge detector, and the `Tolerance`
slider is what a user reaches for when it goes wrong — the one control that would fix it is the
one Photoshop does not have. Because the control is not a Photoshop control it does not appear
in the `options` array; it is recorded here and in `appNotes`.

**Also divergent.** The `Mode` dropdown offers only `Add` and `Subtract`, so there is no way to
start a fresh selection and no `Intersect`. `Sample All Layers` is absent and the stroke reads
the merged composite canvas. `Select and Mask`, `Auto-Enhance` and the tool-preset picker
are absent, and there is no route from a selection to a layer mask at all. The brush is flat — no hardness, spacing, angle or roundness — and `[`/`]`, the
Alt-drag size gesture and the live size/opacity readout are not bound. The committed region is one
traced contour, so a grown region containing an enclosed hole is refused outright rather than
committed, and a `Selection` cannot express the hole.

**Both modifier rows are unannotated false claims about the app.** `QuickSelectionToolArea` reads no
modifier key either, so neither the `Alt`-subtracts-for-the-stroke row nor the
`Ctrl+Alt`-drag-changes-the-brush-size row has an implementation. Both were carried as if they did.
The rows are kept as Photoshop descriptions and the absence is now in `appNotes`.

**The second row was also a false claim about Photoshop, and is now corrected in the data file.** It
read "the same gesture Photoshop binds on every brush tool" for a plain `Alt`-drag. Adobe's own
brush-shortcut post gives the real bindings: "On Mac: **Control + Option** –drag left/right in order
to decrease/increase brush size and up/down to decrease/increase brush hardness" and "On Windows:
**Control + Alt + Right click** -drag left/right to decrease/increase brush size and up/down
decrease/increase brush hardness"
(`jkost.com/blog/2017/05/brushes-and-painting-tool-shortcuts-in-photoshop-cc.html`). Plain
`Alt`-drag is not bound to brush size on either platform, so the row's `keys` is now `Ctrl+Alt` and
its `action` states the macOS and Windows forms and says the plain-`Alt` gesture is not bound. The
`[`/`]` rows on the same tool are Photoshop's and are unaffected.

**The bar promised a gesture it did not honour — and the promise is now gone.** This section used
to be the sharpest finding in the family: the quick-selection bar's hint text read "Shift and Alt
drag on the canvas" on both the Subtract branch (then `QuickSelection.tsx:99`) and the default
branch (`:100`), while the tool area consulted neither key. An on-screen promise to the user, not
a documentation gap — and the only false claim in the family a user reads without opening
anything.

`7f3b0d19` **removed the promise rather than implementing the gesture**, and this record was not
updated. The bar's hint is now `Drag over an object to grow the selection along the stroke.`
(`QuickSelection.tsx:105`), with a comment directly above it naming Photoshop's Alt-drag brush-tip
resize and Shift-drag circular constraint as things the app does not do, and saying why that is
preferable to shipping a guess (`:99`-`:101`). The rationale is worth preserving because it is a
judgement, not an implementation: Photoshop's Alt-drag resize maps _drag distance to size_, not a
flag, so implementing it badly would replace one false promise with a wrong gesture.

Both `modifiers[]` rows therefore remain unimplemented and are still recorded as such in
`appNotes`; what is gone is the on-screen claim, and the finding is retained in the data file
rather than deleted, because a record that says only "this works" is less useful to the next
reader than one that says "this used to lie here".

### Sources

- `https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html` (2025-11-04) — three modes, `Size`, `Sample All Layers`, `Enhance Edge`
- `https://helpx.adobe.com/photoshop/using/tool-techniques/quick-selection-tool.html` (2023-05-24) — `(W)`, edge detection on drag
- `https://helpx.adobe.com/ph_fil/photoshop/how-to/use-quick-selection-tool.html` (2022-12-28) — the `Auto-Enhance` label, auto-switch to Add, Option/Alt subtract
- `https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html` (2022-12-28) — `Select and Mask` on every selection tool's bar, "similar tones and image edges", Refine Edge Brush, Properties panel
- `https://helpx.adobe.com/photoshop/using/create-temporary-quick-mask.html` (2023-05-24) — Quick Mask mode
- `https://helpx.adobe.com/photoshop/using/saving-selections-alpha-channel-masks.html` — Quick Mask to mask to selection, alpha channels
- `https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html` (updated 2026-02-23) — View Modes
- `https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html` (2025-11-04) — the overview that describes both tools identically
- `https://helpx.adobe.com/photoshop/web/edit-images/make-selections/automate-selections-with-quick-selection-tool.html` (2025-10-29) — Photoshop **on the web**; brush `Spacing`/`Angle`/`Roundness`
- `https://www.adobe.com/learn/photoshop/web/selection-tools-basics` — "automatically stops the selection there", size and hardness, auto-switch to Add, `Select and Mask`
- `https://asktimgrey.com/2021/04/07/controlling-the-quick-selection-tool` — third party: no `Tolerance` on this tool
- `https://www.photoshopessentials.com/basics/selections/quick-selection-tool` — third party: three mode icons, `W`, smaller cursor accuracy, `Auto-Enhance` cost, the Wand/brush distinction
- `https://cod.pressbooks.pub/photoshopmastery1250/chapter/selections` — third-party textbook: what `Enhance Edge` does; the general four-mode diagram that is _not_ this tool's
- `https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/create-brush-set-painting-options.html` (2025-10-27) — **desktop** page: "Select your preferred settings under Brush Tip Shape to adjust size, angle, roundness, and spacing", which is what closed the `Spacing`/`Angle`/`Roundness` gap
- `https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html` (2026-02-23) — the `Tool Presets` picker: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar", which is what closed the `Tool presets` row's sourcing
- `https://www.adobe.com/products/photoshop/feather-edges.html` — the options-bar `Feather` box's stated 0–100 range, and a second desktop source for `Select and Mask` on a bar
- `https://jkost.com/blog/2017/05/brushes-and-painting-tool-shortcuts-in-photoshop-cc.html` — Adobe presenter: the real brush-size bindings, `Control+Option`-drag (Mac) and `Control+Alt` right-click-drag (Windows)
- `https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html` (Adobe) — the shortcut table: bare letter selects, `Shift+<letter>` cycles
- `https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html` — Adobe presenter: the cycling rule in words, naming `Shift+L` across the three lasso tools

## Unverified

Claims this pass could not establish from a source that was actually opened. Each is either
absent from the data file or hedged inside it, and each names the URL that came closest.

**Three of these are closed.** Items 1, 8 and 11 were re-derived against sources that this pass
opened and are kept in place rather than deleted, each marked `RESOLVED` or `CLOSED` and carrying
the source that closed it — an audit trail is the point of this file, and an entry that silently
vanishes cannot be distinguished from one that was never wrong. Every one of their sources was also
folded into the relevant tool's `## Sources` in the data file. The numbering is left **gapped and
unrenumbered** because items 7 and 10 are referenced by number from elsewhere in this file and
from the data file's `appNotes`; a gap is cheaper than a broken cross-reference.

1. **RESOLVED — the options-bar `Feather` field's maximum is 0–100 pixels, and the two figures that
   made this look open are two different controls.** Adobe states it directly: "From the settings
   bar at the top of the window, select **Feather**… In the text box, enter a value of **between 0
   and 100 pixels** to determine how heavily the Feather effect will be applied to the selected
   area" (`https://www.adobe.com/products/photoshop/feather-edges.html`). That is the **options-bar
   box**, the same one the magnetic lasso renders, and 0–100 is the same ceiling the app's slider
   uses (`FeatherMagneticLasso.tsx:275`) — so the cap was never a divergence and the
   `feather-magnetic-lasso` `appNotes` no longer claims it is. The `0.1–1000` figure in the UXP
   reference belongs to `Select > Modify > Feather`, which is a **separate command applied to an
   existing selection** with a `Feather Radius` argument, not a field on any tool's bar; the
   desktop feathered-edges page documents the two as distinct paths ("Define a feathered edge for
   a selection tool" → "Enter a value in the Feather box in the Options bar", versus "Define a
   feathered edge for an existing selection" → "Go to Select > Modify > Feather"), at
   `https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html`.
   The UXP `feather` argument on `selectRectangle` / `selectEllipse` / `selectPolygon` is a third
   thing again — a scripting argument, not a UI field — and is still described as a range rather
   than a UI maximum in the marquee `Feather` rows. What is left open is narrower and is recorded
   where it belongs: the app has no `Select > Modify > Feather` at all, and its magnetic-lasso
   feather reaches only the copied mask.

2. **The Magnetic Lasso's two-slider `Smoothing` group (`Feather` + `Width` smoothers).** The
   brief asked for this specifically. No current Adobe page documents it: the 2023-12 and
   2024-12 `selecting-lasso-tools` pages and the 2023 `tool-techniques/magnetic-lasso-tool` page
   list `Feather` and `Anti-alias` as the feathering pair and `Width`, `Contrast`, `Frequency`
   and `Stylus Pressure` as the edge-detection group, and nothing else. It may be a legacy
   Photoshop CS-era bar, or a mis-remembering of `Select > Modify > Smooth`. The data file
   lists only the documented controls, and the app's `Smooth` slider is described as an
   app-only control with the nearest Photoshop analogue left unclaimed. Closest:
   `https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html`.

3. **`Select > Similar`, and `Select > Grow` in its current form.** Both are the wand's
   follow-ups and neither was established from an opened Adobe page. The closest is the
   Photoshop **CS3** manual's table of contents, which carries the entry "Expand a selection to
   include areas of similar color" (the pre-CS4 name of `Similar`) and, in the same list,
   "Refine selection edges":
   `http://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html`. `Grow` is documented
   in the UXP reference with its tolerance range and its Bitmap/32-bit exclusions, but no
   current user-guide page was opened for either command, so the data file's `appNotes` mention
   their absence without describing what they do in detail.

4. **The `Polygonal Lasso`'s click-and-drag smooth anchor.** Asserted by the research corpus
   (a drag setting both tangent handles) and not re-established here; Adobe's current page
   describes `Alt`/`Option`-drag as a freehand _segment_ and `Alt`+double-click as a _straight_
   close. Closest: `https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html` and
   `https://helpx.adobe.com/photoshop/using/tool-techniques/polygonal-lasso-tool.html`. Left
   out of the data file.

5. **The Magnetic Lasso's fallback on a flat or uniform region**, where there is no gradient to
   snap to. The only statement found is a community wiki ("If no such region can be found, the
   next fastening point will be at the cursor",
   `https://photoshop.fandom.com/wiki/Magnetic_Lasso_tool`), which is below the brief's trust
   threshold on its own and has no Adobe counterpart. Unresolved, as it was in the corpus.

6. **The `Frequency` default of 57 and the `.`/`,` contrast keys.** Both come from
   third-party sources only —
   `https://www.photoshopessentials.com/basics/selections/magnetic-lasso-tool` for the 57, and
   `https://www.lifewire.com/magnetic-lasso-tool-in-adobe-photoshop-4077747` plus a CS3-era
   `http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf` for the keys. Adobe documents the
   keys' existence nowhere in a page this pass opened. Adobe's own sentence is narrower than the
   finding built on it — "A higher value **anchors the selection border in place more quickly**" —
   and the step from that to _lays fastening points down more densely_ is third-party. The data
   file now quotes Adobe and labels the density reading as the inference it is; the default value
   is stated nowhere.

7. **The default state of `Sample All Layers` on the Magic Wand and the Quick Selection, and of
   `Auto-Enhance` / `Enhance Edge` on the Quick Selection.** None of the three is given a default
   by any Adobe page this pass opened. What the sources support is narrower and is what the data
   file now says: Adobe's 2022 tutorial instructs the user to _add_ a checkmark to
   `Auto-Enhance`, which is evidence it does not start enabled but is not a statement of its
   default; "unchecked by default" for the wand's `Sample All Layers` is
   `photoshopessentials.com`'s claim alone (CS5-era), and the data file's `Sample All Layers`
   row now says exactly that instead of asserting it flatly. **No source found in this pass —
   Adobe or otherwise — says `Auto-Enhance` is on by default**, which is the premise the addendum
   asked about and which this pass could not confirm. My first version of this file asserted "off by
   default" for all of these from an inference about a drawn-unticked checkbox; that inference is
   withdrawn. Closest: `https://helpx.adobe.com/ph_fil/photoshop/how-to/use-quick-selection-tool.html`
   and `https://www.photoshopessentials.com/basics/selections/quick-selection-tool`.

8. **CLOSED — Quick Selection brush `Size` / `Hardness` and the `Spacing` / `Angle` / `Roundness`
   flyout are no longer web-only.** This item previously read that the page enumerating
   `Spacing`, `Angle` and `Roundness` is Adobe's **Photoshop on the web** page and that no desktop
   page documents the hardness control. That is no longer true, and the source is already in this
   tool's `## Sources`: Adobe's desktop brush page instructs the reader to "Select your preferred
   settings under **Brush Tip Shape** to adjust size, angle, roundness, and spacing"
   (`https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/create-brush-set-painting-options.html`,
   2025-10-27), which documents all four on desktop Photoshop as brush-tip-shape settings, and
   Adobe Learn's desktop tutorial says to "adjust the size and hardness of the Quick Selection
   tool in the options bar". `Size` was already scored `partial` and stays there: the app renders a
   flat size slider with no hardness, and the `Tool presets` row beside it is `missing` outright.

9. **Photoshop's default `Frequency` semantics of the _magnetic_ lasso versus its `Feather`
   being a _smoother_ rather than a selection feather.** Adobe's current page describes
   `Feather` purely as the feathering width, and every third-party account read agrees. The
   older characterisation of the magnetic `Feather` as a path-smoothing radius could not be
   confirmed from any opened source, and the data file treats it as a selection feather
   accordingly.

10. **The `Mask` button on a selection tool's options bar.** No Adobe page found in this pass
    documents a `Mask` button on a selection tool's options bar; what Adobe documents is the
    **Layers panel's** `Add layer mask` button ("The resulting layer mask is black where there was
    no selection, hiding the background around the subject" —
    `https://helpx.adobe.com/ph_fil/photoshop/how-to/fine-tune-layer-masks.html`) and the Select
    and Mask workspace's `Output To` menu, which the third-party guides enumerate as `Selection`,
    `Layer Mask`, `New Layer`, `New Layer with Layer Mask`, `New Document`, `New Document with
 Layer Mask`
    (`https://www.howtogeek.com/289255/how-to-make-more-precise-selections-with-photoshops-select-and-mask`).
    The `Mask` row also asserted a **position** on the bar that no source supports.
    **The row has been removed from the data file** rather than kept on the mined bar row, since
    a control with no page documenting it and an invented position is not a claim the file should
    carry; the surviving fact is in the Quick Selection's `appNotes` — the app has no route from a
    selection to a layer mask. The `Select and Mask` row beside it is solidly Adobe-sourced; this
    one is not. It was also the only tool carrying the row, which was itself an artifact of the
    mined corpus rather than of a documented difference.

11. **CLOSED — the `Tool presets` picker is a per-tool options-bar control, and Adobe's current
    desktop page says so.** This item previously rested on a third-party textbook ("Presets: Use
    this option to save Presets specific to the tool being used", `cod.pressbooks.pub`) and on the
    claim that no Adobe page documents the picker on a selection tool's bar. Adobe's own page now
    names it and places it: "You can also select the **Tool Presets dropdown menu next to the tool
    at the upper-left of the Options bar**. Select Create New Tool Preset icon"
    (`https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html`,
    2026-02-23), and an Adobe presenter calls the same control by name — "click the tool icon in the
    Options bar (officially called the **Tool Preset Picker**)"
    (`https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html`).
    The data file's `Tool presets` row is unchanged in substance — still `missing`, still the
    leftmost item on the bar — and now carries an Adobe-desktop source in the tool's `## Sources`.

12. **The Magic Wand being unavailable on Bitmap and 32-bits-per-channel images — HALF RESOLVED.**
    The **32-bit** half is Adobe's, and Adobe names this tool: "All tools in the toolbox except:
    **Magnetic Lasso, Magic Wand**, Spot Healing Brush, Healing Brush, Red Eye, Color Replacement,
    Art History Brush, Magic Eraser, Background Eraser, Paint Bucket, Dodge, Burn, and Sponge"
    (`https://helpx.adobe.com/photoshop/using/high-dynamic-range-images.html`). The data file's
    `magic-wand` `purpose` used to say the exclusion was "an exclusion Adobe states for the
    Magnetic Lasso, **not for this tool**", which was wrong on the evidence and is corrected: the
    sentence now quotes Adobe's list and says the **Bitmap** half is the one half no Adobe page
    states. The Wand is greyed out on a Bitmap document in practice, and the UXP reference carries
    Bitmap/32-bit exclusion lists for `Grow` and related commands
    (`https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/`), but that is
    a command exclusion, not a statement about the tool.

13. **The Magic Wand's four defaults — `Tolerance` 32, `Contiguous` on, `Anti-alias` on,
    `Sample All Layers` off.** Adobe's 2025-11-04 desktop page gives the `Tolerance` **range**
    ("from 0 (narrow) to 255 (broad)") and **no default**, and describes the other three by effect
    without stating a default. The four values come from `photoshopessentials.com` and Adobe's
    **Photoshop Elements** page
    (`https://helpx.adobe.com/ca/photoshop-elements/using/making-selections.html`), which is a
    **different product**. The data file's four rows now name that provenance inline instead of
    asserting a default flatly; the ranges and effects, which are Adobe's, are stated without
    qualification. Item 7 above covers the same ground for the Quick Selection's `Sample All
Layers` and `Auto-Enhance`.

14. **Whether the Magic Wand's desktop options bar carries a `Feather` control at all — OPEN, and
    the two sides of it are both Adobe's.** This is the one row in the family that exists only
    because the sources disagree, so the disagreement is recorded rather than resolved in favour
    of whichever page was read last.

    - **Against:** Adobe's **current desktop** page on softening selection edges
      (`https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html`,
      last updated 2026-02-23) enumerates what can be feathered — "tools like the **Rectangular
      Marquee, Lasso, Polygonal Lasso, or Magnetic Lasso**" — and the wand is not in the list,
      while the anti-aliasing list on the same page ("Lasso, Polygonal Lasso, Magnetic Lasso,
      Elliptical Marquee, and Magic Wand") does include it. The wand's own current desktop page
      (2025-11-04) lists `Sample Size`, `Tolerance`, `Anti-alias`, `Contiguous` and
      `Sample All Layers` and no `Feather`. A third-party tutorial of the Photoshop CS era labels
      the control "**Feather (Lasso Tool Only)**"
      (`http://www.neathphotographicsociety.co.uk/Tutorials/Photoshop/Making_Selections.pdf`).
    - **For:** Adobe's own **mobile** page for this tool
      (`https://helpx.adobe.com/ee/photoshop/mobile/edit-images/make-selections/enhance-selections-with-the-magic-wand.html`,
      last updated 2025-07-02) instructs the reader to "Select Magic wand **again** to access the
      more menu and adjust the **Feather** slider to define the feathering width as needed", and
      lists only `Anti-alias`, `Contiguous` and `Tolerance` beside it — which is a bar with a
      Feather and a three-control rest, matching the CS-era shape. The UXP `Selection` reference
      also carries a `feather` argument defaulting to 0 on its selection-creating calls.

    Both hedged words are Adobe's ("such as", "like"), so neither list is a closed enumeration and
    neither page settles it. What the record can say is narrower and is what the data file's row
    says: **the desktop bar as documented in 2025–2026 carries no `Feather`, and earlier releases
    did.** The app renders none either way, so the row's `status` is `missing` and the row's
    presence is a statement about Photoshop, not about a gap the app has.
