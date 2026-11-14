# Code review subagent

This file documents Kilo's `task` launcher, loaded `code-reviewer` mode, Kilo
permission profile, and the tool-free free-completion review option. Codex subagent
tools and permission inheritance differ; use
[`CODEX-ORCHESTRATION.md`](CODEX-ORCHESTRATION.md) for Codex launch and context
practices. The review contract below—independent, read-only findings that the root
agent verifies—applies in either runtime.

**THE REVIEW IS INDEPENDENT, NOT A FEELING.** [`docs/README.md`](README.md) indexes
this file and [`docs/KILO.md`](KILO.md) describes the Kilo permission profile. `AGENTS.md`
requires a fresh read-only review for non-trivial changes; this file defines the prompt
and review procedure. Use a verified read-only child when available. If the host cannot
enforce that boundary for a free child, use the tool-free free-completion runner and give it
the full bounded candidate context. Put the prompt in the brief verbatim; do not reconstruct
it from memory.

## The prompt

For the Kilo `code-reviewer` agent. It is a **chat mode** (`mode: primary`), not a
`subagent_type`, so it is launched with `task` and `subagent_type: general`:

```
You are a senior software engineer conducting thorough code reviews. You focus on
code quality, security, performance, and maintainability.

Provide constructive feedback on code patterns, potential bugs, security issues, and
improvement opportunities. Be specific and actionable in suggestions.
```

The local `code-reviewer` profile is configured separately with `read: allow`,
`bash: allow`, **`edit: deny`**, and the mutating Serena tools
named one by one (`serena_replace_symbol_body: deny` and its siblings). `mcp: deny`
was removed because it matched nothing. This Bash-enabled local profile must not be
used for a free Kilo child review: under [`AGENTS.md`](../AGENTS.md), free children
must deny Bash and all file-mutation tools. Use the project's read-only `explore` or
`read-only-research` profile, or the tool-free free-completion runner when the host
cannot enforce those permissions. The reviewer reports; it does not fix. A reviewer
that edits is no longer a review.

## Why the copy lives here

`.kilo/agents/code-reviewer.md` is where Kilo loads the mode from, and `.kilo/` is
gitignored — a rule that pointed only at that path would be dead on every other
clone. The tracked copy is this file; `.kilo/agents/code-reviewer.md` points back
here. Same shape as the skills: `.kilo/skills/` is the loader, `.skills/` is the
durable text.

## Launching it

- **After non-trivial work, before the merge.** A finding costs one edit before the
  merge and a revert after it. "Non-trivial" is anything that changes behaviour,
  removes code, or touches a boundary named in `AGENTS.md`; it is not a one-line
  typo fix and not a doc edit. Not "self-reviewed", not "I re-read it twice", and
  not "the gates are green".
- **Brief it like a fresh context.** Include the absolute task-worktree path, branch,
  files in play, exact base SHA, candidate SHA/tree when committed, and required response
  format. Use immutable SHAs for any committed range, never a mutable branch name. Free
  children cannot run Git: the coordinator supplies the exact candidate diff and relevant
  source context. For a tool-free completion review, include the full bounded diff in the
  prompt or provide it through the runner's input file; do not rely on the reviewer opening
  the checkout.
- **Review the exact candidate that will land.** Record the base SHA, reviewed
  candidate SHA/tree when committed, and whether the worktree has staged or unstaged changes.
  A committed range does not include uncommitted changes. Before reviewing a dirty candidate,
  the coordinator supplies and inspects both the unstaged and staged diffs; do not treat an
  omitted working-tree diff as reviewed.
  If `main` changes or the branch is rebased after review, review the final
  synchronized diff again before landing.
- **A commit's ancestry does not prove its behavior survived.** For salvage,
  cherry-pick, or merge-resolution work, verify the relevant implementation and
  its callers in the current candidate tree. A commit can be an ancestor while
  a later commit or resolution has reverted its behavior.
- **Give each finding a stable location and the concrete failure it causes.** Use a
  file path plus a symbol, test title, heading, property, selector, or short unique
  matched phrase. Do not cite source line numbers; see [`AGENTS.md`](../AGENTS.md).
  "Consider extracting this helper" is not a finding.
- **Fan out only for independent coverage.** Keep one reviewer on a cohesive,
  bounded diff; do not split it by labels or subsystems just to add reviewers.
  When multiple reviewers are required under [`ORCHESTRATION.md`](ORCHESTRATION.md),
  assign disjoint file groups or distinct load-bearing claims. Two reviewers
  given the same scope produce overlapping opinions, not broader coverage.
- **Read-only.** Free Kilo children must have Bash, edit, write, patch, and all
  file-mutating tools denied. Never pass a write-enabled profile to a free reviewer;
  if the host cannot enforce the boundary, use the tool-free completion runner. A
  reviewer launched with write access may fix what it finds and silently skip the
  parts it dislikes.
- **Re-run the load-bearing claims yourself.** A review you did not verify is a
  review you did not perform; the reviewer is another agent, not an authority.
- **A finding sends the task back.** Fix it and re-review. Do not merge over an open
  blocking finding, and do not mark the change done on the strength of "reviewed,
  nothing found" without the findings being on the record.

## What it does not replace

The reviewer reads code; it does not run the gates. `tsc`, `test`, `lint`, and `e2e`
are [`docs/TESTING.md`](TESTING.md), and a green gate is the floor, not the review.
