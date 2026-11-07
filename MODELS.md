# Models and Providers

## Current defaults

| Model                          | Provider | Variant | Use                                                                      |
| ------------------------------ | -------- | ------- | ------------------------------------------------------------------------ |
| Luna 6                         | `openai` | `xhigh` | Paid; keep context under 272k tokens                                     |
| NVIDIA Nemotron 3 Ultra (free) | `kilo`   | `high`  | Preferred reasoning route when the live catalog verifies exact-zero cost |

The preference is a routing choice, not a current benchmark ranking. Free model catalogs and
availability change; refresh them with `node scripts/free-model-pool.mjs --list` before use.

Use live catalogs, not stale model lists. Prefer verified free models for bounded research, text sweeps, code search, and simple reviews. If no free route is available, stop or get explicit operator authorization before using paid inference.

## Routing

- Inference attempts providers in this order: Kilo, OpenRouter, Groq, then OpenCode. Catalog checks can run in parallel; inference is sequential. A provider is skipped unless its route is configured and its catalog has a currently verified-free candidate.
- Refresh candidates with `node scripts/free-model-pool.mjs --list`. Check the exact model/provider pair: Kilo and OpenRouter require exact-zero prices, OpenCode requires provider-owned `-free` IDs, and Groq allows only `openai/gpt-oss-120b` after explicit Free-plan opt-in.
- The runner sends Kilo inference through the installed Kilo Code CLI, so its saved Kilo Gateway OAuth is used. It searches `PATH` and common editor extension directories; set `KILO_CLI` only when discovery misses the executable. The child receives runtime paths but not other provider credentials or `KILO_CONFIG_CONTENT`; the tool-free `free-completion` agent and `--pure` mode block agent tools and external plugins.
- The Kilo CLI has no `--max-tokens` option. The runner's `--max-tokens` value is a response-length instruction for Kilo; the CLI/model controls the actual generation budget. OpenRouter and Groq receive a provider-side token limit.
- OpenRouter inference uses `OPENROUTER_API_KEY`. When Nemotron 3 Ultra appears as an exact-zero model in that live catalog, the runner tries it first, then preserves the catalog order. `--openrouter-quota` requires the same environment key; Kilo's locally stored OpenRouter credential is not read by the runner.
- OpenRouter Nemotron 3 Ultra receives at least 1,024 completion tokens so reasoning does not consume a tiny caller budget before a visible answer. The other OpenRouter models receive the requested `--max-tokens` value.
- OpenRouter 401/402 exhausts the source. On HTTP 429, a zero platform `X-RateLimit-Remaining` header or a zero daily counter exhausts it for the run; otherwise the pool can rotate among verified-free models within its three-model cap. HTTP 503 also triggers a daily-counter check before rotation. A missing or unreadable daily counter is treated as unknown and remains capped. The pool honors a valid `Retry-After` before another OpenRouter attempt; waits over 60 seconds skip OpenRouter for that run. Content-policy rejections — including successful HTTP responses with `finish_reason: content_filter` — stop routing across providers so the same request is not retried elsewhere.
- Catalog and quota requests have a 15-second timeout. Model inference has a five-minute timeout so reasoning models are not cut off by a catalog-sized deadline.
- **MANDATORY: In Kilo tasks, pass `model` and `provider` together. GPT models use `openai`. Free sessions must not launch GPT children or perform Git operations.**

## Provider-specific free quotas

A provider name alone does not establish that a route is free. Verify the exact model/provider pair in the live catalog. Kilo and OpenRouter use separate free-model quotas:

| Provider ID  | Published free-model limit                                                                                                                | What the quota check covers                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `kilo`       | 200 requests per hour per IP, for authenticated and anonymous free-model requests.                                                        | `--openrouter-quota` does not read this Kilo gateway limit.                                 |
| `openrouter` | 20 requests per minute; 50 per day by default, rising to 1,000 per day after qualifying all-time credit purchases. Failed attempts count. | `--openrouter-quota` reads the daily counter only; it does not report the per-minute limit. |

OpenRouter currently applies its higher daily tier starting at about $9 in purchases to account for fees; check its live policy because limits can change. The `/api/v1/key` counter reports the daily ceiling for the account, not the per-minute limit. OpenRouter distinguishes platform 429s (rate-limit headers) from upstream errors (provider code in the response body). This runner uses the headers and daily counter to decide whether it can rotate to another free model. Honor `Retry-After` when present. See [Kilo's gateway rate limits](https://kilo.ai/docs/gateway/usage-and-billing), [OpenRouter's free-model limits](https://openrouter.ai/collections/free-models), and [OpenRouter's API rate-limit reference](https://openrouter.ai/docs/api_reference/limits).

### Groq

Groq serves only `openai/gpt-oss-120b` on the Free plan — no per-model pricing, so routing requires `GROQ_FREE_PLAN=1` (see [`docs/FREE-COMPUTE-OPERATIONS.md`](docs/FREE-COMPUTE-OPERATIONS.md)). The runner rotates only keys explicitly supplied through `GROQ_API_KEY` or `GROQ_API_KEYS` after per-key 401/402/429 responses; it never reads key files during inference. Use keys from distinct Free-plan organizations because Groq limits apply at the organization level. GPT-OSS reasoning is low but speed is very fast: use Groq only for bulk text sweeps (chat search, chat-history processing), never for deep reasoning or code review.

## Free-agent boundaries

- Free Kilo children are read-only: use `read-only-research` for visible sessions and `explore` for internal tasks. Deny shell, edit, write, patch, and all connected file-mutation tools. If the host cannot verify this boundary, use the completion runner or do not launch the child.
- The completion runner has no agent tools. Its Kilo CLI profile denies every tool name, pipes prompts through stdin, and never uses `--file` or `--auto`; the coordinator owns file edits and Git. Cap fan-out at 15.
- Use concise evidence-backed results. For large outputs, use `--output-file`; use `free-research.mjs` only for bounded public HTTPS URL lists.

## Research and credentials

Bulk web, code, or chat-history research must use a verified free read-only route and return a short result for root verification. If none is available, stop before paid research. For secure credential discovery, provider setup, and runner commands, see [`docs/FREE-COMPUTE-OPERATIONS.md`](docs/FREE-COMPUTE-OPERATIONS.md).

## Free subagent helper

`scripts/free-subagent-launcher.mjs` is an opt-in wrapper for host-supplied
`agent_manager` calls. It validates every task against the live provider catalog,
requires a known OpenRouter quota when that provider is selected, and caps a
batch at 15. It launches only the repository's read-only `read-only-research`
profile and does not retry or rotate credentials.

The helper is not a global host hook: direct Kilo, Copilot, or other task-tool
calls do not invoke it automatically. Use the host's read-only permission
profile for every free child; if the host cannot verify that boundary, do not
launch the child. Never treat a static model list, a provider name, or this
optional wrapper as proof that an unrelated host call is free or read-only.
Refresh exact model/provider pricing with `node scripts/free-model-pool.mjs --list`.
