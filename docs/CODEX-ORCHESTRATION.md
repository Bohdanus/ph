# Codex subagents in this repository

This page records repository-specific Codex guidance. Codex already provides the
general delegation workflow, agent configuration, and safety boundaries; see the
[official subagent docs](https://learn.chatgpt.com/docs/agent-configuration/subagents)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
for those details. Kilo procedures are in [`ORCHESTRATION.md`](ORCHESTRATION.md)
and [`KILO.md`](KILO.md).

## Runtime differences that matter here

- Use the delegation mechanism exposed by the current host. Codex CLI `/subagents`,
  app/IDE activity controls, and this runtime's `spawn_agent` tools are not Kilo's
  `task`/`agent_manager` interfaces.
- Do not assume model/provider routing transfers between hosts. In particular,
  this runtime's `spawn_agent` accepts a model override but no provider field;
  OpenRouter or Kilo models are usable only if the host explicitly supports and
  routes them.
- Delegates in this collaboration runtime share the current filesystem; launch
  only after creating the task worktree. Give writers disjoint absolute paths.
  The root agent owns Git operations, commits, merges, and disposal, as required
  by [`AGENTS.md`](../AGENTS.md).

## Keep delegation cheap and useful

- Apply the free-first and budget checks in [`AGENTS.md`](../AGENTS.md) and
  [`MODELS.md`](../MODELS.md). Use free/low-cost agents for bounded research,
  text sweeps, code search, and routine read-only reviews; escalate only when
  uncertainty or risk warrants it.
- A child reduces root context only when its brief and result are concise. It
  still consumes its own model/tool calls, and inherited conversation history
  can add substantial input. Pass only necessary context, request evidence and
  uncertainty, cap output/retries, and summarize results before bringing them
  into the root thread.
- Parallelize independent questions, not dependent edits or work on shared
  mutable state. Prefer read-only research/review. For each writer, assign an
  exclusive file set; never treat prompt wording as a permission boundary.
- Root agent reconciles child claims against source files and required primary
  sources, performs validation, and owns the final review/landing process.

## Project-specific guardrails

Follow the Photoshop product, worktree, review, and test requirements in
[`AGENTS.md`](../AGENTS.md). For this repo, every delegate brief should name the
task worktree, allowed files, evidence expected, and concise output shape. Do not
duplicate these repository requirements in custom-agent prompts or broad guide
text; link to the source of truth instead.

For Codex configuration details, consult the official references above. Do not
copy generic TOML samples here: defaults, provider inheritance, available model
IDs, and per-surface controls can change, and must be checked against the active
Codex client and provider.
