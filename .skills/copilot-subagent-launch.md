---
name: copilot-subagent-launch
description: Short guide to safe, reliable subagent delegation in VS Code.
---

# Copilot Subagents

## Choose the harness

- VS Code Copilot uses its native `task` delegation; Local uses `agent/runSubagent`.
- Controls, agent formats, and model routing differ. Follow the active host's current UI and docs; a model name does not prove provider or free access.

## Reliability warning

Two Copilot session histories from Nov 1–4, 2026 recorded 39 delegated launches; all failed before returning results. OpenRouter free routes returned `502 User not found`; NVIDIA Nemotron and `gpt-5.6-luna` returned `400 model not supported`. Two additional smoke-test sessions recorded no execution. This is point-in-time evidence, not proof every current route fails.

Do not rely on Copilot delegation for free-model research unless a fresh probe succeeds. Use a currently verified free route from [`MODELS.md`](../MODELS.md); if none is available, stop rather than silently using paid inference.

## Safe delegation

- Create and verify a task worktree first. Give the agent its absolute path, a self-contained goal, allowed actions, explicit write set, and expected result.
- Free research must be read-only through tool permissions, not prompt wording. Deny edit, shell/execute, and file-mutation tools; if the host cannot enforce this, do not launch it.
- The coordinator owns Git operations. Verify the returned work and that it is complete before relying on it.

## References

- [VS Code subagents](https://code.visualstudio.com/docs/agents/run/subagents)
- [VS Code custom-agent files](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference)
- [Copilot subagents](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/use-copilot-agents/use-subagents)
- [`MODELS.md`](../MODELS.md) and [`AGENTS.md`](../AGENTS.md)
