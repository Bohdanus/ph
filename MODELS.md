# Models and Providers

## Current defaults

| Model                                                       | Route policy                                                                | Use                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b:free`) | Highest-priority model across eligible providers                            | Bounded research, extraction, and code review                 |
| Other verified free models                                  | Lower priority; known ranks first, remaining routes interleaved by provider | Bounded research, extraction, code search, and simple reviews |
| Luna 6                                                      | `openai`; paid only with explicit operator authorization                    | Keep context under 272k tokens                                |

**Model-first rule:** order routes by the maintained model-strength rank across providers. Try the
exact Nemotron 3 Ultra model through every eligible, verified-free provider route before a weaker
model. Xing 4.0 is the next explicitly ranked fallback; catalog models without an explicit rank share
the final tier and are interleaved across providers in Kilo, OpenRouter, OpenCode, then Groq order.
Provider order never moves a known weaker model ahead of a stronger rank. A quarantine or failure
applies to that provider/model pair, not to the model on every provider. Do not bypass a route's
active quarantine, quota, authentication, pricing, or safety restrictions.

**Current route status:** the exact Nemotron 3 Ultra `:free` route on OpenRouter is under a
168-hour `poor_performance` quarantine through `2026-11-19T02:03:21.539Z`, added at operator
direction on 2026-11-12. This hold applies only to OpenRouter. The exact Kilo route remains approved;
check `npm run free:quarantine -- list` for current expiry state. Refresh live catalogs with
`node scripts/free-model-pool.mjs --list`; a catalog row does not prove authentication, quota, or
capacity.

For Nemotron, request high reasoning where supported, a minimum 4,096-token response budget, and a
12-minute inference timeout. The runner defaults Nemotron to 4,096 tokens; an explicit higher budget
may request up to 65,536, subject to the provider's live endpoint ceiling. Kilo has no CLI token-limit
flag, so its adapter passes the budget as a response-length instruction; the model controls actual
output length. Confirm non-empty text, the resolved model/provider, completion reason, and reported
cost before relying on a result.

The host-level `usageLimited` indicator can misreport GPT weekly usage and is not an authoritative
capacity signal. At route selection, do not exclude a model/provider solely because of this flag.
Use the live catalog and route policy to determine eligibility; paid inference still requires
explicit operator authorization. Determine available capacity from the account's quota meter and
provider responses; when they disagree, follow the provider-specific retry and source-stop rules in
[Routing](#routing). The flag itself neither establishes free eligibility nor authorizes paid use.

Use live catalogs, not stale model lists. Prefer verified free models for bounded research, text sweeps, code search, and simple reviews. If no free route is available, stop or get explicit operator authorization before using paid inference.

## Routing

- Catalog checks can run in parallel; inference is sequential and has a three-attempt ceiling per source. Order eligible routes by maintained model strength first, with the exact Nemotron 3 Ultra model ahead of all weaker models across providers. The current known ranks are Nemotron, then Xing 4.0; unranked models share the final tier. Route-specific quarantine and provider failures exclude only that pair/source. A provider is eligible only when configured and its live catalog verifies a free route.
- Refresh candidates with `node scripts/free-model-pool.mjs --list`. Check the exact model/provider pair: Kilo and OpenRouter require exact-zero prices; OpenCode requires provider-owned `-free` IDs, with the exact Nemotron `:free` ID also allowed only when `owned_by` is `opencode`; Groq allows only `openai/gpt-oss-120b` after explicit Free-plan opt-in.
- The Kilo adapter uses the installed Kilo Code CLI and its saved Gateway OAuth. It searches `PATH` and common editor extension directories; set `KILO_CLI` only when discovery misses the executable. The child receives runtime paths but not other provider credentials or `KILO_CONFIG_CONTENT`; the tool-free `free-completion` agent and `--pure` mode block agent tools and external plugins.
- The Kilo CLI has no `--max-tokens` option; its adapter passes the budget as a response-length instruction and selects the `high` variant for Nemotron. Nemotron routes request high reasoning where supported, at least 4,096 response tokens, and a 12-minute timeout. The runner defaults this route to 4,096 tokens; callers may explicitly request up to 65,536 subject to the provider's live endpoint ceiling. Other model routes default to 1,200 tokens; Groq retains its 1,024-token reasoning floor. Other inference routes default to five minutes; catalog and quota requests use a separate 15-second timeout.
- OpenRouter inference uses `OPENROUTER_API_KEY`. The pool checks `GET /api/v1/key` lazily before its first OpenRouter inference route and uses the returned `used`, `limit`, and `remaining` values, not a fixed account-tier threshold. OpenRouter notes the tier counter is not enforced for every account or endpoint and does not gate BYOK; this runner conservatively stops when its live counter reports zero. If daily remaining is zero, it persists the current UTC date and skips OpenRouter until the UTC date changes; the server quota resets at 00:00 UTC, so no reset job is needed. If the initial quota probe is unknown, the pool allows at most one OpenRouter inference attempt in that run; a positive post-attempt refresh does not unlock another attempt. Quota-present retries require a positive initial probe. `--openrouter-quota` requires the same environment key; Kilo's locally stored OpenRouter credential is not read by the runner.
- OpenRouter 401/402 exhausts the source for the run. A platform 429 identified by `openrouter_*` limit metadata or zero `X-RateLimit-Remaining` skips OpenRouter without model attribution; a zero daily counter persists the current UTC date. With verified positive daily quota, one bounded same-route retry is allowed for a transient OpenRouter response; valid `Retry-After` values up to 60 seconds are honored. For an upstream/model-attributable HTTP 429 with a longer wait, the pool refreshes daily quota and skips only that model when quota remains positive; zero or unknown refreshed quota stops OpenRouter. Longer waits for other failures stop the source. If that retry also fails, the pool rotates to another eligible OpenRouter model when a fresh quota check remains positive and the per-source attempt ceiling permits it. Only confirmed upstream/model failures affect model quarantine: three attributable OpenRouter rate-limit failures (HTTP 429 or typed `rate_limit_exceeded`) in three hours quarantine that model for two hours, and 250 attributable failures in seven days quarantine that model for seven days. Typed `provider_unavailable` (502), `provider_overloaded` (503), and `timeout` (504) errors also establish upstream attribution without `provider_code`; generic HTTP 500 `server` errors remain unattributed unless other provider metadata is present. Network errors, truncation, empty output, and unresolved model IDs do not affect failure counters. There is no adaptive provider score or long-lived provider-wide cooldown.
- A Kilo 401/402 stops Kilo for the run; a Kilo 429 persists a one-hour source cooldown, not a model quarantine. OpenCode's `provider.free-limit` response is an account-quota event: skip OpenCode for the run without a long-lived cooldown or retry. A transient/model-attributable OpenCode 429 may be retried once per route with a bounded wait.
- Non-zero or invalid reported cost and content-policy rejections fail closed across providers, including Kilo and OpenCode. Do not retry the same request through another provider after either safety result.
- The shared local quarantine file may contain manually maintained `permanent_ban` and `provider_ban` records. Both remain scoped to their exact `source:model` key; `provider_ban` does not ban that provider's other models. The pool honors them for up to 100 UTC calendar years; a February 29 anniversary clamps to February 28 when the target year is not a leap year. Automatic quarantine updates and CLI `add` remain limited to the existing transient reasons and 168-hour maximum; they preserve an active operator ban for the same source/model pair. Unknown reasons and out-of-range durations fail closed.
- **MANDATORY: In Kilo tasks, pass `model` and `provider` together. GPT models use `openai`. Free sessions must not launch GPT children or perform Git operations.**

## Provider-specific free quotas

A provider name alone does not establish that a route is free. Verify the exact model/provider pair in the live catalog. Kilo and OpenRouter use separate free-model quotas:

| Provider ID  | Published free-model limit                                                                                                                | What the quota check covers                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `kilo`       | 200 requests per hour per IP, for authenticated and anonymous free-model requests.                                                        | `--openrouter-quota` does not read this Kilo gateway limit.                                 |
| `openrouter` | 20 requests per minute; 50 per day by default, rising to 1,000 per day after qualifying all-time credit purchases. Failed attempts count. | `--openrouter-quota` reads the daily counter only; it does not report the per-minute limit. |

OpenRouter currently raises its free-variant daily cap to 1,000 after a $10 credit purchase; the higher cap starts at $9 to account for top-up fees. Check its live policy because limits can change. The `/api/v1/key` counter reports the daily ceiling for the account, not the per-minute limit. OpenRouter distinguishes platform 429s (rate-limit headers) from upstream errors (provider metadata in the response body). An upstream 429 can identify itself with the typed `error.metadata.error_type` and, when available, `error.metadata.provider_code` even without platform headers; that enables a bounded same-route retry when daily quota remains positive. A platform `openrouter_*` limit source or `X-RateLimit-Remaining: 0` still stops OpenRouter for the run. Because failed attempts can consume the daily cap, before another OpenRouter inference the pool refreshes quota after a nonterminal failure or incomplete response, including transport and response-parse failures. A zero or unknown refreshed quota stops OpenRouter for the run. Terminal outcomes such as HTTP 401/402, zero platform remaining, longer waits for non-model-attributable failures, content-policy rejection, or reported cost stop the source or run without another inference. The pool allows at most one bounded same-route retry after a transient provider failure per OpenRouter run. After HTTP 200 is committed, typed provider errors can appear in top-level `error.metadata` or `choices[].error.metadata`; retryable types are `rate_limit_exceeded`, `provider_overloaded`, `provider_unavailable`, and `timeout`. Treat `error.metadata.error_type` values `content_policy_violation` and `refusal` as content-policy rejections and stop fallback across providers. See [Kilo's gateway rate limits](https://kilo.ai/docs/gateway/usage-and-billing), [OpenRouter's free-model limits](https://openrouter.ai/collections/free-models), [OpenRouter's API rate-limit reference](https://openrouter.ai/docs/api_reference/limits), and [OpenRouter's error reference](https://openrouter.ai/docs/api_reference/errors-and-debugging).

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
