# Documentation

How this repository's documents relate, which one wins a disagreement, and what
may not be written by an agent.

Read this before adding a document, before adding a second home for a fact, and
before treating a document as correct.

The index is [`README.md`](README.md). This file is the rule; that one is the map.

## The ladder

Every claim about this project resolves against exactly one of these, in order.
Stop at the first tier that speaks. Going down the ladder is not scepticism about
the tier above, it is the cost of having more than one source.

| #   | Tier                       | What it decides                            | Where it lives                                                                        |
| --- | -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| 0   | **The operator**           | Anything, including this ladder            | [`OVERRIDES.md`](OVERRIDES.md), and a human's direct instruction                      |
| 1   | **Adobe's documentation**  | What Photoshop does, says and offers       | `helpx.adobe.com`, `developer.adobe.com`                                              |
| 2   | **The in-app documents**   | What this code is, does, and must do       | this directory, `src/**/*.notes.md`, and the code                                     |
| 3   | **The recorded decisions** | Why it is that way, and what was ruled out | [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md), entries in [`../HANDOFF.md`](../HANDOFF.md) |
| 4   | **Judgement**              | Nothing, unless tiers 0–3 are silent       | the agent's own reasoning, which it states as such                                    |

### Tier 0 is the operator, and only the operator

The operator writes tier 0 by hand. An agent never writes tier 0, never edits it,
and never adds to it — not because the content would be wrong, but because an
override that an agent can write is not an override. See
[The override rule](#the-override-rule).

### Tier 1 is Adobe, for tools and features

For anything describing **what Photoshop does** — a tool's options bar, a
modifier, a default, a menu's contents, a panel's controls, a shortcut — Adobe's
own documentation is the source of truth. Not this repository's memory of it.

This matters most when the two disagree. When they disagree, **Adobe is correct
and this repository is wrong**, including when Adobe is describing a version of
Photoshop newer than the one anyone here has run. Re-derive from Adobe's page
rather than from a document in this repository, which may be a transcription of
that page from a year ago.

A claim about Photoshop with no Adobe citation is a rumour. Every tool section in
the generated [`TOOLS.md`](TOOLS.md) carries a `Sources:` block, and an empty one
fails the suite — that is the mechanism, not an accident.

### Tier 2 is authoritative for code

**When reviewing, refactoring, improving or otherwise working on this code, the
in-app documents are the source of truth** — not your recollection of Photoshop,
not the code's shape, not a similar product.

The code is the last word on what it _currently_ does. The documents are the word
on what it is _supposed_ to do. When they disagree, that is a finding: either a
defect or a stale document. Write it up ([`../HANDOFF.md`](../HANDOFF.md)) rather
than quietly reconciling it in whichever direction is cheaper.

A documented constraint beats a cleaner design. If `docs/` says the presentation
cache is published through a typed action, then a refactor that promotes a cache
outside reducer publication has not improved the code — it has broken a rule that
exists for a stated reason.

## The override rule

An **override** is a decision that Photoshop's behaviour is deliberately not
replicated here, and that some other behaviour is correct instead.

- The operator hand-writes every override, in [`OVERRIDES.md`](OVERRIDES.md).
- **An agent must not add, edit, reorder or delete an entry there.** Ever.
- **An agent must not ask for one to be added.** Record the request as a finding
  in [`../HANDOFF.md`](../HANDOFF.md), in the operator's words if you have them,
  and stop. Do not implement the behaviour in the meantime either: an unrecorded
  override in the code is the exact failure this rule exists to prevent.
- **An agent must not implement a Photoshop deviation that is not in
  `OVERRIDES.md`.** If the code and Adobe disagree and there is no entry, the code
  is the defect.

An agent that believes an override is warranted has found something real. The
finding goes in the handoff; the decision belongs to the operator.

## The single-home rule

**One fact, one home.** Every document in this repository has exactly one job, and
a fact that belongs to that job lives there and nowhere else.

The cost of breaking this is not file size. It is that two copies drift, and the
next reader cannot tell which one the author meant — and neither can the next
author, who edits the wrong one. Every cross-document restatement in this
repository today is a place where that has already happened.

So:

- **Link, do not restate.** If a panel spec needs a tool's status, it links to
  `TOOLS.md`. It does not repeat the status.
- **A duplicate is a defect.** Finding one is a finding. Say so in the handoff.
- **The index is not a home.** [`README.md`](README.md) names documents; it does
  not carry their content.
- **A generated file is not edited.** `TOOLS.md` is generated from
  `src/tools/descriptions/` by `npm run docs:tools`, and a test fails if it drifts.
  Edit the source or the generator.

Where a finding goes:

| The finding                                       | The home                                             |
| ------------------------------------------------- | ---------------------------------------------------- |
| A defect in this code                             | [`../HANDOFF.md`](../HANDOFF.md)                     |
| An intermittent test                              | [`../TEST-FLAKES.md`](../TEST-FLAKES.md)             |
| A defect in the e2e suite's own code              | [`../e2e/OPEN_PROBLEMS.md`](../e2e/OPEN_PROBLEMS.md) |
| A capability deliberately not built               | [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md)             |
| A requirement the Tools rail violates             | [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md)                 |
| A requirement the Layers panel has not met        | [`LAYERS-PANEL.md`](LAYERS-PANEL.md)                 |
| A rule about agents, worktrees or delegation      | [`../AGENTS.md`](../AGENTS.md), in short form        |
| A gate, a command, or what to read when one fails | [`TESTING.md`](TESTING.md)                           |
| Why an agent rule reads the way it does           | [`ORCHESTRATION.md`](ORCHESTRATION.md)               |
| What the app can and cannot do, system-wide       | [`FEATURES.md`](FEATURES.md)                         |
| What the code is and how it fits together         | [`ARCHITECTURE.md`](ARCHITECTURE.md)                 |

`HANDOFF.md` records defects. `TOOLS-TOO-HARD.md` records decisions. An entry
about a capability being too hard belongs in the second and not the first; an
entry about a capability being broken belongs in the first, and the second may
note that the fix is expensive.

## Platform limits

**When something cannot be done in a browser, say so in the docs — in
[`FEATURES.md`](FEATURES.md), against the capability, with the reason.**

Three distinct things get called "impossible in a browser", and only the first is
a platform limit:

1. **A platform limit.** No browser API does this without a decoder or an engine
   the project would have to ship itself — RAW decoding, pixel extraction from a
   PDF. Recorded with the reason, so nobody re-derives it.
2. **A decision.** Too expensive here. Recorded in
   [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md). It is not a limit, and calling it
   one is a way of not doing the work.
3. **An excuse.** Something entirely possible that nobody has built yet — zoom,
   layer groups, a Properties panel. Calling this impossible is false, and it
   survives review because nobody checks.

`FEATURES.md` marks the three differently. The third is the dangerous one, so the
marking exists to make it visible: a claim of impossibility that names no platform
mechanism is a backlog item wearing a disguise.

## Lifecycle

**Fixed and verified DELETES the entry.** The change that fixes an issue removes
it, in the same commit.

Never rewrite an open problem into a closed one — "issue X fixed in `abc123`" is a
new entry wearing the old one's name. A trail of fixed issues is pollution: prose
the next session reads instead of a problem it can act on, burying the problems
still open. The only residue a fix may leave is a tripwire in the test code.

A handoff document is maintained like source: **it ships with the code.** The edit
belongs in the same commit as the work that produced the finding. A stale entry is
not neutral — the next session spends a full investigation on a bug that is already
gone — and a missing entry loses the only record of a real one.

Point-in-time reports — an investigation of one tree on one date — are not
maintained, so they do not belong in this directory. Five sit at the repository
root and `docs/README.md` names them, with two more it holds here; when one can be
moved without breaking a lookup key, it goes. Moving them is a separate change,
because `scripts/lib/worktree-inventory/curated.mjs` keys on their paths.

## Citations

**A citation is a claim about the tree you are standing in.** Re-derive it from the
sentence that needs it. Never copy one forward from a document you just read, and
never regenerate it mechanically: a `file.ts:NNN` off by three is a review finding,
but an audit of the citations in this repository found 60 resolving to the wrong
code and 30 to a blank line, a comment, a closing brace or an import — uniformly,
in whole clusters, which is exactly what copying does.

Cite a file path, and a line only when you have just read the line.

**A description without a source is a rumour.** That covers Adobe claims and this
project's own claims equally. `docs/TOOLS.md` fails its test on an empty
`sources` array; prose does not, which is why prose needs the discipline.
