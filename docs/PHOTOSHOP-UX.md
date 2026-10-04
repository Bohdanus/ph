# Photoshop UX: the rail, the panels, and the names

This app is a Photoshop clone, not a "Photoshop-inspired" surface. The Tools rail
in particular must be an exact clone of Adobe Photoshop's Tools panel: same tool,
same group, same name, same spot, same letter. A user switching from Photoshop
must find the same tool where their hand expects it.

`docs/TOOLS.md` is the generated per-tool specification, built from
`src/tools/descriptions/*.ts` and the `src/tools/descriptions/*.notes.md` files
beside them. This file is the requirement and the open violations.

This file is the rail. The **panels** are specified in
[`LAYERS-PANEL.md`](LAYERS-PANEL.md), and the same two rules apply to them: a
control Photoshop does not have is not added, and a control it has is not
relabelled or renamed into an app-specific word. The title keeps "the panels"
because the panel-side rules this file states below are general — the Channels
and Paths tabs, when they exist, are governed by the same requirement.

## The requirement

**A tool Photoshop does not have must be deleted and replaced by the Photoshop
tool it stands in for.** This is a product requirement, not a preference, and it
is not subject to local judgement.

The rail's groups, flyouts and rendered labels are all defined in
**`toolbar-mapping.ts` at the repository root** — not under `src/components/` —
so that is the first file to read. Concretely, all of the following are currently
violations on `main`.

## Open violations

- **No invented tools.** `draw` ("Draw Tool") is the clearest case, and it is **one
  of two** tool ids the app declares that Photoshop has no counterpart for:
  `draw` and `shape`, which are the two bullets that follow. Do not scope the
  work to `draw` and declare the requirement met.
  `draw` itself is a freehand-annotation layer tool; Photoshop's nearest is the
  Brush, and the app already has a Brush. **It is to be deleted**, not relabelled —
  except that `draw` is the one tool this requirement does not reach, under the
  operator's override recorded below.

- **The operator has decided: the three come out of the rail.** 2026-10-01, in
  their words, "I decide to remove them." The **rail entries** go — Photoshop's
  Tools panel has no such entries, and they have **no replacement tool** because
  Photoshop puts nothing in their place. The **processors are not deleted**; the
  capability is to be restructured, not dropped. **DONE** — the flyout is gone from
  `toolbar-mapping.ts`, the rail is fifteen groups, and `extraTools` is the list of
  registered tool ids that carry no rail entry.
  - **The destination already existed, mislabelled, and two surfaces had to change
    together.** The app's menus were File, Tools, **Edit**, Window. `Edit` already
    dispatched `color`, `blur`, `levels`, `transform`, `draw` and `text` through the
    header's own tool selection, and `TOOL_MENU_ITEMS` carried all three as well. A tool list is not one surface: "delete three rows from
    `toolbarMap`" was never sufficient on its own, and a non-tool in the Tools menu
    is the same defect one level up.
    - **The `Tools` menu itself was removed on 2026-10-04**, when the menu bar was
      rebuilt against Adobe's own list: `File, Edit, Image, Layer, Type, Select,
Filter, View, Window, Help`, and no `Tools` among them — Photoshop has no such
      menu, and `docs/OVERRIDES.md` has never had an entry excusing one. So the second
      surface named above stopped existing rather than being corrected, and
      `TOOL_MENU_ITEMS` is gone. Tools are reachable the two ways Photoshop reaches
      them: the rail's tiles and flyouts, and the single-key bindings. The invariant
      `TOOL_MENU_ITEMS` was carrying — no registered tool without a reachable surface —
      now lives in `SidebarLeft/__tests__/toolbar-mapping.test.ts`, against the
      registry rather than against a hand-written list of menu rows.
  - **`levels` is not Adobe's Levels, and moving it unchanged would have been a new
    falsehood.** `LevelsToolArgs` is `{ brightness, contrast }` and the processor
    emits one `ctx.filter` from those two, so the app's "Levels" is
    **Brightness/Contrast under Photoshop's wrong name** — Adobe's Levels is a
    three-control-point piecewise-linear remap with a channel selector, a histogram,
    output levels and Auto. Renaming it `Brightness/Contrast` is what makes the name
    TRUE rather than false; it is not a dodge. It is still an `Image ▸ Adjustments`
    command either way, so the rail verdict does not change; the label was the second
    defect.
  - **`color` is hosted by `Desaturate`, and `Photo Filter` is disabled.** Its three
    controls are grayscale, sepia and saturation. Adobe's Desaturate "assigns equal red,
    green, and blue values to each pixel in an RGB image" and "has the same effect as
    setting Saturation to minus (-)100 in the Hue/Saturation adjustment"
    (<https://helpx.adobe.com/photoshop/using/applying-special-color-effects-images.html>), so the leading two controls are the command it is named for and `sepia`
    is the bounded divergence — Adobe's Desaturate is a one-shot command with no dialog.
    `Photo Filter` is not a partial match at all: Adobe's is a lens filter with a
    Density slider and a Preserve Luminosity option, and the bar reproduces none of
    the three, so it is an unbuilt command and carries the `disabled` item every
    unbuilt command carries. `Black and White` is not an option either — it needs
    per-hue sextant weighting and there is no hue decomposition anywhere in `src`.
  - **The capability is coming back, as real commands, and the requirements do not
    exist yet.** 2026-10-01, after the decision above: Levels, Colors and the other
    `Image ▸ Adjustments` commands "will be implemented". This **does not reopen the
    rail decision** — the three ids still leave the rail, because Adobe's Tools panel
    has no such entries. What it changes is the `levels` bullet: if real Levels is
    built, the honest item is `Levels` computing Levels. Adobe's pages are the
    requirement; this sentence is not a spec, and an agent starting the work asks
    for the requirements rather than deriving them from `src/tools/levels.ts`.
    `docs/TOOLS-TOO-HARD.md`'s "nobody re-audits it, nobody estimates it" policy is
    **suspended for the `Image ▸ Adjustments` family** — otherwise the next session
    reads that file by its own stated policy and treats the gap as a closed decision.

- **"No adjustment is a tool" is too strong, and a rail audit will catch it.** Adobe
  ships a real Tools-panel entry whose output is an adjustment: the **Adjustment Brush
  Tool**, beta in 25.9 (Feb 2024), GA in **25.11 (July 2024)**, in its own toolbar slot
  in the Retouching & Painting Tools group, with no single-letter shortcut (the
  widely-quoted `K` is the CS3-era Targeted Adjustment Tool, a different and removed
  tool). Adobe: it is "non-destructive, as they generate a new adjustment layer with a
  layer mask". The **Selection Brush Tool** is also real, GA in the same 25.11, in the
  **Lasso group**, reached by cycling `L` then `Shift`+`L`.
  **The narrow claim is the one that survives, and it is the one the rail rests on:** the
  `Image ▸ Adjustments` commands are not Tools-panel entries **as commands**, and the two
  whole-image ones have **no mask** — the Adjustment Brush can only apply an adjustment
  where you paint, so it cannot do what `color` and `levels` do. What does not survive is
  the general claim that no tool produces an adjustment.

- **No pseudo-tool.** `shape` is a grouping container carrying a `figure`, and
  Adobe has no tool by that name. It is not uniquely undisplayed, which is the
  trap in deleting it: `rectangle`, `ellipse`, `triangle`, `polygon` and `line`
  are **also** registry ids the rail never names, so "the one `ToolName` the rail
  never displays" points at the wrong target. `shape` is the only id the flyout
  routes every figure through. Photoshop's shapes are Rectangle, Ellipse, Triangle,
  Polygon, Line, Star and Custom Shape as **seven separate entries in one flyout**;
  the flyout has **six** today (the shape flyout in `toolbarMap`) and `Star` is the
  missing one.
- **Names are Adobe's, spelled Adobe's.** "Move Tool", "Rectangular Marquee Tool",
  "Ellipse Tool" (not "Ellipse"). The registry identifier is free — `reposition`
  for the Move tool is acceptable — but the **rendered label** is not and must end
  in `" Tool"`. Scanning all **40** `label:` entries in `toolbarMap` (the five
  `shape` figures and the six Pen-family entries each carry their own label, so the
  entry count is 40 and not the tile count): **none lack the suffix**. It used to be
  exactly three — `Colors`, `Levels` and `Transform` — and those three left the rail
  entirely, because they are `Image ▸ Adjustments` and `Edit ▸ Transform` commands
  rather than tools; `extraTools` (`toolbar-mapping.ts`) is the list that now records
  them.
  "Content-Aware Move tool" is hyphenated
  in Adobe's tables but **no such tool exists in the app yet**, so there is nothing
  to rename — when it lands, render it that way.
- **A tool the app cannot actually do still belongs in the rail**, rendering
  Photoshop's real options bar, because that is the contract. **Seven** tools
  currently render a `PlaceholderTool` chip bar instead — the six Pen-family tools
  and Custom Shape. Photoshop's grouping and naming are the specification; the stub
  bar is the debt.
  - **The placeholder roster is seven, not eight.** **Color Replacement is NOT on
    that list and must not be put back on it.** It left the roster:
    the `color-replacement` entry in `src/tools/toolsMap.ts` wires the real
    `ColorReplacement.tsx`, the `color-replacement` removal note in
    `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts` records the
    removal, and the
    `it('renders a real options bar for every tool that left the placeholder roster')`
    case in `src/tools/__tests__/tool-processors.test.ts` asserts the real
    bar renders for every name that left the roster, while the
    `it('claims no tool for both the placeholder roster and the real options bars')` case
    in the same file asserts the two lists stay disjoint. Re-derive the count with
    `grep -c "placeholderTool(" src/tools/toolsMap.ts` and the `placeholderNames`
    list in that same test file; both answer seven.
  - **`draw` is a live tile, and it is the last deletion.** **The deletion is
    suspended: `OVR-2` in [`OVERRIDES.md`](OVERRIDES.md) keeps the `draw` tile in the
    rail, labelled "Draw Tool", and rules that it carries no keyboard letter.** The
    `{ label: 'Draw Tool', name: 'draw' }` entry in `toolbarMap`
    gives it its own tile at the end of the painting band, so the invented tool is not
    hidden in a flyout — it is a visible tile. **It is not keyboard-reachable, and the
    absence is deliberate rather than an oversight**, so there is no badge to read and
    no false promise in one: the entry declares no `shortcut` because it previously
    declared `shortcut: 'B'`, the Brush's own key, which made the rail render a `B`
    badge on a tile whose key selects the Brush. `SidebarLeft` draws `tool.shortcut` as a
    `<kbd>` only where one is declared, `AppKeyboardShortcuts.tsx` binds no key at all
    to `draw`, and `HANDOFF.md` §119 records both halves. Three assertions in
    `src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts` pin it, the
    load-bearing one being
    `it('gives the Draw tool no shortcut, because no key selects it')`. It is also the
    suite's default way to make a mark, which is
    why `HANDOFF.md` §74 sequences it last: `clickToolButton(page, 'draw')` occurs in
    every `e2e/*.spec.ts` that makes a mark — count them with
    `grep -rc "clickToolButton([^)]*'draw'" e2e --include="*.spec.ts"`, which excludes
    the non-spec files that also call it — and `e2e/pen-types.spec.ts` exists
    specifically to test it and dies with the tool. Re-derive that number rather than
    quoting one: `HANDOFF.md` §74's own figure for this ("25 call sites across 14 e2e
    specs") does not reproduce against this counting rule and must not be copied forward.

## What is not a tool

- **A tool named by a panel's title is not a tool.** Adobe's Clone Source is
  `Window ▸ Clone Source`, a panel, not a Tools-panel entry.
- **Not tools, and not to be implemented as tools:** the foreground/background
  swatches, "Edit in Quick Mask Mode", the three screen-mode toggles, the `…` Edit
  Toolbar caret, the toolbar grip, and the Extra Tools container.

### The foreground/background swatch pair BELONGS in the rail, and must NEVER be hidden

**The rail's colour pickers are not part of what collapses.** The operator's standing
constraint: nothing may hide them — not to save space, not at a short viewport,
not when the toolbar fit collapses every tool into the three-dots tile, not in
either layout mode. The rail swatch pair is the app's ONLY way to choose a paint
colour, so losing it takes the capability away silently, in the one place nobody
would think to look for it. A test pins the cluster, both swatches, both native
`<input type="color">` elements and the swap, at the most collapsed state the fit
can produce — the one-tile rail:
the `it('leaves the colour pickers in the rail when the fit has collapsed to this
tile alone')` case in `src/components/SidebarLeft/__tests__/SidebarLeft.overflow.test.tsx`
collapses the fit to zero visible tools and asserts all six of those nodes are still
in the document.

Being "not a tool" is not the same as "not in the rail" — and the swatch pair is
in the rail. Adobe's page on it
(`helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`)
carries a section headed **"Set colors with the toolbar"**, and names the _Set
foreground color box_, the _Set background color box_, _Switch Foreground and
Background Colors_ and _Default Foreground and Background Colors_ as controls of
that toolbar. Verified by fetching the page: all five phrases are in the body
(HTTP 200). It 403s to a browser-shaped User-Agent, so a `curl` with the default
one is how to read it.

This app has no Color, Swatches or HSB panel, so a request to remove the pair is
a real fidelity loss, not a correction. The pair is one of only **two** writers of
the store colour — the other is the Eyedropper
(the `SET_COLOR` dispatch in `handlePointerDown()` in
`src/components/Main/EyedropperToolArea.tsx`, the only dispatch of
`SET_COLOR` outside the rail) — so deleting the pair leaves the Eyedropper as the
sole writer and the Paint options bar, which mirrors that colour into its own args
(the store-colour `useEffect` in `createPaintToolbar()`'s `PaintToolbar` in
`src/components/ToolbarsRight/Paint/Paint.tsx`) and tints its swatch from it
(the `isLightColor(color)` chessboard swatch beside the `previewRef` canvas in the same
component), showing a value nothing
can change.

## Confidence and provenance

**Membership is Adobe-confirmed; group order and separator placement are not.**
Adobe publishes no page that enumerates the Tools panel top-to-bottom — they
publish five topical overview tables (selection, retouch, painting, drawing,
navigation-and-measuring) plus a Customize toolbar page — so the group order is a
reconstruction from two independent third-party 2026 toolbar diagrams,
cross-checked against Adobe for membership. Treat it as a good hypothesis and
prefer a grouping a user recognises over one a source asserts. `docs/TOOLS.md` and
the `.notes.md` files carry the per-tool sources; a description without a source is
a rumour.

The navigation-and-measuring overview is Adobe's least complete: only one line
was retrievable ("Ruler tool Measures distances, locations, and angles"). Hand,
Rotate View, Zoom, Frame, Slice, Perspective Crop, Slice Select, Path Selection
and Direct Selection are therefore **not Adobe-table-confirmed** and are listed
from the shortcut PDF and individual tool pages. That list lives here; nothing
else in the repository carries it.

Two 2026 candidates are **not** Adobe-confirmed and must not ship as tools: Clone
Source (a gap in one diagram's icon numbering, name never printed) and Generate
Image (a real feature, unconfirmed panel placement).

Selection Brush (Lasso group) and Adjustment Brush (Brush flyout sibling, a large
feature involving an adjustment layer plus a painted mask) are desktop Photoshop
and Adobe-confirmed. `HANDOFF.md` §74 records the corrections that brought them
into the list.

**Naming traps in the source material, so nobody "fixes" them later:** Adobe's
tables say "Elliptical Marquee tool" and "Ellipse tool" — two different words for
two different tools. Adobe's painting table prints "Gradient tools" in the
plural, which conflicts with the singular everywhere else; that one is a genuine
Adobe-side inconsistency. "Content-Aware Move tool" is hyphenated.

## What it costs

Adding a tool means updating every hand-written registry list, including
`dispatchTable`, `icons`, and `src/components/SidebarLeft/__tests__/toolIcons.test.tsx`.
The hand-copied lists in the tests are the expensive part.
`toolIconNames` in `src/components/SidebarLeft/__tests__/toolIcons.test.tsx` carries a
**49-name** union by hand (49 = the 44 `ToolName`s plus 5 `shape-*` figure icons),
byte-identical and in the same order to `ToolIconName` in
`src/components/SidebarLeft/types.ts`; **keep it that way**.

**`HANDOFF.md` §74 is the rail-clone target and the file-by-file blast
radius** — it enumerates the hand-copied lists and the tests that pin tool names
(`src/util/__tests__/constants.test.ts`, `toolIcons.test.tsx`, the four rosters in
`src/tools/__tests__/tool-processors.test.ts`,
`src/components/SidebarLeft/__tests__/SidebarLeft.rendering.test.tsx`,
`src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts` and
`src/components/Common/AppKeyboardShortcuts.tsx`). **`HANDOFF.md` §68
is not this**: it is about a committed shape being painted twice, and
its pointer here was wrong. Count the lists yourself before estimating an edit rather
than trusting a number written anywhere — including the 49 and the 44 above, which are
cheap to re-derive with `grep -c` and a line count.
