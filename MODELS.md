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

**Current route status:** the exact Nemotron 3 Ultra `:free` route on OpenRouter was released from its
operator-managed `poor_performance` quarantine on 2026-11-17 at operator direction. This release
applies only to that provider/model pair; live catalog pricing, authentication, and quota checks still
apply. The exact Kilo route remains approved; automatic failure handling does not write persistent
model-quarantine entries for this exact Kilo route. A Kilo HTTP 429 still applies the one-hour source
cooldown described below. Explicit quarantine entries for the exact Kilo route remain operator-managed. Check
`npm run free:quarantine -- list` for current expiry state. Refresh live catalogs with
`node scripts/free-model-pool.mjs --list`; a catalog row does not prove authentication, quota, or
capacity.

For Nemotron, request high reasoning where supported, a minimum 4,096-token response budget, and a
12-minute inference timeout. The runner defaults Nemotron to 4,096 tokens; an explicit higher budget
may request up to 65,536, subject to the provider's live endpoint ceiling. Kilo has no CLI token-limit
flag, so its adapter passes the budget as a response-length instruction; the model controls actual
output length. Confirm non-empty text, the resolved model/provider, completion reason, and reported
cost before relying on a result.

To pin the completion runner to one exact route, pass both `--provider` and `--model`. If the pair is missing, quarantined, or not verified free, the run stops before inference instead of falling back. Passing only one flag filters by that provider or model while retaining eligible routes in the other dimension. This command requests Kilo Nemotron with an 8,192-token response-length budget:

```sh
node scripts/free-model-pool.mjs --prompt-file /tmp/nemotron-review.txt \
  --provider kilo --model nvidia/nemotron-3-ultra-550b-a55b:free --max-tokens 8192
```

Kilo receives that budget as an instruction, not a hard provider token limit. For WSL with Windows-saved Kilo auth, see [`docs/FREE-COMPUTE-OPERATIONS.md`](docs/FREE-COMPUTE-OPERATIONS.md#kilo-code).

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
- Kilo automatic discovery canonicalizes PATH directories and candidate parents, excludes runner and caller roots plus their ancestor `node_modules/.bin` directories, and rejects executable aliases that resolve into those protected paths. It also rejects multiply linked candidates and symlink chains that pass through a protected path even when the final target is outside; direct external single-link executables remain eligible when their resolution chain stays outside. Discovery fails closed if an ancestor bin or candidate link cannot be inspected. These checks do not pin the executable inode through spawn, so concurrent changes to writable host paths remain outside this guard. The child `PATH` uses the same exclusions and prepends the current Node runtime directory so `/usr/bin/env node` uses the process runtime. An explicit `KILO_CLI` value is operator-trusted.
- The Kilo adapter uses the installed Kilo Code CLI and its saved Gateway OAuth. Missing or inaccessible `PATH` entries are ignored; on Windows path comparisons are case-insensitive and supported `PATHEXT` order is preserved. An explicit `KILO_CLI` value is an operator-trusted override; set it only when automatic discovery misses the executable. The child runs from a fresh temporary project that contains only its wildcard-deny `free-completion` agent, so repository and caller project config cannot load. Before creating it, the adapter resolves the caller environment's configured temporary directory (or the system default) and refuses to run if that path is inside a Git or Kilo project boundary. It isolates `HOME`, XDG config/cache/data, and temporary directories; only the caller's Kilo `auth.json` is linked into the temporary XDG data root, and only when its resolved data directory is outside a Git or Kilo project boundary. The boundary check distinguishes global Kilo state from project-local markers while still treating `.git` at the account home as a project. `--pure` skips external plugins. Other provider credentials, `KILO_DB`, and caller-supplied config variables are dropped. Kilo organization or system-managed settings are outside this isolation; verify their effective policy or skip the Kilo route in managed environments.
- The Kilo CLI has no `--max-tokens` option; its adapter passes the budget as a response-length instruction and selects the `high` variant for Nemotron. Nemotron routes request high reasoning where supported, at least 4,096 response tokens, and a 12-minute timeout. The runner defaults this route to 4,096 tokens; callers may explicitly request up to 65,536 subject to the provider's live endpoint ceiling. Other model routes default to 1,200 tokens; Groq retains its 1,024-token reasoning floor. Other inference routes default to five minutes; catalog and quota requests use a separate 15-second timeout.
- OpenRouter inference uses `OPENROUTER_API_KEY`. The pool checks `GET /api/v1/key` lazily before its first OpenRouter inference route and uses the returned `used`, `limit`, and `remaining` values, not a fixed account-tier threshold. OpenRouter notes the tier counter is not enforced for every account or endpoint and does not gate BYOK; this runner conservatively stops when its live counter reports zero. When a quota probe reports zero, the runner persists the UTC date when that probe started; if an inference error reports the exact `openrouter_free_tier_daily` limit source, it persists the UTC date when that request started. This keeps a slow response crossing midnight from extending the quota stop by a day. It skips OpenRouter while the stored date is today, even if the refreshed counter temporarily reports positive remaining. A generic message match alone stops only the current run; a zero live counter still persists the date. The server quota resets at 00:00 UTC, so no reset job is needed. If the initial quota probe is unknown, the pool allows at most one OpenRouter inference attempt in that run; a positive post-attempt refresh does not unlock another attempt. Quota-present retries require a positive initial probe. `--openrouter-quota` requires the same environment key; Kilo's locally stored OpenRouter credential is not read by the runner.
- OpenRouter 401/402 exhausts the source for the run. A platform 429 identified by `openrouter_*` limit metadata or zero `X-RateLimit-Remaining` skips OpenRouter without model attribution; a zero daily counter or exact `openrouter_free_tier_daily` limit source persists the UTC date when its associated quota probe or inference request started. With verified positive daily quota, one bounded same-route retry is allowed for a transient OpenRouter response; valid `Retry-After` values up to 60 seconds are honored. For an upstream/model-attributable HTTP 429 with a longer wait, the pool refreshes daily quota and skips only that model when quota remains positive; zero or unknown refreshed quota stops OpenRouter. Longer waits for other failures stop the source. If that retry also fails, the pool rotates to another eligible OpenRouter model when a fresh quota check remains positive and the per-source attempt ceiling permits it. Only confirmed upstream/model failures affect model quarantine: three attributable OpenRouter rate-limit failures (HTTP 429 or typed `rate_limit_exceeded`) in three hours quarantine that model for two hours, and 250 attributable failures in seven days quarantine that model for seven days. Typed `provider_unavailable` (502), `provider_overloaded` (503), and `timeout` (504) errors also establish upstream attribution without `provider_code`; generic HTTP 500 `server` errors remain unattributed unless other provider metadata is present. Network errors, truncation, empty output, and unresolved model IDs do not affect failure counters. There is no adaptive provider score or long-lived provider-wide cooldown.
- A Kilo 401/402 stops Kilo for the run; a Kilo 429 persists a one-hour source cooldown, not a model quarantine. OpenCode's `provider.free-limit` response is an account-quota event: skip OpenCode for the run without a long-lived cooldown or retry. A transient/model-attributable OpenCode 429 may be retried once per route with a bounded wait. OpenCode command lookup removes runner and caller PATH entries and npm-injected ancestor `node_modules/.bin` entries; it resolves relative and symlinked entries before filtering, drops missing or inaccessible paths, rejects canonical directories that cannot be represented safely in PATH, and resolves a bare command to an absolute executable. It rejects executable aliases into either project by canonical path and aliases into excluded ancestor bins by canonical path, including npm bin symlinks. Bare PATH lookup also rejects candidates unless filesystem metadata proves they are regular files with exactly one hard link. This blocks static hard-link aliases while a link to the target remains under either protected project. It does not inspect Linux mount namespaces, so bind-mounted project aliases are outside this guard. It does not pin the inode through process creation, so concurrent filesystem changes to a writable PATH directory remain outside this protection. It also conservatively rejects multiply linked host executables. If an ancestor bin cannot be inspected, PATH filtering and bare lookup fail closed. Windows `Path` and `PATHEXT` keys are matched case-insensitively, and the caller's order among supported executable extensions is honored. A Windows PATH alias is accepted only when its canonical target has the selected executable extension, and the shim receives that canonical target to avoid a second alias lookup. Explicit extensionless Windows path overrides are resolved to the first existing supported executable in the caller's `PATHEXT` order before spawning. An explicit path command such as `OPENCODE_CLI=/absolute/path/to/opencode` is an operator-trusted override; other PATH entries remain trusted host configuration.
- Non-zero or invalid reported cost and content-policy rejections fail closed across providers, including Kilo and OpenCode. Do not retry the same request through another provider after either safety result.
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
- The completion runner has no agent tools. Its Kilo CLI profile denies every tool name, isolates project and user configuration, pipes prompts through stdin, and never uses `--file` or `--auto`; the coordinator owns file edits and Git.
- The host-managed free-subagent launcher caps batches at 15 and validates every task's current model/provider route.
- Use concise evidence-backed results. For large outputs, use `--output-file`; use `free-research.mjs` only for bounded public HTTPS URL lists.
- Completion-runner token and timeout profiles apply only to its tool-free text calls. `scripts/free-subagent-launcher.mjs` exposes neither `maxTokens` nor a timeout field; bound those tasks by prompt scope and expected output instead of claiming an exact token budget.

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
