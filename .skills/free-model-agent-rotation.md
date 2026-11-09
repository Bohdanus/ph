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
node scripts/free-model-pool.mjs --prompt-file /tmp/free-task.txt --output-file /tmp/free-task-result.txt
```

The runner tries the exact Nemotron 3 Ultra model first in this order: Kilo, OpenRouter, then OpenCode. It requests high reasoning effort on OpenRouter and OpenCode; the Kilo CLI uses `--variant high`. All Nemotron routes request at least 4,096 completion tokens and default to a 65,536-token ceiling, the current OpenRouter free endpoint maximum. These are requested limits, not guarantees of provider allocation; the Kilo CLI receives a response-length instruction because it has no `--max-tokens` option. A truncated Nemotron answer is retried once on that same route with twice the budget, up to 65,536, before rotating. If all exact Nemotron routes fail, the runner tries other OpenRouter models, other OpenCode models, then Groq; it attempts at most three candidates per provider per run. Other model routes default to 1,200 tokens. Kilo inference uses the authenticated Kilo Code CLI and its `free-completion` profile, which denies all tools. The CLI is discovered on `PATH` or in common editor extension folders; `KILO_CLI` overrides discovery. OpenCode uses its headless CLI with tools denied and accepts only provider-owned catalog IDs ending in `-free`, except the exact Nemotron ID when the live catalog marks it provider-owned. Inference has a twelve-minute timeout for Nemotron and five minutes for other models; catalog and quota checks have a separate 15-second timeout. Kilo exhausts its source for reported 401/402/429 errors, while other model-level failures can move to the next Kilo candidate. OpenRouter 401/402 exhausts the source; 429 and 503 rotate only when quota/header checks permit, honoring a valid `Retry-After` up to 60 seconds. Other failures move to another candidate. Content-policy rejection stops routing across providers. The runner stops when eligible free routes fail and never discovers paid fallback models. The OpenRouter key must never be copied into files or output. `--openrouter-quota` reports the server-side daily `used/limit/remaining` counter without inference; check before and after large fan-outs to include other tools' concurrent use. `--probe-openrouter-quota` logs the pre-route snapshot and skips OpenRouter if exhausted. Results report this run's per-provider request attempts.

**Use free subagents heavily, but keep Kilo free children read-only.** For visible Kilo research sessions, use the project `read-only-research` agent in `.kilo/agent/read-only-research.md`. For parallel internal repository exploration, use the native `task` tool's `explore` role with the exact free model and provider together. Verify no `edit`, `bash`, or separate write/patch tools are available; Kilo permissions are tool-level, so there is no delete-only permission. Explicitly deny any connected file-mutating MCP tools not covered by the profile. If read-only access cannot be verified, use the completion runner or do not launch the child. Free children do not launch GPT subagents, perform Git operations, or write summary files; they return concise findings and the coordinator writes any needed files. Keep the global maximum of 15 concurrent subagents. Inspect each child's resolved model; a provider label alone does not prove it was free. If rate limited, refresh the catalog and rotate to another exact free pair, never silently to paid compute.

## Data handling

Do not send credentials, private chat content, or confidential repository data to providers unless the applicable provider terms and user authorization allow it. Kilo warns that Auto Free may log prompts and use them to improve upstream services; some model providers have stricter trial terms. OpenRouter and promotional model availability can change. Confirm current source terms before sending sensitive data.

Do not infer API access from a free IDE plan. OpenCode is used through its CLI, not an IDE session or generic model HTTP API; a provider-owned `-free` catalog ID establishes model eligibility but not authentication or capacity. Kilo and OpenRouter require exact-zero catalog pricing, and OpenRouter inference needs `OPENROUTER_API_KEY`. Keep the task coordinator responsible for edits, validation, and Git operations.
