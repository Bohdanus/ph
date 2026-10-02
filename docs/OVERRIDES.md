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
