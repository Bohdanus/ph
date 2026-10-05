# Overrides

**THIS FILE IS WRITTEN BY THE OPERATOR, BY HAND. AN AGENT MUST NOT ADD, EDIT,
REORDER OR DELETE AN ENTRY HERE, AND MUST NOT ASK FOR ONE TO BE ADDED.**

Those are the same prohibition from the other side, and both matter. If an agent
can ask, the answer becomes a negotiation; if the agent acts on the ask before the
answer, the override is already in the code with no record of who decided it. An
override that an agent can write is not an override.

## What an override is

A decision that this app deliberately does **not** replicate Photoshop's behaviour,
and that some other behaviour is correct instead.

The precedence ladder in [`DOCUMENTATION.md`](DOCUMENTATION.md) puts Adobe's
documentation above every document in this repository. This file is the only thing
that changes that, and only for what it names.

## What an override is not

- **Not a difficulty.** A capability that is merely expensive to build belongs in
  [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md). That file records decisions to not
  build; this one records decisions to build something _else_. An agent may add to
  the first and must never touch the second.
- **Not a defect.** If the code disagrees with Adobe and there is no entry here,
  the code is wrong. Write it up in [`../HANDOFF.md`](../HANDOFF.md).
- **Not an answer to a question an agent raised.** An agent that finds a genuine
  conflict between this app and Photoshop records the finding in
  [`../HANDOFF.md`](../HANDOFF.md) and stops. It does not implement the other
  behaviour while it waits, because unrecorded behaviour is indistinguishable from
  a decision nobody made.

## Entry format

The operator's format, kept simple so an entry is cheap to write and impossible to
misread:

```
### OVR-n — <one line: what Photoshop does>

**This app:** <what it does instead>
**Operator decided:** <date>
**Why:** <the reason that is not self-evident from the two lines above>
```

## Entries

### OVR-1 — Photoshop fills the area an extended crop adds with the

Background layer's colour when the bottom layer is a locked Background

**This app:** An extended crop always leaves the added band transparent,
whatever the bottom layer is.

**Operator decided:** 2026-10-02

**Why:** This is the Background-layer case of Photoshop's Fill dropdown,
and it is the only cheap one. The other two values — Content-Aware and
Generative Expand — are a patch-based synthesis model and a cloud
generative feature, and are recorded in TOOLS-TOO-HARD.md instead.

### OVR-2 — Photoshop's Tools panel has no Draw tool

**This app:** A `draw` tile stays in the rail, labelled "Draw Tool",
with a Pen Type dropdown — Pen, Dashed Pen, Spray. A stroke is
committed as a new layer, not composited into the current one.

**Operator decided:** 2026-10-02

**Why:** A stroke that is its own layer is a separately undone and
separately deleted object. Photoshop's Brush and Pencil both paint
into the layer you were already on, so neither can do this.

Dashed Pen and Spray stand in for a dash control and an airbrush
control the paint bar does not have yet. That hold is temporary, and
this entry is where it is revisited when they land.

Suspends [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md) on `draw`: "No
invented tools", and "`draw` is a live tile, and it is the
last deletion". No keyboard letter — Adobe's single cycling
`B` already serves four tools.

### OVR-3 — Photoshop's Tools panel has no dimmed tools

**This app:** A rail tile and a flyout row whose tool is
unimplemented — `pen`, `freeform-pen`, `curvature-pen`,
`add-anchor-point`, `delete-anchor-point`, `convert-point` and
`custom-shape` — render at `filter: opacity(0.4) grayscale(1)`.
The tile is dimmed when the tool it displays is unimplemented, so
the Pen tile is dimmed and the Shape tile is not, even though the
Shape tile's flyout carries the unimplemented Custom Shape.

**Operator decided:** 2026-10-04

**Why:** The rail is a clone, so the seven tools sit in it with
Adobe's names and Photoshop's grouping even though six of them
mount an inert surface. The dimming is the only honest signal
that they are in the panel as SPECIFICATION and not as working
buttons, and it is why this is an override rather than a defect:
Photoshop greys a control that is disabled for a reason it can
name, and it never presents a tool it cannot run as available.

The dimming is visual only. Every one of the seven stays
clickable, still mounts its stub options bar, and keeps its
`data-testid` and its tooltip, because a tool the app cannot do
is still a place the user can go to read what is missing. The set
is derived from `toolProcessors`'s `commit: 'unimplemented'` at
runtime (`UNIMPLEMENTED_TOOL_NAMES` in `SidebarLeft.tsx`) rather
than listed, so a tool that lands stops being dimmed without
anything here being edited.

**The fraction is 0.4 in light and 0.55 in dark**, which corrects
an earlier claim in the same entry that one value served both
themes because "40% of a grey lands at the same perceived weight
in each". Measured in a browser, it does not: the filter applies
to the element's whole rendering, so the dark tile's own fill goes
through `grayscale(1)` and the opacity along with its glyph, and
the dark rail is far enough below the glyph for 40% to land at
3.25:1 where light lands at 2.05:1. The cell that forced the
change is the FLYOUT ROW, not the tile — a row's label is 11px
text owed the ordinary 4.5:1 and got 3.17:1 — so dark is 0.55,
where both of its text cells clear their floor, and light stays at
the button's own `disabled:opacity-40` because it is unregressed
there. `e2e/toolbar-contrast.spec.ts` is the gate.

### OVR-4 — Photoshop's dark interface holds every control above 4.5:1 against its own surface

**This app:** The Ruler's `Clear` button and its seven readout boxes were
styled for the light bar and inherited black text in the dark one, so the
button was drawn at 1.43:1 and the boxes' fill was the bar's own colour at
1.00:1. Both are fixed: the button takes `dark:text-gray-200` on
`dark:bg-gray-700` (8.33:1), and a readout box is `dark:bg-gray-900` with a
`dark:border-gray-500` boundary (3.04:1).

**Operator decided:** 2026-10-04

**Why:** This is recorded as an override rather than a defect because the
fix is a DESIGN decision Adobe does not make: the readout boxes are now a
_recessed_ field — darker than the bar, in both themes — rather than the
raised white-on-light fill the light theme had. A recessed field is a small
step from its surface by design, so the fill-versus-bar pair is 1.21:1 and
stays there deliberately; the BORDER is what carries the box, and it is held
at 3.04:1 rather than pushed further, because a field whose boundary is the
only thing identifying it is exactly the case WCAG 1.4.11 governs.

Nothing about this is Photoshop-specific, so nothing about it should be
permanent. `e2e/toolbar-contrast.spec.ts` gates it in the dark theme, which
is where the defect was invisible to `e2e/accessibility.spec.ts` because
that file pins light.
