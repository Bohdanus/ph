---
name: free-model-agent-rotation
description: Route bounded research, text-sweep, and simple review subtasks through currently free model providers without paid fallback.
---

# Free Model Agent Rotation

Use free models first for high-signal web research, documentation, chat-history extraction, code search, simple code writing, and simple review. Split large inputs into bounded independent subtasks and ask for concise findings with source paths or citations.

## Refresh and select

Run `node scripts/free-model-pool.mjs --list` in a repository worktree. It refreshes candidates and reports configuration, not quota, capacity, or successful inference. For Kilo, `configured: null` means the CLI was found but its login was not probed; OpenRouter's flag reflects key presence. Use only working routes listed in `MODELS.md`; do not reuse stale catalog output.

For a standalone text completion, put the non-sensitive prompt in a temporary file and run:

```bash
node scripts/free-model-pool.mjs --prompt-file /tmp/free-task.txt --max-tokens 1200
```

The runner tries at most three models per provider and never falls back to paid models. Kilo uses the extension-discovered CLI and its tool-free `free-completion` profile. OpenRouter 401/402 exhausts the source; model 429 checks the daily counter and rotates models while requests remain (or within the cap if unknown). Groq rotates supplied keys on 401/402/429; use only distinct organizations because limits are organization-level. Inference reads `GROQ_API_KEY` or `GROQ_API_KEYS`; `--probe-groq` checks saved key files but does not load them for inference. `--openrouter-quota` reports a point-in-time daily counter, not the separate per-minute limit. The runner never sleeps or retries the same model/key; errors include `Retry-After` when provided.

**Use free subagents heavily, but keep Kilo free children read-only.** For visible Kilo research sessions, use the project `read-only-research` agent in `.kilo/agent/read-only-research.md`. For parallel internal repository exploration, use the native `task` tool's `explore` role with the exact free model and provider together. Verify no `edit`, `bash`, or separate write/patch tools are available; Kilo permissions are tool-level, so there is no delete-only permission. Explicitly deny any connected file-mutating MCP tools not covered by the profile. If read-only access cannot be verified, use the completion runner or do not launch the child. Free children do not launch GPT subagents, perform Git operations, or write summary files; they return concise findings and the coordinator writes any needed files. Keep the global maximum of 15 concurrent subagents. Inspect each child's resolved model; a provider label alone does not prove it was free. If rate limited, refresh the catalog and rotate to another exact free pair, never silently to paid compute.

## Data handling

Do not send credentials, private chat content, or confidential repository data to providers unless the applicable provider terms and user authorization allow it. Kilo warns that Auto Free may log prompts and use them to improve upstream services; some model providers have stricter trial terms. OpenRouter and promotional model availability can change. Confirm current source terms before sending sensitive data.

Do not infer API access from a free IDE plan or catalog row; require a successful zero-cost completion before counting a route as usable. Keep the task coordinator responsible for edits, validation, and Git operations.
