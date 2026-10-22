# Codex subagent orchestration

**Checked: 2026-10-22.** Codex and Kilo Code both support delegation, but their
tools, configuration, model routing, and session records differ. Use this guide
for Codex app, CLI, IDE, and Codex collaboration-tool sessions. Use
[`ORCHESTRATION.md`](ORCHESTRATION.md), [`KILO.md`](KILO.md), and
[`MODELS.md`](../MODELS.md) for Kilo-specific procedures.

Official references: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
[OpenAI multi-agent guidance](https://developers.openai.com/api/docs/guides/responses-multi-agent),
[Codex CLI status and usage](https://developers.openai.com/codex/cli/slash-commands),
[Agents API tracing and usage](https://developers.openai.com/api/docs/guides/agents-api/observability).

## Pick the right delegation tool

| Runtime                     | Delegate with                                                                                                            | Do not assume                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Kilo Code                   | `task`; `agent_manager` for visible sessions/worktrees                                                                   | Codex `/subagents`, Codex agent TOML, or Codex provider inheritance     |
| Codex CLI                   | Ask Codex to delegate; inspect and switch threads with `/subagents`                                                      | Kilo `task`, `subagent_type`, Kilo session database, or `agent_manager` |
| Codex app or IDE            | Ask for subagents; inspect them in the available activity UI                                                             | CLI slash commands are available in these surfaces                      |
| Codex collaboration runtime | Use the exposed `spawn_agent`, `list_agents`, `send_message`, `followup_task`, `wait_agent`, and `interrupt_agent` tools | A child starts a new worktree or has a private filesystem               |

Use the tools the current host exposes. In particular, the repository's Kilo
instruction to pass both a model and provider applies to Kilo `task` calls; it
does not turn a Codex subagent launch into a Kilo call. In this collaboration
runtime, `spawn_agent` exposes a model override but no separate provider field;
check the live tool schema because other Codex surfaces and versions can differ.
If you need a Kilo model/provider pair, use Kilo's `task` interface rather than
assuming the Codex model setting routes to Kilo.

Current local Codex clients enable agents by default, but configuration can
disable them. If delegation tools are missing, check the surface and client
version, then inspect `[agents].enabled` in the applicable Codex configuration.
CLI subagent threads can be inspected with `/subagents`; app and IDE activity
controls vary by surface.

## Decide when to delegate

Delegate independent, bounded work when separate context or parallel progress is
likely to improve quality or time: source research, codebase exploration, log
triage, distinct test areas, or a fresh read-only review. Keep short tasks,
dependent sequences, and work on one mutable resource in the root agent.

Start with one or two children and the host's normal concurrency setting. More
agents can reduce wall time, but each makes its own model and tool calls and can
increase total cost. Do not launch agents simply to appear parallel. Read the
current `npm run swarm -- tokens --json` reading before **each** launch, as
required by [`AGENTS.md`](../AGENTS.md); stale, absent, or uncertain budget data
means prefer an eligible free model.

Give each child a fresh, narrow contract:

- Goal and the single question or deliverable.
- Absolute worktree path and allowed files; for readers, say read-only.
- Evidence to inspect and required citations or file/symbol references.
- Output shape and a short output limit; ask it to report uncertainty and blockers.
- Whether the root should wait for all results or can continue with independent work.

For broad or history-heavy chats, prefer a clean child context and pass only the
relevant requirements and evidence. In collaboration tools that expose
`fork_turns`, use `none` for a self-contained task and `all` only when decisions
from the conversation are necessary. A clean context limits inherited transcript
noise; it does not remove repository instructions or the child’s own work.

Example:

```text
In /absolute/path/to/the/task-worktree, read-only: inspect the selection history
code paths for stale-state risks. Do not edit or run Git commands. Return at most
five findings, each with file/symbol, reproduction or evidence, impact, and
confidence. Say "no findings" if you find none.
```

## Route models and control cost

Use an eligible free model first for high-signal text sweeps, documentation
research, code search, extraction, and simple reviews. Use a low-cost model with
low or medium reasoning for bounded routine work; reserve higher-cost models or
higher effort for ambiguous reasoning, difficult debugging, and final synthesis.
Use the current catalog and [`MODELS.md`](../MODELS.md), not remembered model
names or prices.

Codex local custom agents can set a model and reasoning effort in standalone TOML
files under `~/.codex/agents/` or `.codex/agents/`. `[agents]` in `config.toml`
can set session defaults and a concurrency cap. Explicit spawn settings take
precedence over these defaults. Custom agents inherit the root's provider,
permissions, and MCP servers; a custom agent file cannot select another provider
or raise the parent's permissions. Check that the desired free provider is
actually configured and selectable before relying on a free model. Do not assume
Kilo's free catalog is available through Codex routing.

Example project defaults (replace the model ID with one verified for the
configured provider):

```toml
# .codex/config.toml
[agents]
max_concurrent_threads_per_session = 2
default_subagent_model = "<verified-model-id>"
default_subagent_reasoning_effort = "low"
```

An individual agent can narrow its instructions and use a different model or
reasoning effort in `.codex/agents/<name>.toml`:

```toml
name = "text_sweeper"
description = "Read-only extraction and classification of bounded text sets."
model = "<verified-model-id>"
model_reasoning_effort = "low"
developer_instructions = """
Read only. Process only the assigned files. Return concise structured findings,
source paths, and uncertainty. Do not edit files or run Git commands.
"""
```

These are Codex examples, not Kilo's `.kilo/agents/*.md` format. Remove the
agent-specific `model` line if it should inherit the session default.

More context is not automatically better. Give a child only the files and
requirements needed for its task, keep outputs concise, cap retries, and send
summaries rather than raw search dumps or test logs to the root. This reduces
root-context pollution; it does not make child model/tool usage free. Use the
host's per-agent usage view when available. In Codex CLI, `/status` reports the
current session's token usage and context; it does not provide an API trace for
each child. For Agents API sessions, inspect per-agent traces and usage. Treat
missing API usage as unknown, not zero; recorded usage may change and is not a
final bill. Reasoning tokens count as output usage. For Kilo quota/accounting,
use the Kilo-specific instructions rather than Codex session assumptions.

## Filesystem, permissions, and ownership

In this repository's Codex collaboration runtime, subagents share the current
filesystem; spawning one does not create an isolated Git checkout. In other
Codex surfaces, verify the configured environment rather than assuming
delegation itself gives a private worktree. Create and verify the task worktree
before delegation. Give every writer an exclusive path set, use absolute paths
in briefs, and keep root-agent ownership of branch creation, staging, commits,
merges, resets, and worktree disposal. Prefer read-only children for research
and review. Never treat "do not edit" in a prompt as a security boundary:
children inherit the parent sandbox and approval settings. Set the parent's
permissions before launching agents.

Do not have two children edit the same file. If independent implementation is
worth parallelizing, split by disjoint files, name the owner of each path, and
have the root integrate and validate the result. A reviewer receives the diff
and contract, makes no changes, and returns actionable findings; the root
verifies those findings and fixes the code.

For reviews, ask for concrete failure modes and evidence rather than general
opinions. For example: “Review only the changed files for correctness and
security. Return each finding with file, symbol, triggering condition, impact,
and confidence; return `no findings` if none. Do not edit.”

## Coordinate and close the run

Use the host's status/list tool to see which agents are active, then wait for the
needed results. Send a follow-up with the missing requirement instead of
restarting a child whose context is useful. Interrupt work that is no longer
needed; inspect its state before reassigning its files. A completed spawn or wait
tool call is not proof that the child finished—check its status and collect its
final result.

Before finishing, reconcile every child result with the task contract, check the
claimed files and model/provider where available, and run the required gates from
the root worktree. Keep evidence, errors, and unverified claims visible in the
handoff. A subagent's conclusion is input to the root's decision, not a substitute
for verification.
