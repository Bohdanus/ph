---
name: copilot-subagent-launch
description: Practical cookbook for launching read-only and task-scoped subagents in GitHub Copilot Chat for VS Code.
---

# Launching Subagents in GitHub Copilot (VS Code)

Use this guide for VS Code agent sessions. Copilot and Local harnesses have different delegation
and tool behavior, so check which harness is selected before configuring or invoking a subagent.
This guide supplements `AGENTS.md`, `MODELS.md`, and the repository's worktree rules.

## Repository rules

Before launching any agent:

1. Create and verify the task worktree.
2. Give the agent its absolute worktree path and an explicit write set; read-only agents have an empty write set.
3. Keep Git operations, commits, merges, pushes, and branch changes with the coordinator.
4. Keep free-model research read-only. Use tool-level read-only permissions; prompt instructions
   alone do not enforce a write boundary.

A free model name does not prove a request is free. For Kilo routes, follow `MODELS.md` and check
`node scripts/free-model-pool.mjs --list` before launching work.

## Choose the harness

| Harness        | Delegation and tools                                                                                                        | Model selection                                                                                                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Copilot | Current VS Code Copilot harness uses native `task` delegation. Follow its current Copilot controls and custom-agent schema. | GitHub's Copilot IDE subagent guide says delegated subagents use the main session's model and tools. VS Code's custom-agent schema has a `model` field, but its documentation does not establish whether that field overrides a delegated subagent's model. Verify in the active runtime; do not promise a provider-specific route. |
| Local          | Select Local and Agent, then enable **Run Subagent** (`agent/runSubagent`) under **Configure Tools**.                       | Model selection is: explicit `runSubagent` model parameter, then the selected custom agent's `model` field, then Auto when `chat.subagents.defaultToAuto` applies, then the parent model. This selection does not prove that the route is free.                                                                                     |

The selected harness determines which tool names and frontmatter fields apply. Do not copy Local's
`agent/runSubagent` tool name into Copilot-specific instructions. VS Code settings and controls can
change; use the linked current documentation rather than old settings JSON examples.

## Define a read-only Copilot agent

Workspace agents live in `.github/agents/`. This example uses current Copilot aliases and fields:

```markdown
---
name: codebase-researcher
description: Find code and explain existing behavior without editing files
target: github-copilot
tools: ['read', 'search']
user-invocable: true
disable-model-invocation: false
---

Research the assigned question without changing files. Return concise findings using file paths,
symbols, test names, or headings. Do not include line numbers.
```

For Copilot custom agents, use supported tool aliases such as `read`, `search`, `edit`, and
`execute`. Tool names differ by harness. `infer` is deprecated in current VS Code custom-agent
files: `user-invocable` controls picker visibility and `disable-model-invocation` controls whether
other agents may invoke the agent.

## Assign a bounded task

Give each agent a self-contained task because the harness may not provide the parent chat history.
State the goal, relevant files, allowed actions, write set, and expected result. Example:

```text
Use the codebase-researcher agent to inspect the text-tool selection flow in
/absolute/path/to/task-worktree. Read files only. Report the relevant file paths, symbols, test
names, any behavior mismatch, and confidence. Do not edit files, run commands, or use Git.
```

For independent reviews, assign separate concerns such as correctness, test coverage, and security.
The coordinator deduplicates and verifies findings before changing code.

## Write-capable test agent

Use a write-capable agent only for an explicitly assigned test-file write set in the verified task
worktree and when the current route and project policy permit writes. Never use a write-capable
profile for free-model work; free children must remain read-only under `AGENTS.md` and `MODELS.md`.
Never launch the write-capable profile from the main checkout.

```markdown
---
name: test-hardener
description: Fix assigned tests without editing application source
target: github-copilot
tools: ['read', 'search', 'edit', 'execute']
user-invocable: true
disable-model-invocation: false
---

Work only in the absolute task-worktree path supplied in the prompt. Edit only the assigned test
files. Do not change source files, commit, merge, push, or change branches. The coordinator owns Git
operations. Run only the focused tests assigned for this task; the coordinator remains responsible
for the applicable `docs/TESTING.md` commit and push gates before landing.
```

Provide the exact test paths and task-worktree path in the invocation. Follow `docs/TESTING.md` and
`AGENTS.md` for the required runner; broad browser E2E uses the mirror workflow.

## Documentation audit agent

A documentation-only agent should have read and search tools, no edit or execute tools, and a
bounded file list. Ask it to compare statements with implementation and primary sources. Request
findings by file, heading, symbol, or test name, with evidence and confidence. Do not request or
report line numbers.

## Troubleshooting

| Symptom                       | Check                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagent is not invoked       | Confirm the selected harness, available delegation tool, agent name, and current invocation settings. In VS Code custom agents, check `user-invocable` and `disable-model-invocation`; `infer` is deprecated. |
| Model is unavailable          | Verify the exact model identifier in the selected harness and current catalog. Do not infer that a model picker selects a Kilo/OpenRouter route or proves zero cost.                                          |
| Free route is required        | Use the repository free-model catalog and exact model/provider pair. Do not assume Copilot's model picker selects Kilo or OpenRouter, or that a model name proves zero cost.                                  |
| Result is empty or incomplete | Make the task self-contained, bound the requested output, and verify that the completion is non-empty and complete before relying on it.                                                                      |

## References

- [Use subagents in Visual Studio Code](https://code.visualstudio.com/docs/agents/run/subagents)
- [Custom agent file reference](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference)
- [Using subagents in GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/use-copilot-agents/use-subagents)
