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
| What a capability is called — `partial`, `absent` | [`FEATURES.md`](FEATURES.md), scoped as below        |
| A document's own status markers                   | It defines them, and only it uses them               |

`HANDOFF.md` records defects. `TOOLS-TOO-HARD.md` records decisions. An entry
about a capability being too hard belongs in the second and not the first; an
entry about a capability being broken belongs in the first, and the second may
note that the fix is expensive.

## Status vocabulary

Three documents mark things, and they were written independently, so their markers do not match.

| Document                             | Its markers                                                              |
| ------------------------------------ | ------------------------------------------------------------------------ |
| [`FEATURES.md`](FEATURES.md)         | `have` · `partial` · `divergent` · `absent` · `platform` · `decision`    |
| [`LAYERS-PANEL.md`](LAYERS-PANEL.md) | `HAVE` · `PARTIAL` · `GAP` · `OUT` · `SCOPE` · `UNVERIFIED`              |
| [`TOOLS.md`](TOOLS.md)               | `present` · `partial` · `inert` · `missing` — per **control**, generated |

`partial` and `PARTIAL` mean the same thing and differ only in case. The rest are not aliases:
`GAP` is `absent`, `OUT` is `decision`, `SCOPE` is a routing marker, `UNVERIFIED` is an unknown, and
`platform` is a claim this repository can justify against the platform.

**`TOOLS.md` uses two vocabularies, and they answer different questions.** Its per-control statuses
are `ToolControlStatus` in `src/tools/descriptions/types.ts` — `present`, `partial`, `inert`,
`missing` — and `scripts/generate-tool-docs.mjs` prints exactly those four into the "In this app"
column. Its per-tool verdicts are `ToolImplementationStatus`, also in that file — `implemented`,
`partial`, `placeholder` — and `placeholder` is an **implementation** status, never a control status:
a tool is `placeholder` when it is selectable and commits nothing (`commit: 'unimplemented'`, an
`imageProcessor` returning `null`). A control has no such value, because a control that renders
nothing behind itself is `inert` or `missing`, and a control that renders and works is `present`.
Confusing the two is what produces "the app already has it" claims that a screenshot contradicts:
the type comment at `src/tools/descriptions/types.ts` records that confusion being made, and records
why each value exists.

**Each set is scoped to the document that owns the capability, and that document is the only one
that may use its markers.** Where two documents both mark the same capability, the one whose scope
owns it wins and the other links rather than re-marking it. A marker from another document's set is
not a second opinion — it is a different question.

`FEATURES.md`'s set is the system-wide one, and it is the set to use in a new document, because
`FEATURES.md` is the document that measures against Photoshop rather than against a panel.

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
maintained, so they do not belong in this directory. Some sit at the repository
root and `docs/README.md` names them, with more it holds here; when one can be
moved without breaking a lookup key, it goes. Moving them is a separate change,
because `scripts/lib/worktree-inventory/curated.mjs` keys on their paths.

## Citations

**A citation is a claim about the tree you are standing in.** Re-derive it from the
sentence that needs it. Never copy one forward from a document you just read.

**Cite the unit, never the line.** A line number is a position in a file that
everything above it moves. An audit of `HANDOFF.md` found 36% of its hand-checked
`file.ts:NNN` citations pointing at the wrong code — mostly off by one or two, some
by 146 — and a 42-minute session once burned chasing nothing but that drift, one
reviewer finding a stale citation per round. So the format is banned in tracked
documents, and what replaces it is a name that can be re-derived onto the code:

| Instead of                                                  | Write                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `` `history-adapter.ts:‹line›` ``                           | `` `history-adapter.ts` — `durableLayerForSource()` `` |
| `` `materialization.ts:‹lines›` ``                          | `` `materialization.ts` — `materializeDocument()` ``   |
| `` `durable-compositor.refusal.test.ts:‹line›` ``           | the `it('...')` title, in backticks                    |
| `` `PUBLISH_RUNTIME_PRESENTATION` at `reducer.ts:‹line›` `` | `` `PUBLISH_RUNTIME_PRESENTATION` ``                   |

The left column is written with a `‹line›` placeholder rather than a real number, so
this document obeys the rule it states and the check below reads it.

**The order of preference**, first that resolves:

1. A **declared identifier**, called in the call form: `` `materializeDocument()` ``.
2. A **string literal the program dispatches on** — an action type, a source kind,
   a commit kind. `'legacy-tool'` is a real anchor; it is a value, not a place.
3. A **`it('...')` title** for a test, which is stable while the file's line count
   is not.
4. The **file alone**, when the claim is about the file as a whole.

A range names **one** enclosing unit, not two endpoints. A claim too vague to name a
unit has not been located yet, and citing a line number is how that was hidden.

**Why a name and not a number.** A number cannot be checked: a test that fails on a
number having moved trains people to regenerate citations instead of re-deriving
them, which is what produced the clusters. A name can be checked, and this
repository checks it — `scripts/__tests__/agents-citations.test.mjs` reads every
tracked markdown document and fails on a backticked call the program does not
contain, a retired symbol named in any of them, a `§N` that is not a live
`HANDOFF.md` heading, and a `file.ext:‹line›` citation anywhere outside a fence.

**The one exemption is quotation.** A finding whose SUBJECT is a drifted line-number
citation cannot be stated without one — "`history-replay.ts` cites 47 lines past its
first `switch` arm and all 47 are off by twenty" is the number. Put those in a
fenced code block, quoting the drifted form verbatim.

The check strips fences before it looks, so a fence is a claim about the FORM
rather than a claim about the code. That is the difference from an exemption list,
which is unfalsifiable and reads as checked. A fence is visible, a fence is
quotation, and the prose on either side of it is still checked — so the fence buys
nothing to smuggle a real citation with. Note that a fence cannot be nested inside
another fence to show the shape, which is why this paragraph describes it instead of
printing one: the outer fence is stripped first and the inner one is then read as
an opening delimiter, so an example of the exemption written as an example is the
one thing that trips the rule it is illustrating.

**Everything else is migrated.** There is no per-occurrence exemption and no
threshold, because an exemption is a number that gets refreshed and then outlives
its reason. `scripts/resolve-citations.mjs` is the migration's worklist: it reads
each cited file's AST and proposes the enclosing declaration, `it('...')` title or
`switch` case for each position, and reports the positions it cannot resolve —
those are the sentences where the author never had a unit in mind, which is the
finding the ban was written to surface.

**A description without a source is a rumour.** That covers Adobe claims and this
project's own claims equally. `docs/TOOLS.md` fails its test on an empty
`sources` array; prose does not, which is why prose needs the discipline.
