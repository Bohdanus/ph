# Models and Providers

## Current defaults

| Model                          | Route policy              | Use                                                                  |
| ------------------------------ | ------------------------- | -------------------------------------------------------------------- |
| Luna 6                         | `openai`                  | Paid; keep context under 272k tokens                                 |
| NVIDIA Nemotron 3 Ultra (free) | First eligible free route | Preferred reasoning route when the live catalog verifies eligibility |

The preference is a routing choice, not a current benchmark ranking. Free model catalogs and
availability change; refresh them with `node scripts/free-model-pool.mjs --list` before use.

The host-level `usageLimited` indicator can misreport GPT weekly usage and is not an authoritative
capacity signal. At route selection, do not exclude a model/provider solely because of this flag.
Use the live catalog and route policy to determine eligibility; paid inference still requires
explicit operator authorization. Determine available capacity from the account's quota meter and
provider responses; when they disagree, follow the provider-specific retry and source-stop rules in
[Routing](#routing). The flag itself neither establishes free eligibility nor authorizes paid use.

Use live catalogs, not stale model lists. Prefer verified free models for bounded research, text sweeps, code search, and simple reviews. If no free route is available, stop or get explicit operator authorization before using paid inference.

## Routing

- Catalog checks can run in parallel; inference is sequential and has a three-attempt ceiling per source. Try the exact Nemotron 3 Ultra model on each eligible provider in this order: Kilo, OpenRouter, then OpenCode. Only after the exact Nemotron routes fail does fallback begin: other OpenRouter models, other OpenCode models, then Groq. Lower-ranked Kilo models are not fallback routes. A provider is skipped unless its route is configured and its catalog has a currently verified-free candidate.
- Refresh candidates with `node scripts/free-model-pool.mjs --list`. Check the exact model/provider pair: Kilo and OpenRouter require exact-zero prices; OpenCode requires provider-owned `-free` IDs, except Nemotron may use the exact canonical ID only when the live OpenCode catalog marks it provider-owned; Groq allows only `openai/gpt-oss-120b` after explicit Free-plan opt-in.
- The runner sends Kilo inference through the installed Kilo Code CLI, so its saved Kilo Gateway OAuth is used. It searches `PATH` and common editor extension directories; set `KILO_CLI` only when discovery misses the executable. The child receives runtime paths but not other provider credentials or `KILO_CONFIG_CONTENT`; the tool-free `free-completion` agent and `--pure` mode block agent tools and external plugins.
- The Kilo CLI has no `--max-tokens` option. The runner's `--max-tokens` value is a response-length instruction for Kilo; the CLI/model controls the actual generation budget. Exact Nemotron calls request high reasoning effort where supported and a minimum 4,096-token response budget. When the caller omits the option, the requested ceiling is 65,536 tokens, matching the [current OpenRouter free endpoint metadata](https://openrouter.ai/api/v1/models/nvidia/nemotron-3-ultra-550b-a55b:free/endpoints); explicit larger values are retained up to that ceiling. This is a request, not a guarantee of provider allocation or delivered tokens. A Nemotron response ending with `length` is retried once on the same route with twice the requested budget, up to 65,536. Other models default to 1,200 tokens; Groq retains its 1,024-token reasoning floor.
- Nemotron receives a 12-minute inference timeout on each eligible provider; other model routes use five minutes. Catalog and quota requests use a separate 15-second timeout.
- OpenRouter inference uses `OPENROUTER_API_KEY`. The pool checks `GET /api/v1/key` lazily before its first OpenRouter inference route and uses the returned `used`, `limit`, and `remaining` values, not a fixed account-tier threshold. OpenRouter notes the tier counter is not enforced for every account or endpoint and does not gate BYOK; this runner conservatively stops when its live counter reports zero. If daily remaining is zero, it persists the current UTC date and skips OpenRouter until the UTC date changes; the server quota resets at 00:00 UTC, so no reset job is needed. If the initial quota probe is unknown, the pool allows at most one OpenRouter inference attempt in that run; a positive post-attempt refresh does not unlock another attempt. Quota-present retries require a positive initial probe. `--openrouter-quota` requires the same environment key; Kilo's locally stored OpenRouter credential is not read by the runner.
- OpenRouter 401/402 exhausts the source for the run. A platform 429 with zero `X-RateLimit-Remaining` also skips OpenRouter without model attribution; a zero daily counter persists the current UTC date. With verified positive daily quota, one bounded same-route retry is allowed for a transient OpenRouter response; valid `Retry-After` values up to 60 seconds are honored, while longer waits skip the source. Only confirmed upstream/model failures affect model quarantine: three attributable OpenRouter rate-limit failures (HTTP 429 or typed `rate_limit_exceeded`) in three hours quarantine that model for two hours, and 250 attributable failures in seven days quarantine that model for seven days. Typed `provider_unavailable` (502), `provider_overloaded` (503), and `timeout` (504) errors also establish upstream attribution without `provider_code`; generic HTTP 500 `server` errors remain unattributed unless other provider metadata is present. Network errors, truncation, empty output, and unresolved model IDs do not affect failure counters. There is no adaptive provider score or long-lived provider-wide cooldown.
- A Kilo 401/402 stops Kilo for the run; a Kilo 429 persists a one-hour source cooldown, not a model quarantine. OpenCode's `provider.free-limit` response is an account-quota event: skip OpenCode for the run without a long-lived cooldown or retry. A transient/model-attributable OpenCode 429 may be retried once per route with a bounded wait. OpenCode Nemotron is eligible only when its live catalog gives the exact canonical model ID; a similar display name or fuzzy ID is not sufficient.
- Non-zero or invalid reported cost and content-policy rejections fail closed across providers, including Kilo and OpenCode. Do not retry the same request through another provider after either safety result. The exact Kilo Nemotron 3 Ultra route is never automatically added to quarantine; quarantine for that route is operator-managed.
- **MANDATORY: In Kilo tasks, pass `model` and `provider` together. GPT models use `openai`. Free sessions must not launch GPT children or perform Git operations.**

## Provider-specific free quotas

A provider name alone does not establish that a route is free. Verify the exact model/provider pair in the live catalog. Kilo and OpenRouter use separate free-model quotas:

| Provider ID  | Published free-model limit                                                                                                                | What the quota check covers                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `kilo`       | 200 requests per hour per IP, for authenticated and anonymous free-model requests.                                                        | `--openrouter-quota` does not read this Kilo gateway limit.                                 |
| `openrouter` | 20 requests per minute; 50 per day by default, rising to 1,000 per day after qualifying all-time credit purchases. Failed attempts count. | `--openrouter-quota` reads the daily counter only; it does not report the per-minute limit. |

OpenRouter currently raises its free-variant daily cap to 1,000 after a $10 credit purchase; the higher cap starts at $9 to account for top-up fees. Check its live policy because limits can change. The `/api/v1/key` counter reports the daily ceiling for the account, not the per-minute limit. OpenRouter distinguishes platform 429s (rate-limit headers) from upstream errors (provider metadata in the response body). An upstream 429 can identify itself with the typed `error.metadata.error_type` and, when available, `error.metadata.provider_code` even without platform headers; that enables a bounded same-route retry when daily quota remains positive. A platform `X-RateLimit-Remaining: 0` still stops OpenRouter for the run. Because failed attempts can consume the daily cap, before another OpenRouter inference the pool refreshes quota after a nonterminal failure or incomplete response, including transport and response-parse failures. A zero or unknown refreshed quota stops OpenRouter for the run. Terminal safety outcomes such as HTTP 401/402, zero platform remaining, an overlong `Retry-After`, content-policy rejection, or reported cost stop the source or run without another inference. The pool allows at most one bounded same-route retry after a transient provider failure per OpenRouter run; the separate Nemotron length-recovery retry is also gated by a fresh quota check. After HTTP 200 is committed, typed provider errors can appear in top-level `error.metadata` or `choices[].error.metadata`; retryable types are `rate_limit_exceeded`, `provider_overloaded`, `provider_unavailable`, and `timeout`. Treat `error.metadata.error_type` values `content_policy_violation` and `refusal` as content-policy rejections and stop fallback across providers. See [Kilo's gateway rate limits](https://kilo.ai/docs/gateway/usage-and-billing), [OpenRouter's free-model limits](https://openrouter.ai/collections/free-models), [OpenRouter's API rate-limit reference](https://openrouter.ai/docs/api_reference/limits), and [OpenRouter's error reference](https://openrouter.ai/docs/api_reference/errors-and-debugging).

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
