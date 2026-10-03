# Documents

The map. Every tracked document in this repository, the one job it has, and which
document wins when two of them disagree.

The rule is [`DOCUMENTATION.md`](DOCUMENTATION.md). This page is the index.

## Read this first

|                                        |                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`DOCUMENTATION.md`](DOCUMENTATION.md) | The precedence ladder, the override rule, the single-home rule, platform limits, lifecycle |
| [`OVERRIDES.md`](OVERRIDES.md)         | Operator-only register of decisions to depart from Photoshop. **Agents never write here**  |
| [`FEATURES.md`](FEATURES.md)           | What the app can and cannot do, system-wide, against Photoshop                             |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)   | What the code is and how it fits together                                                  |
| [`../AGENTS.md`](../AGENTS.md)         | The rules an agent reads first: delegation, worktrees, gates, no browser windows           |
| [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md)   | The product requirement for the Tools rail, and its open violations                        |

The ladder is **operator → Adobe → this repository → judgement**, and the rule belongs to
[`DOCUMENTATION.md`](DOCUMENTATION.md). `AGENTS.md` carries the short form for agents; this page
deliberately carries none of it.

## Contract

| Document                                   | Its one job                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md)       | The Tools rail is a clone of Photoshop's Tools panel — the requirement, and the open violations of it            |
| [`TOOLS.md`](TOOLS.md)                     | The per-tool specification. **Generated** — do not edit; run `npm run docs:tools`                                |
| [`TOOLS-INVENTORY.md`](TOOLS-INVENTORY.md) | The Adobe Tools-panel tools the rail does **not** have — the complement of `TOOLS.md`, keyed to Adobe's identity |
| [`LAYERS-PANEL.md`](LAYERS-PANEL.md)       | The Layers panel's requirements and status                                                                       |
| [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md)   | Capabilities deliberately not built, so nobody re-audits them                                                    |

The eight per-family research notes live outside this directory, one per tool family:
`src/tools/descriptions/selection.notes.md`, `src/tools/descriptions/paint.notes.md`,
`src/tools/descriptions/focus.notes.md`, `src/tools/descriptions/shape.notes.md`,
`src/tools/descriptions/pen.notes.md`, `src/tools/descriptions/type-crop.notes.md`,
`src/tools/descriptions/transform.notes.md` and `src/tools/descriptions/eyedropper-draw.notes.md`.
They carry the per-family research notes and the claims `TOOLS.md` deliberately could not source.

And one requirements document outside this directory:
`src/components/ToolbarsRight/Text/TEXT_TOOL_REQUIREMENTS.md`, the Type tool's requirements, in the
same shape as [`LAYERS-PANEL.md`](LAYERS-PANEL.md).

## System

| Document                             | Its one job                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| [`FEATURES.md`](FEATURES.md)         | Capability inventory against Photoshop, including what the platform cannot do |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The store, the layer model, both history systems, rendering, file I/O         |

## Working practice

| Document                                               | Its one job                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`../AGENTS.md`](../AGENTS.md)                         | Rules every agent reads first                                           |
| [`ORCHESTRATION.md`](ORCHESTRATION.md)                 | Worktrees, delegation, the swarm board, dead-agent recovery             |
| [`KILO.md`](KILO.md)                                   | The agent-facing Kilo config, including the parts no tracked file holds |
| [`CODE-REVIEW.md`](CODE-REVIEW.md)                     | The verbatim prompt and rules for the mandatory review subagent         |
| [`TOOLS-RESEARCH-BRIEF.md`](TOOLS-RESEARCH-BRIEF.md)   | The protocol a per-tool-family research agent works under               |
| [`TESTING.md`](TESTING.md)                             | Every gate, what it proves, and what to read when it fails              |
| [`../DEPENDENCIES.md`](../DEPENDENCIES.md)             | The dependency licence policy, and the fact that nothing enforces it    |
| [`../README.md`](../README.md)                         | Install, run, test, and the CI jobs — for a new clone                   |
| [`../e2e/README.md`](../e2e/README.md)                 | The Playwright suite: helpers, conventions, and how to add a spec       |
| [`../e2e/MIGRATION-TODO.md`](../e2e/MIGRATION-TODO.md) | What the history migration left undone, in the e2e suite's own words    |

The agent procedures live outside this directory, under `.skills/`:
`.skills/hard-merge.md`, `.skills/photoshop-tool-creation.md`, `.skills/stale-worktree-reclaim.md`,
`.skills/worktree-merge-harvest.md` and `.skills/broad-test-improvement.md`. `AGENTS.md` states the
rules; a skill states the procedure for one of them. `e2e/fixtures/README.md` is the Playwright
fixture conventions note.

## Open problems

Three homes, split by what broke. A defect goes in one of them, not in two.

| Document                                             | Its one job                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| [`../HANDOFF.md`](../HANDOFF.md)                     | Open defects in the code                                                   |
| [`../TEST-FLAKES.md`](../TEST-FLAKES.md)             | Intermittent and unreliable test behaviour                                 |
| [`../e2e/OPEN_PROBLEMS.md`](../e2e/OPEN_PROBLEMS.md) | Latent defects in the e2e suite's own code — none fails a current run      |
| [`handoffs/`](handoffs/)                             | One per branch review-and-merge, named `docs/handoffs/<branch>-<topic>.md` |

## Not maintained here

Five root-level files are point-in-time reports: an investigation of one tree on
one date, or a disposition record for documents that were stashed and recovered.
Two more recovered from that same stash sit in this directory. They are **not
current**, nothing in the live set depends on them, and they are not part of this
hierarchy.

| File                                | What it is                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `../AUDIT-STASHED-DOCS.md`          | Disposition record for three recovered stashed documents. Its two `docs/*.md` subjects are itself obsolete |
| `../FOCUSED-REVIEW-2026-09-28.md`   | A dated four-subsystem review, recorded rather than fixed                                                  |
| `../MIGRATION_NEXT_STEPS_SUNDAY.md` | The history-migration map, audited at `main` @ `f7757cf`                                                   |
| `../TEST_ISSUES.md`                 | Superseded by `AUDIT-STASHED-DOCS.md`; its own banner says do not add to it                                |
| `../CANVAS-RESOLUTION-PLAN.md`      | A retina-resolution investigation and plan, scoped to `fix/canvas-contain-scale`                           |
| `save-settings-inconsistency.md`    | Recovered from the same stash, and wholly obsolete — its own banner says so                                |
| `next-target-useLayer.md`           | Recovered from the same stash, and superseded as a plan — its own banner says do not work from it          |

They are still where they are because `scripts/lib/worktree-inventory/curated.mjs`
keys on four of the root paths as `ref:` values, and the two `docs/*.md` rows
cross-reference each other and `../AUDIT-STASHED-DOCS.md` by name. Moving them is
a change to that data file plus a sweep of every tracked markdown file that names
them, which is why it belongs in its own worktree rather than inside a
documentation change. See `HANDOFF.md` §139.

Do not hand-maintain a count of how many files mention them here. That number was
in this sentence once, was wrong within a day, and `git grep` is the answer when
you need it.

A document earns a place in this directory by describing the system as it is. An
investigation describes the system as it was on one day, which stops being true
the moment it lands.

## Two paths are frozen

Moving these breaks a test, not just a link:

- **`docs/TOOLS.md`** — the `OUTPUT` constant in
  `scripts/generate-tool-docs.mjs`, and the
  `it('writes docs/TOOLS.md exactly as the generator produces it')` case in
  `scripts/__tests__/tool-descriptions.test.mjs` asserts the file is byte-equal
  to the generator's output.
- **`HANDOFF.md`**, **`TEST-FLAKES.md`**, **`e2e/OPEN_PROBLEMS.md`** — the three
  keys of `SCOPE_BY_FILE` in `scripts/lib/agent-board/handoff-import.mjs`, which
  routes work onto the swarm board by document. They are the registry, not a
  convention.

`AGENTS.md` stays at the repository root for the same reason: it is read from disk
by `scripts/__tests__/agents-citations.test.mjs`.

## Where a new fact goes

Do not add a second home for it. If none of the documents above owns it, it is a
new document's job to — and that document goes in this directory, gets a row in
this table, and states its one job in its first paragraph.

Otherwise it is a line in an existing document, and [`DOCUMENTATION.md`](DOCUMENTATION.md)'s
routing table says which one.
