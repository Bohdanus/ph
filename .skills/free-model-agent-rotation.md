---
name: free-model-agent-rotation
description: Route bounded research, text-sweep, and simple review subtasks through currently free model providers without paid fallback.
---

# Free Model Agent Rotation

Use free models first for high-signal web research, documentation, chat-history extraction, code search, simple code writing, and simple review. Split large inputs into bounded independent subtasks and ask for concise findings with source paths or citations.

## Refresh and select

Run `node scripts/free-model-pool.mjs --list` in a repository worktree. It fetches the public Kilo and OpenRouter catalogs without API credentials. Only current Kilo and OpenRouter free entries that pass exact pricing checks across all present price fields and conditional overrides are listed. For Kilo, `configured: null` means the CLI is present but its saved login was not probed; for OpenRouter, `configured` reflects `OPENROUTER_API_KEY`. Neither value promises quota or capacity. Model availability and quotas change; do not reuse stale catalog output.

For a standalone text completion, put the non-sensitive prompt in a temporary file and run:

```bash
node scripts/free-model-pool.mjs --prompt-file /tmp/free-task.txt --max-tokens 1200
```

The runner tries at most three eligible model IDs per provider per run. HTTP 401/402/429 immediately exhausts that provider for this invocation and rotates to the next source; it does not sleep or retry. Kilo inference uses the authenticated Kilo Code CLI and its `free-completion` profile, which denies all tools. The CLI is discovered on `PATH` or in common editor extension folders; `KILO_CLI` overrides discovery. OpenRouter uses `OPENROUTER_API_KEY`, tries Laguna S 2.1 first when listed, and has a five-minute inference timeout; catalog and quota checks have a separate 15-second timeout. If a response has `Retry-After`, the failure message includes it so the operator can wait before a later run. Other failures rotate among at most three models before moving on. It stops when all eligible providers fail and never discovers paid fallback models. The OpenRouter key must never be copied into files or output. `--openrouter-quota` reports the server-side daily `used/limit/remaining` counter without inference; check before and after large fan-outs to include other tools' concurrent use. `--probe-openrouter-quota` logs the pre-route snapshot and skips OpenRouter if exhausted. Results report this run's per-provider request attempts.

**Use free subagents heavily, but keep Kilo free children read-only.** For visible Kilo research sessions, use the project `read-only-research` agent in `.kilo/agent/read-only-research.md`. For parallel internal repository exploration, use the native `task` tool's `explore` role with the exact free model and provider together. Verify no `edit`, `bash`, or separate write/patch tools are available; Kilo permissions are tool-level, so there is no delete-only permission. Explicitly deny any connected file-mutating MCP tools not covered by the profile. If read-only access cannot be verified, use the completion runner or do not launch the child. Free children do not launch GPT subagents, perform Git operations, or write summary files; they return concise findings and the coordinator writes any needed files. Keep the global maximum of 15 concurrent subagents. Inspect each child's resolved model; a provider label alone does not prove it was free. If rate limited, refresh the catalog and rotate to another exact free pair, never silently to paid compute.

## Data handling

Do not send credentials, private chat content, or confidential repository data to providers unless the applicable provider terms and user authorization allow it. Kilo warns that Auto Free may log prompts and use them to improve upstream services; some model providers have stricter trial terms. OpenRouter and promotional model availability can change. Confirm current source terms before sending sensitive data.

Do not infer API access from a free IDE plan. OpenCode Console docs state free-tier chat requires the OpenCode app; this generic runner intentionally does not use its free models. Prefer OpenRouter's public `/api/v1/models` catalog and exact `:free` variants with all price fields and conditional overrides at zero. Inference needs `OPENROUTER_API_KEY`. Keep the task coordinator responsible for edits, validation, and Git operations.
