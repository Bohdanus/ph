---
name: free-model-agent-rotation
description: Route bounded research, text-sweep, and simple review subtasks through currently free model providers without paid fallback.
---

# Free Model Agent Rotation

Use free models first for high-signal web research, documentation, chat-history extraction, code search, simple code writing, and simple review. Split large inputs into bounded independent subtasks and ask for concise findings with source paths or citations.

## Refresh and select

Run `node scripts/free-model-pool.mjs --list` in a repository worktree. This fetches the live Kilo catalog and the OpenRouter catalog when `OPENROUTER_API_KEY` is available. The list includes only exact zero input/output pricing and explicit free Kilo or OpenRouter IDs. Model availability and quotas change; do not reuse stale catalog output.

For a standalone text completion, put the non-sensitive prompt in a temporary file and run:

```bash
node scripts/free-model-pool.mjs --prompt-file /tmp/free-task.txt --max-tokens 1200
```

The runner rotates through free model entries and, on HTTP 402/429, treats that provider as exhausted for this run and tries the next provider. It stops when all eligible providers fail. It does not use or discover paid fallback models. The OpenRouter key is read from `OPENROUTER_API_KEY` and must never be copied into files or output.

For parallel repository subagents, call the native `task` tool once per bounded subtask, specifying the exact catalog model and provider together. Free child sessions must not launch GPT subagents or perform Git operations. Inspect each child's resolved model before relying on its result; a provider label alone does not prove the selected model was free. If a task call is rate limited, refresh the catalog and rotate to another exact free pair. Stop when all available free capacity is exhausted.

## Data handling

Do not send credentials, private chat content, or confidential repository data to providers unless the applicable provider terms and user authorization allow it. Kilo warns that Auto Free may log prompts and use them to improve upstream services; some model providers have stricter trial terms. OpenRouter and promotional model availability can change. Confirm current source terms before sending sensitive data.

Do not infer API access from a free IDE plan. Before adding a source, verify its official API endpoint, whether it requires an account key, current zero input and output prices, quota, and data policy. OpenCode Console currently publishes free API models but requires its Console key and includes limited-time offerings; consider it only after a live check. Keep the task coordinator responsible for any edits, validation commands, and Git operations.
