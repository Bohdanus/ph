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
