---
name: free-model-agent-rotation
description: Route bounded research, text-sweep, and simple review subtasks through currently free model providers without paid fallback.
---

# Free Model Agent Rotation

Use free models first for high-signal web research, documentation, chat-history extraction, code search, simple code writing, and simple review. Split large inputs into bounded independent subtasks and ask for concise findings with source paths or citations.

## Refresh and select

Run `node scripts/free-model-pool.mjs --list` in a repository worktree. It fetches the public Kilo and OpenRouter catalogs without API credentials. Only current Kilo and OpenRouter free entries that pass exact pricing checks across all present price fields and conditional overrides are listed. `configured: true|false` reports whether local inference credentials and required Groq opt-in are present; it does not promise quota or capacity. Model availability and quotas change; do not reuse stale catalog output.

For a standalone text completion, put the non-sensitive prompt in a temporary file and run:

```bash
node scripts/free-model-pool.mjs --prompt-file /tmp/free-task.txt --max-tokens 1200
```

The runner tries at most three eligible model IDs per provider per run. HTTP 402/429 immediately exhausts that provider for this invocation and rotates to the next source; it does not sleep or retry. If the response has `Retry-After`, the failure message includes it so the operator can wait before a later run. Other failures rotate among at most three models before moving on. It stops when all eligible providers fail. It does not use or discover paid fallback models. The OpenRouter key is read from `OPENROUTER_API_KEY` and must never be copied into files or output. `--openrouter-quota` reports the server-side daily `used/limit/remaining` counter without inference; check before and after large fan-outs to include other tools' concurrent use. `--probe-openrouter-quota` logs the pre-route snapshot and skips OpenRouter if exhausted. Results report this run's per-provider request attempts.

**Use free subagents heavily.** For parallel repository exploration, reviews, and research, call the native `task` tool once per bounded subtask, specifying the exact free model and provider together. Keep the global maximum of 15 concurrent subagents. Free child sessions must not launch GPT subagents or perform Git operations. Inspect each child's resolved model; a provider label alone does not prove it was free. If rate limited, refresh the catalog and rotate to another exact free pair, never silently to paid compute.

## Data handling

Do not send credentials, private chat content, or confidential repository data to providers unless the applicable provider terms and user authorization allow it. Kilo warns that Auto Free may log prompts and use them to improve upstream services; some model providers have stricter trial terms. OpenRouter and promotional model availability can change. Confirm current source terms before sending sensitive data.

Do not infer API access from a free IDE plan. OpenCode Console docs state free-tier chat requires the OpenCode app; this generic runner intentionally does not use its free models. Prefer OpenRouter's public `/api/v1/models` catalog and exact `:free` variants with all price fields and conditional overrides at zero. Inference needs `OPENROUTER_API_KEY`. Groq is an explicit last resort only, after independently verifying the account's Free plan. Keep the task coordinator responsible for edits, validation, and Git operations.
