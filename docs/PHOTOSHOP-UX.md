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
  Photoshop puts nothing there. `toolbar-mapping.ts` already exports
  `extraTools = ['color', 'levels', 'transform']`, so the extraction is half-staged:
  the flag exists, the rail entries do not.
- **No pseudo-tool.** `shape` is a grouping container carrying a `figure`, and
  Adobe has no tool by that name. It is not uniquely undisplayed, which is the
  trap in deleting it: `rectangle`, `ellipse`, `triangle`, `polygon` and `line`
  are **also** registry ids the rail never names, so "the one `ToolName` the rail
  never displays" points at the wrong target. `shape` is the only id the flyout
  routes every figure through. Photoshop's shapes are Rectangle, Ellipse, Triangle,
  Polygon, Line, Star and Custom Shape as **seven separate entries in one flyout**;
  the flyout has **six** today (`toolbar-mapping.ts:108-115`) and `Star` is the
  missing one.
- **Names are Adobe's, spelled Adobe's.** "Move Tool", "Rectangular Marquee Tool",
  "Ellipse Tool" (not "Ellipse"). The registry identifier is free — `reposition`
  for the Move tool is acceptable — but the **rendered label** is not and must end
  in `" Tool"`. The only labels that do not are the three this section already
  flags (`Colors`, `Levels`, `Transform`). "Content-Aware Move tool" is hyphenated
  in Adobe's tables but **no such tool exists in the app yet**, so there is nothing
  to rename — when it lands, render it that way.
- **A tool the app cannot actually do still belongs in the rail**, rendering
  Photoshop's real options bar, because that is the contract. **Seven** tools
  currently render a `PlaceholderTool` chip bar instead — the six Pen-family tools
  and Custom Shape. Photoshop's grouping and naming are the specification; the stub
  bar is the debt.
  - **The placeholder roster is seven, not eight.** **Color Replacement is NOT on
    that list and must not be put back on it.** It left the roster:
    `toolsMap.ts:117-121` wires the real `ColorReplacement.tsx`,
    `toolbarPlaceholderConfig.ts:13-16` records the removal, and
    `tool-processors.test.ts:592-615` and `:617-635` assert the real bar.
    Re-derive the count with `grep -c "placeholderTool(" src/tools/toolsMap.ts` and
    the `placeholderNames` membership in the same test; both answer seven.

## What is not a tool

- **A tool named by a panel's title is not a tool.** Adobe's Clone Source is
  `Window ▸ Clone Source`, a panel, not a Tools-panel entry.
- **Not tools, and not to be implemented as tools:** the foreground/background
  swatches, "Edit in Quick Mask Mode", the three screen-mode toggles, the `…` Edit
  Toolbar caret, the toolbar grip, and the Extra Tools container.

### The foreground/background swatch pair BELONGS in the rail

Being "not a tool" is not the same as "not in the rail" — and the swatch pair is
in the rail. Adobe's page on it
(`helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html`)
carries a section headed **"Set colors with the toolbar"**, and names the _Set
foreground color box_, the _Set background color box_, _Switch Foreground and
Background Colors_ and _Default Foreground and Background Colors_ as controls of
that toolbar. Verified by fetching the page: all five phrases are in the body
(HTTP 200). It 403s to a browser-shaped User-Agent, so a `curl` with the default
one is how to read it.

Screenshots of a customized or cropped panel can look like it is missing, and a
request to remove it is a real fidelity loss here, not a correction: this app has
no Color, Swatches or HSB panel, so the rail pair is the ONLY way to choose a
paint colour. Deleting it leaves the Eyedropper
(`src/components/Main/EyedropperToolArea.tsx:133`) as the sole writer of
`state.color`, and the Paint options bar, which only READS that colour
(`src/components/ToolbarsRight/Paint/Paint.tsx:214`), showing a value nothing can
change.

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
`dispatchTable`, `icons`, and `toolIcons.test.tsx`. The hand-copied lists in the
tests are the expensive part. `toolIcons.test.tsx` carries a 46-name union by hand
(46 = the 41 tool ids plus 5 `shape-*` figure icons), byte-identical to
`ToolIconName` in `SidebarLeft/types.ts`; **keep it that way**. HANDOFF §68 has the
file-by-file blast radius and the tests that pin tool names. Count the lists
yourself before estimating an edit rather than trusting a number written
anywhere.
