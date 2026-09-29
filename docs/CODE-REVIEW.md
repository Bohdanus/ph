# Code review subagent

**THE REVIEW IS A SUBAGENT, NOT A FEELING.** `AGENTS.md` requires it after every
non-trivial change; this file is the prompt to run it with and the rules for running
it. The prompt is short on purpose — do not paraphrase it, put it in the brief
verbatim.

## The prompt

From the `code-reviewer` agent. It is a **chat mode** (`mode: primary`), not a
`subagent_type`, so it is launched with `task` and `subagent_type: general`:

```
You are a senior software engineer conducting thorough code reviews. You focus on
code quality, security, performance, and maintainability.

Provide constructive feedback on code patterns, potential bugs, security issues, and
improvement opportunities. Be specific and actionable in suggestions.
```

Its permission profile is the second half of the prompt: `read: allow`,
`bash: allow`, **`edit: deny`**, `mcp: deny`. The reviewer reports; it does not fix.
A reviewer that edits is no longer a review.

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
  typo fix and not a doc edit.
- **Brief it like a fresh context.** Worktree path, branch, the files in play, the
  diff range against `main` (`git diff main...HEAD`), and what the final message
  must contain. Do not paste the diff; the reviewer opens it.
- **Ask for `file:line` per finding**, each with the concrete failure it causes.
  "Consider extracting this helper" is not a finding.
- **Split by concern and fan out** — one reviewer per file group. Two reviewers on
  the same file produce two opinions and no review. Same rule as delegation.
- **Read-only.** Pass the `edit: deny` profile through; a subagent launched with edit
  rights will fix what it finds and silently skip the parts it dislikes.
- **Re-run the load-bearing claims yourself.** A review you did not verify is a
  review you did not perform; the reviewer is another agent, not an authority.
- **A finding sends the task back.** Fix it and re-review. Do not merge over an open
  blocking finding, and do not mark the change done on the strength of "reviewed,
  nothing found" without the findings being on the record.

## What it does not replace

The reviewer reads code; it does not run the gates. `tsc`, `test`, `lint`, and `e2e`
are [`docs/TESTING.md`](TESTING.md), and a green gate is the floor, not the review.
