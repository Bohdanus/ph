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

## Token-intensive research

- Bulk web research and chat-history mining MUST use a verified free read-only
  delegate when the active host can explicitly route one. Give it a bounded query,
  an exclusive summary-file path, and a short evidence-backed output limit. Do not
  return raw pages or transcripts to the root conversation; child output still
  consumes root context.
- Do not assume Codex subagents can use Kilo's free models. Verify the active host's
  resolved model/provider. If the host cannot guarantee a free route, stop rather
  than silently doing bulk research in the paid root context or delegating it to a
  paid subagent.
- For public URL lists when the host has no free web-research delegate, run
  `node scripts/free-research.mjs` from a task worktree. It bounds the fetch and
  prompt sizes and writes a condensed result to a file. The runner uses only verified
  zero-priced Kilo/OpenRouter routes and never falls back to paid inference. See
  `MODELS.md` for the current model-routing policy.
- Chat searches are not handled by the URL runner. Use a free read-only delegate
  that can access the relevant chat-history store, ask it to return only matched
  session IDs and a concise evidence file, then read that file in the root. Never
  send private transcripts to an unverified provider.
- For local history procedures, use the [Skills index](README.md#skills) and open the platform-specific `.skills/kilo-chat-history.md` or `.skills/codex-chat-history.md`; do not assume Codex has Kilo search tools.
- If no safe free path exists, request explicit authorization before switching to
  paid research; do not treat the user's request for rigor as paid-routing approval.

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
