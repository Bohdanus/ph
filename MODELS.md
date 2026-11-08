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

- Catalog checks can run in parallel. Inference first tries the exact Nemotron 3 Ultra model on each eligible provider, ordered Kilo, OpenRouter, then OpenCode. Only after all verified Nemotron routes fail does fallback begin: other OpenRouter models, other OpenCode models, then Groq. Lower-ranked Kilo models are not used as fallback. A provider is skipped unless its route is configured and its catalog has a currently verified-free candidate.
- Refresh candidates with `node scripts/free-model-pool.mjs --list`. Check the exact model/provider pair: Kilo and OpenRouter require exact-zero prices; OpenCode requires provider-owned `-free` IDs, except Nemotron may use the exact canonical ID only when the live OpenCode catalog marks it provider-owned; Groq allows only `openai/gpt-oss-120b` after explicit Free-plan opt-in.
- The runner sends Kilo inference through the installed Kilo Code CLI, so its saved Kilo Gateway OAuth is used. It searches `PATH` and common editor extension directories; set `KILO_CLI` only when discovery misses the executable. The child receives runtime paths but not other provider credentials or `KILO_CONFIG_CONTENT`; the tool-free `free-completion` agent and `--pure` mode block agent tools and external plugins.
- The Kilo CLI has no `--max-tokens` option. The runner's `--max-tokens` value is a response-length instruction for Kilo; the CLI/model controls the actual generation budget. When the caller omits the option, Nemotron gets a 4,000-token budget and other models default to 1,200. Explicit caller values are retained for Nemotron. OpenRouter and Groq receive provider-side token limits; Groq retains its 1,024-token reasoning floor.
- Nemotron receives a 12-minute inference timeout on each eligible provider; other model routes use five minutes. Catalog and quota requests use a separate 15-second timeout.
- OpenRouter inference uses `OPENROUTER_API_KEY`. The pool checks `GET /api/v1/key` lazily before its first OpenRouter inference route and uses the returned `used`, `limit`, and `remaining` values, not a fixed account-tier threshold. If daily remaining is zero, it persists the current UTC date and skips OpenRouter until the UTC date changes. If the quota check is unknown, it allows at most one inference attempt and does not retry until a positive quota is known. `--openrouter-quota` requires the same environment key; Kilo's locally stored OpenRouter credential is not read by the runner.
- OpenRouter 401/402 exhausts the source for the run. On a 429, the pool checks the daily counter and platform rate-limit headers: a zero platform remaining count skips OpenRouter for the run without model attribution; a zero daily counter persists the current UTC date. With verified positive daily quota, one same-route retry is allowed for a transient/upstream failure; valid `Retry-After` is capped at 60 seconds, with a short fallback delay when needed. Only confirmed upstream/model failures affect model quarantine: three attributable OpenRouter 429s in three hours quarantine that model for two hours, and 250 attributable failures in seven days quarantine that model for seven days. Network errors, truncation, empty output, and unresolved model IDs do not affect failure counters. There is no provider score or long-lived provider cooldown.
- A Kilo 429 persists a one-hour Kilo cooldown. OpenCode's `provider.free-limit` response is an account-quota event: skip OpenCode for the run without a long-lived cooldown or retry. A transient/model-specific OpenCode 429 may be retried once with a bounded wait. OpenCode Nemotron is eligible only when its live catalog gives the exact canonical model ID; a similar display name or fuzzy ID is not sufficient.
- Non-zero or invalid reported cost and content-policy rejections fail closed across providers, including Kilo and OpenCode. Do not retry the same request through another provider after either safety result.
- **MANDATORY: In Kilo tasks, pass `model` and `provider` together. GPT models use `openai`. Free sessions must not launch GPT children or perform Git operations.**

## Provider-specific free quotas

A provider name alone does not establish that a route is free. Verify the exact model/provider pair in the live catalog. Kilo and OpenRouter use separate free-model quotas:

| Provider ID  | Published free-model limit                                                                                                                | What the quota check covers                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `kilo`       | 200 requests per hour per IP, for authenticated and anonymous free-model requests.                                                        | `--openrouter-quota` does not read this Kilo gateway limit.                                 |
| `openrouter` | 20 requests per minute; 50 per day by default, rising to 1,000 per day after qualifying all-time credit purchases. Failed attempts count. | `--openrouter-quota` reads the daily counter only; it does not report the per-minute limit. |

OpenRouter currently raises its free-variant daily cap to 1,000 after a $10 credit purchase; the higher cap starts at $9 to account for top-up fees. Check its live policy because limits can change. The `/api/v1/key` counter reports the daily ceiling for the account, not the per-minute limit. OpenRouter distinguishes platform 429s (rate-limit headers) from upstream errors (provider code in the response body). This runner uses the headers and daily counter to decide whether it can rotate to another free model. Honor `Retry-After` when present. See [Kilo's gateway rate limits](https://kilo.ai/docs/gateway/usage-and-billing), [OpenRouter's free-model limits](https://openrouter.ai/collections/free-models), and [OpenRouter's API rate-limit reference](https://openrouter.ai/docs/api_reference/limits).

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
