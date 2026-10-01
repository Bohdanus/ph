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
  of five** tool ids the app declares that Photoshop has no counterpart for:
  `draw`, `color`, `levels`, `transform` and `shape`, which are the five bullets
  that follow. Do not scope the work to `draw` and declare the requirement met.
  `draw` itself is a freehand-annotation layer tool; Photoshop's nearest is the
  Brush, and the app already has a Brush. **It is to be deleted**, not relabelled.
- **Adjustments are not tools.** `color` (labelled "Colors"), `levels` ("Levels")
  and `transform` ("Transform") are `Image ▸ Adjustments` and `Edit ▸ Transform`
  commands, and Photoshop's Tools panel contains no such entries. Photoshop's name
  for `color` is "Black and White", which is not a tool either. These three are to
  leave the rail and become menu commands. They have **no replacement tool** —
  Photoshop puts nothing there. **All three are live rail entries today**, in one
  three-wide flyout at `toolbar-mapping.ts:62-64`. `toolbar-mapping.ts:164` exports
  `extraTools = ['color', 'levels', 'transform']`, and **nothing in production reads
  it**: the only reader in the repository is
  `src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts:97-99`. The flag is
  therefore not half-staged extraction, it is a declaration with no consumer —
  removing the three rail entries is unimplemented work, not a flag flip.
  `HANDOFF.md` §117 records exactly this and is open.
  - **They are ALSO live entries in a second place, and there is no menu to move them
    to.** `src/components/Menu/Menu.tsx` renders only a `DesktopHeader` and a
    `ToolbarHorizontal`, so the app has **no `Image` menu and no `Edit` menu at
    all**, and `HANDOFF.md` §74's destination (`Image ▸`, `Edit ▸`) does not exist to
    be routed into. Meanwhile `src/components/DesktopHeader/DesktopHeader.tsx:27-32`
    carries a `TOOL_MENU_ITEMS` list whose `:29`, `:31` and `:32` are `color`,
    `levels` and `transform` — so all three are **Tools-menu entries too**. The
    extraction has to remove three ids from two surfaces and build the menu that
    receives them.
  - **`levels` is not Adobe's Levels.** `LevelsToolArgs` is `{ brightness, contrast }`
    (`src/tools/levels.ts:4`) and the processor emits one `ctx.filter` from those two
    (`src/tools/levels.ts:12`), so the app's "Levels" is **Brightness/Contrast under
    Photoshop's wrong name** — Adobe's Levels is a three-control-point piecewise-linear
    remap with a channel selector, a histogram, output levels and Auto. It is still an
    `Image ▸ Adjustments` command either way, so the rail verdict does not change; the label
    is the second defect.
- **No pseudo-tool.** `shape` is a grouping container carrying a `figure`, and
  Adobe has no tool by that name. It is not uniquely undisplayed, which is the
  trap in deleting it: `rectangle`, `ellipse`, `triangle`, `polygon` and `line`
  are **also** registry ids the rail never names, so "the one `ToolName` the rail
  never displays" points at the wrong target. `shape` is the only id the flyout
  routes every figure through. Photoshop's shapes are Rectangle, Ellipse, Triangle,
  Polygon, Line, Star and Custom Shape as **seven separate entries in one flyout**;
  the flyout has **six** today (`toolbar-mapping.ts:109-116`) and `Star` is the
  missing one.
- **Names are Adobe's, spelled Adobe's.** "Move Tool", "Rectangular Marquee Tool",
  "Ellipse Tool" (not "Ellipse"). The registry identifier is free — `reposition`
  for the Move tool is acceptable — but the **rendered label** is not and must end
  in `" Tool"`. Scanning all **40** `label:` entries in `toolbarMap` (the five
  `shape` figures and the six Pen-family entries each carry their own label, so the
  entry count is 40 and not the tile count): **exactly three lack the suffix**, and
  they are the three this section already flags — `Colors`, `Levels`, `Transform`.
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
    `src/tools/toolsMap.ts:117-121` wires the real `ColorReplacement.tsx`,
    `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13-16` records the
    removal, `src/tools/__tests__/tool-processors.test.ts:610-633` asserts the real
    bar renders for every name that left the roster, and `:584-595` asserts the two
    lists stay disjoint. Re-derive the count with
    `grep -c "placeholderTool(" src/tools/toolsMap.ts` and the `placeholderNames`
    list at `:517-528` of the same test; both answer seven.
  - **`draw` is a live tile, and it is the last deletion.** `toolbar-mapping.ts:97`
    gives it its own tile at the end of the painting band, badged with Photoshop's own
    `B`, so the invented tool is not hidden in a flyout — it is a visible,
    keyboard-reachable tile. It is also the suite's default way to make a mark, which is
    why `HANDOFF.md` §74 sequences it last: `clickToolButton(page, 'draw')` occurs
    **40 times across 23 e2e spec files** (`grep -rc "clickToolButton([^)]*'draw'"
e2e --include="*.spec.ts"`, excluding the two non-spec files that also call it),
    and `e2e/pen-types.spec.ts` exists specifically to test it and dies with the tool.
    Re-derive that number rather than quoting one — `HANDOFF.md` §74's own figure for
    this ("25 call sites across 14 e2e specs") does not reproduce against this counting
    rule and should not be copied forward.

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
`src/components/SidebarLeft/__tests__/SidebarLeft.overflow.test.tsx:519-547`
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
(`src/components/Main/EyedropperToolArea.tsx:133`, the only dispatch of
`SET_COLOR` outside the rail) — so deleting the pair leaves the Eyedropper as the
sole writer and the Paint options bar, which mirrors that colour into its own args
(`src/components/ToolbarsRight/Paint/Paint.tsx:65-68`) and tints its swatch from it
(`src/components/ToolbarsRight/Paint/Paint.tsx:226-231`), showing a value nothing
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
`src/components/SidebarLeft/__tests__/toolIcons.test.tsx:26-71` carries a **46-name**
union by hand (46 = the 41 `ToolName`s plus 5 `shape-*` figure icons), byte-identical
and in the same order to `ToolIconName` in
`src/components/SidebarLeft/types.ts:4-49`; **keep it that way**.

**`HANDOFF.md` §74 (`HANDOFF.md:1745`) is the rail-clone target and the file-by-file blast
radius** — it enumerates the hand-copied lists and the tests that pin tool names
(`src/util/__tests__/constants.test.ts`, `toolIcons.test.tsx`, the four rosters in
`src/tools/__tests__/tool-processors.test.ts`,
`src/components/SidebarLeft/__tests__/SidebarLeft.rendering.test.tsx`,
`src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts` and
`src/components/Common/AppKeyboardShortcuts.tsx`). **`HANDOFF.md` §68
(`HANDOFF.md:1575`) is not this**: it is about a committed shape being painted twice, and
its pointer here was wrong. Count the lists yourself before estimating an edit rather
than trusting a number written anywhere — including the 46 and the 41 above, which are
cheap to re-derive with `grep -c` and a line count.
