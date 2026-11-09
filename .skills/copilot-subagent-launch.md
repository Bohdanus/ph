---
name: copilot-subagent-launch
description: Practical cookbook for launching read-only and task-scoped subagents in GitHub Copilot Chat for VS Code, including setup, constraints, and troubleshooting.
---

# Launching Subagents in GitHub Copilot (VS Code)

A practical cookbook for successfully delegating tasks to Copilot subagents in VS Code, based on real failures and official documentation.

---

## The Core Problem You Hit

**Subagents cannot use different models.** They always inherit the main session's model. Your attempts to launch "Kilo Nemotron" or "OpenRouter Nemotron" subagents failed with:

- `502 User not found` (OpenRouter model)
- `400 The requested model is not supported` (Kilo model)

This is **by design** — subagents share the parent's model and tool configuration.

---

## Prerequisites

1. **VS Code** with GitHub Copilot Chat extension (latest)
2. **Agent mode** selected in Copilot Chat (not Ask/Edit)
3. **Custom agents** defined as `.agent.md` files (required for explicit invocation)

---

## Quick Start: Enable Subagents

### Via UI (one-time)

1. Open Copilot Chat → click **Tools** icon (wrench)
2. Enable **Run Subagent** (`agent/runSubagent`)
3. Select **Agent** mode from dropdown (bottom of chat)

### Via Settings (persistent)

```json
// settings.json
{
  "github.copilot.chat.agent.enableSubagents": true,
  "chat.agent.enabledTools": ["agent/runSubagent", "..."]
}
```

---

## Defining Custom Agents (Required for Explicit Invocation)

Create `.agent.md` files in **one of these locations**:

- **Project**: `.github/agents/` (shared with team)
- **User**: `~/.copilot/agents/` (personal)

### Minimal Agent Template

```markdown
---
name: researcher
displayName: Research Agent
description: Explores codebases and answers questions using read-only tools
tools: ['grep', 'glob', 'view', 'read']
infer: true
---

You are a research assistant. Analyze code and answer questions. Do not modify any files.
Return concise findings with file paths and line numbers.
```

### Agent with Model Override (Advanced)

```markdown
---
name: coder
displayName: Editor Agent
description: Makes targeted code changes
tools: ['view', 'edit', 'bash', 'grep']
model: gpt-5.4
infer: true
---

You are a code editor. Make minimal, surgical changes to files as requested.
```

> **Note**: The `model` field only works for the **main session**, not subagents. Subagents always use the parent's model.

---

## Invoking Subagents

### Method 1: Automatic Delegation (Inference)

Just ask naturally — Copilot picks the best agent based on `description`:

```
Research how authentication works in this codebase.
```

### Method 2: Explicit Invocation

Name the agent directly:

```
Use the researcher agent to find all API endpoints in /src/api.
```

### Method 3: Tool Invocation (Advanced)

```text
Evaluate #file:databaseSchema using #runSubagent and generate a migration plan.
```

---

## Subagent Behavior & Limits

| Aspect        | Behavior                                          |
| ------------- | ------------------------------------------------- |
| **Model**     | Inherits parent session's model (cannot override) |
| **Tools**     | Restricted to agent's `tools` list                |
| **Context**   | Isolated — no access to parent chat history       |
| **State**     | Stateless — each invocation is independent        |
| **Nesting**   | Subagents cannot create other subagents           |
| **Follow-up** | Requires new invocation with full context         |

---

## Common Patterns for This Project

### Pattern 1: Read-Only Research

```markdown
---
name: explore
displayName: Explorer
description: Read-only codebase exploration and search
tools: ['grep', 'glob', 'view', 'read', 'semantic_search']
infer: true
---

You explore the codebase to answer questions. Never edit files.
Return file paths, symbols, and concise explanations.
```

**Invoke**: `Use the explorer agent to find where the toolbar resize logic lives.`

### Pattern 2: Test Hardening

```markdown
---
name: test-hardener
displayName: Test Hardener
description: Fixes flaky/broken tests without touching source code
tools: ['grep', 'glob', 'view', 'read', 'edit', 'bash']
infer: false
---

You fix broken unit tests and improve coverage. Only edit test files (*.test.ts, *.spec.ts).
Run `npm run test` to verify. Never modify source files.
```

**Invoke**: `Use the test-hardener agent to fix failing tests in src/tools/__tests__/.`

### Pattern 3: Documentation Audit

```markdown
---
name: doc-auditor
displayName: Documentation Auditor
description: Checks docs against code for drift and accuracy
tools: ['grep', 'glob', 'view', 'read']
infer: false
---

You compare documentation to implementation. Report discrepancies with file:line references.
Focus on AGENTS.md, HANDOFF.md, and docs/ARCHITECTURE.md.
```

**Invoke**: `Use the doc-auditor agent to verify AGENTS.md matches current tool implementations.`

---

## Troubleshooting

| Error                      | Cause                                     | Fix                                                             |
| -------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `502 User not found`       | Tried to use OpenRouter model in subagent | Use main session's model; don't specify model in subagent       |
| `400 Model not supported`  | Tried to use Kilo model in subagent       | Same as above                                                   |
| Subagent not invoked       | `infer: false` or no matching agent       | Use explicit invocation or set `infer: true`                    |
| "Enable subagents" missing | Old Copilot extension                     | Update VS Code + Copilot Chat extension                         |
| Subagent returns empty     | Task not self-contained                   | Include full context: goal, files, constraints, expected output |

---

## Project-Specific Agents (Add to `.github/agents/`)

Create these files for this Photoshop clone project:

### `.github/agents/explore.agent.md`

```markdown
---
name: explore
displayName: Explorer
description: Read-only codebase exploration for the ph photo editor
tools: ['grep', 'glob', 'view', 'read', 'semantic_search', 'task']
infer: true
---

You explore the ph photo editor codebase. Key areas:

- src/tools/ — tool implementations (brush, select, text, etc.)
- src/components/ — React UI components
- src/state/ — Zustand stores, history, replay
- e2e/ — Playwright tests
- .kilo/ — Kilo config, skills, agents

Never edit files. Return findings with file paths and line numbers.
```

### `.github/agents/test-fixer.agent.md`

```markdown
---
name: test-fixer
displayName: Test Fixer
description: Fixes broken unit/E2E tests in ph project
tools: ['grep', 'glob', 'view', 'read', 'edit', 'bash']
infer: false
---

You fix failing tests in the ph project. Rules:

- ONLY edit test files (*.test.ts, *.spec.ts, e2e/**)
- Run `npm run test` or `npm run test:e2e` to verify
- Never modify source code in src/
- Follow existing test patterns in the codebase
```

### `.github/agents/doc-auditor.agent.md`

```markdown
---
name: doc-auditor
displayName: Documentation Auditor
description: Audits ph project docs against implementation
tools: ['grep', 'glob', 'view', 'read']
infer: false
---

You audit documentation accuracy for the ph photo editor.
Check: AGENTS.md, HANDOFF.md, docs/ARCHITECTURE.md, docs/OVERRIDES.md
Report drift with file:line references. Focus on:

- Tool implementations vs. documented behavior
- Model routing rules vs. actual usage
- Worktree/agent procedures vs. reality
```

---

## Quick Reference Card

```
# In Copilot Chat (Agent mode):

# Auto-delegate
"Research how the text tool handles cursor positioning."

# Explicit agent
"Use the explore agent to find all Color Replacement tool files."

# With context
"Use the test-fixer agent on e2e/color.spec.ts — it's flaky on Linux CI.
 Context: uses Retina canvas, test waits for pixel diff. Expected: stable pass."

# Tool-style
"Analyze #file:src/tools/text.ts using #runSubagent and list all public exports."
```

---

## Key Takeaways

1. **Don't fight the model inheritance** — subagents use the parent's model
2. **Define custom agents** as `.agent.md` files for explicit control
3. **Make tasks self-contained** — subagents have no chat history
4. **Use `infer: true`** for automatic delegation, `infer: false` for explicit-only
5. **Enable `agent/runSubagent`** tool in chat settings
