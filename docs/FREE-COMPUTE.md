# Free and Low-Cost Model Compute

**Checked: 2026-10-23.** Catalogs and quotas change; refresh before use.

## Routing

1. **Use Kilo Laguna S (`poolside/laguna-s-2.1:free`) whenever available.** The user reports it works well; this repo's evidence shows repeated use and zero cost. All tested free models are less capable than GPT Luna; Nemotron is below Laguna S.
2. **When Laguna/Kilo quota is exhausted, try another currently free provider/model.** Prefer exact model IDs and verify zero input/output price. Stop retrying a provider after quota/capacity errors; never silently fall back to paid inference.
3. Use free models for bounded research, extraction, code search, and simple reviews. Check response text and `finish_reason`; HTTP 200 can still mean empty output.

## Observed results

| Route                        | Evidence                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kilo Laguna S                | Repeated use in Kilo history; previous smoke returned `LAGUNA_OK` at $0. A follow-up returned 429 (quota/capacity). Published Kilo cap: up to 200 requests/hour/IP. [Limits](https://kilo.ai/docs/gateway/usage-and-billing)                                                                                                                                   |
| OpenRouter exact `:free` IDs | On 2026-10-23, 17 catalog IDs had zero input/output prices. With optional reasoning disabled, Nemotron 3 Ultra, Cohere North Mini Code, and Dots3-Note Preview returned short completions at $0. Short smoke tests; Laguna remains preferred. [Catalog](https://openrouter.ai/collections/free-models/)                                                        |
| OpenRouter `openrouter/free` | Selected Liquid LFM2.5-2.6B; spent 420 reasoning tokens over 51s and returned no final text (`finish_reason=length`). Use exact IDs when possible.                                                                                                                                                                                                             |
| Other OpenRouter probes      | Laguna XS, Gemma 4, and Xing returned 429; Inkling Small returned 403 (harness restricted). Outcomes may change.                                                                                                                                                                                                                                               |
| Groq GPT-OSS 20B             | One project-account smoke returned HTTP 200; `code_interpreter` ran Python. Default urllib UA hit Cloudflare 403/1010; `Mozilla/5.0` worked. This account-specific observation does not prove another account's billing plan. These IDs have paid Developer-plan rates. [Code execution](https://console.groq.com/docs/tool-use/built-in-tools/code-execution) |
| Kilo pool failures           | `kilo-auto/free` and `recursive/flint-v1.0:free`: empty output; `nvidia/nemotron-3.5-super-vl:free`: HTTP 502. Latency was not recorded. These IDs remain quarantined in `scripts/free-model-pool.mjs`.                                                                                                                                                        |

### Codex free-route check (2026-10-24)

The live catalog listed Laguna S, Xing 4.0, Dots 3 Note Preview, Liquid LFM 2.5 2.6B, and Nemotron 3.5 Lightning at zero input/output price. A harmless 64-token smoke resolved to `kilo/poolside/laguna-s-2.1:free`, returned `finish_reason: stop`, 56 total tokens, and reported $0. This confirms that the route worked for a short prompt at that time; it does not establish ongoing capacity.

At 14:27 UTC on 2026-10-24, a follow-up harmless smoke again resolved to `kilo/poolside/laguna-s-2.1:free` and returned `FREE_ROUTE_OK` with `finish_reason: stop`, 52 prompt tokens, 4 completion tokens, 56 total tokens, and reported cost $0 (`is_byok: true`; upstream inference cost was $0). This confirms one short completion worked during the recovery run; it does not establish tool-using subagent access, broader capacity, or future availability.

A larger 47 KB source-security-review prompt did not complete: Laguna timed out, Kilo Xing returned HTTP 429, and OpenRouter Flint returned its daily free-model limit response. No route produced a completed answer, and there was no paid fallback. Stop after quota/capacity failures rather than rotating accounts or repeatedly retrying. `scripts/free-model-pool.mjs` is a completion client, not a tool-using subagent; the Codex host did not expose a verified free-provider route for subagents during this check. Before trusting an inference result, inspect the resolved provider/model, nonempty final text, `finish_reason`, and usage when reported. Free eligibility comes from the zero-priced catalog entry or explicit Groq free-plan confirmation; absent usage metadata is not a cost report. A catalog row or HTTP 200 alone is not enough.

### Codex route recheck (2026-10-25)

A refreshed catalog again listed multiple zero-priced Kilo and OpenRouter models. A harmless prompt through `scripts/free-model-pool.mjs` completed on `kilo/poolside/laguna-s-2.1:free` with `FREE_ROUTE_OK`, `finish_reason: stop`, 51 prompt tokens, 4 completion tokens, 55 total tokens, and reported cost `0` (`is_byok: true`). A separate OpenRouter-only smoke resolved `recursive/flint-v1.0:free` but returned HTTP 429 (`free-models-per-day`); the provider was not retried. The `kilo` and `opencode` CLIs were absent from this Codex shell. The completion runner therefore supplied verified free inference, but no free tool-using subagent route. These are point-in-time observations, not guarantees of future quota or capacity.

A 104 KB read-only code-review prompt did not complete: Laguna timed out, Xing4 returned HTTP 429, and OpenRouter Flint returned HTTP 429. The runner stopped without a paid fallback. Keep large review prompts bounded, and stop using a provider for the run after its timeout or quota response.

A bounded review of roughly 3,978 prompt tokens did complete through `kilo/poolside/laguna-s-2.1:free` with `finish_reason: stop`, 213 completion tokens, and reported cost `$0` (`is_byok: true`). It raised a possible hook bypass, but checking the source showed the call was inside the `mainPath` guard, so that finding was a false positive. The route supplied useful zero-cost inference; verify its claims against source before treating them as findings.

One local `Jan-v3.5-4B-Q4_K_XL` server started at `127.0.0.1:6767`; a harmless authenticated smoke returned the exact model, `finish_reason: stop`, and 17 tokens. A bounded review prompt of about 4.1K input tokens took roughly 32 seconds, ended with `finish_reason: length`, and included a false claim, so that review was unusable. The server was stopped and the port was checked clear. Local inference avoids provider API charges but uses host resources; trust output only when it is complete and verified, and run no more than one Jan model at a time.

Free-model research returned false quota claims, including NVIDIA production use and Hugging Face credits; other suggested free API quotas lacked official sources. Treat answers as leads; verify quotas with provider docs.

## Other free capacity

Groq was probed; other rows are docs research, not account tests.

| Provider                         | Published free allowance/access                                                   | Notes                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter                       | 50 free-model requests/day, 20/min; $10+ balance unlocks 1,000/day, still 20/min. | $10 is account balance, not tokens; failed calls count. [Limits](https://openrouter.ai/pricing/)                                                                                                                                                                                                                                      |
| Gemini API                       | Gemini 3.1 Flash-Lite lists free Standard and Batch input/output.                 | Project quotas apply. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Limits](https://ai.google.dev/gemini-api/docs/rate-limits)                                                                                                                                                                                          |
| Google Antigravity CLI           | $0 Individual plan; dynamic weekly quota.                                         | CLI supports async subagents and `/usage`; Teamwork and third-party access are paid. [Plans](https://www.antigravity.google/docs/plans) · [Subagents](https://www.antigravity.google/docs/cli-subagents)                                                                                                                              |
| OpenCode Console                 | Multiple zero-price models, including Nemotron, MiniMax, GLM, DeepSeek, and MiMo. | Limited-time offers; free chat models run in OpenCode, not Codex/API clients. [Models](https://dev.opencode.ai/v2/docs/console/models/)                                                                                                                                                                                               |
| NVIDIA NIM                       | Free hosted developer access for prototyping.                                     | May be rate limited; no fixed quota or unbounded gateway verified. [FAQ](https://docs.api.nvidia.com/nim/docs/product)                                                                                                                                                                                                                |
| Groq                             | Free plan: GPT-OSS 20B/120B currently list 30 RPM, 1,000 RPD, 8K TPM, 200K TPD.   | $0 Free plan is rate-limited; Developer plan charges per token for the same IDs and API route. Confirm plan and current org limits. [Limits](https://console.groq.com/docs/rate-limits) · [20B price](https://console.groq.com/docs/model/openai/gpt-oss-20b) · [120B price](https://console.groq.com/docs/model/openai/gpt-oss-120b) |
| Alibaba Model Studio             | Eligible new accounts: typically 1M combined tokens/model for 90 days.            | Region/model eligibility applies; enable **Free Quota Only**. [Quota](https://help.aliyun.com/en/model-studio/new-free-quota)                                                                                                                                                                                                         |
| Cohere trial                     | 1,000 calls/month; North Mini Code: 20 RPM.                                       | [Limits](https://docs.cohere.com/v2/docs/rate-limits)                                                                                                                                                                                                                                                                                 |
| Cerebras                         | Free API tier; 8K context.                                                        | Numeric allowance not published. [Pricing](https://inference-docs.cerebras.ai/support/pricing)                                                                                                                                                                                                                                        |
| Mistral                          | Free mode, no card, limited monthly usage.                                        | Account-specific limits. [Free mode](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)                                                                                                                                                                                                        |
| Cloudflare Workers AI            | 10,000 neurons/day on Workers Free.                                               | Neurons are not tokens; some models require paid Workers. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                   |
| Hugging Face Inference Providers | No free monthly credits.                                                          | Requires purchased credits or PRO. [Pricing](https://huggingface.co/docs/inference-providers/pricing)                                                                                                                                                                                                                                 |

## Usage notes

- Machine-local keys (mode `600`, never commit): `~/.config/groq/api_key` and `~/.config/openrouter/api_key`. Do not rotate keys or accounts to bypass provider limits. Before using Groq, verify the account is on its $0 Free plan; the same GPT-OSS model IDs have per-token prices on the Developer plan.
- Batch large text sweeps into bounded independent chunks; ask for concise results with source links or paths.
- Groq uses `https://api.groq.com/openai/v1`. Python urllib's default user agent got Cloudflare `403/1010`; `User-Agent: Mozilla/5.0` worked. Limits are organization-wide across keys; keep each account within its limits and don't switch keys to bypass 429s. [Limits](https://console.groq.com/docs/rate-limits)
- Groq GPT-OSS 20B/120B offer server-side Python `code_interpreter` and `browser_search`. Code execution is ephemeral and isolated; it can run snippets, not access local files or execute this repository's test suite. [Built-in tools](https://console.groq.com/docs/tool-use/built-in-tools)
- OpenRouter reasoning tokens count against `max_tokens`. For optional reasoning, inspect model metadata; disabling it can prevent empty completions. Check content, `finish_reason`, and usage. [Reasoning docs](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- Gemini Batch and Groq prompt caching can reduce cost/throughput pressure where supported; check current quotas and cache-hit fields.
- Track limits by provider/model, honor `Retry-After`, and rotate providers after exhaustion. Do not rotate accounts or IPs to evade limits.
- Paid fallback examples: Groq GPT-OSS 120B $0.15/M input, $0.60/M output; Gemini 3.1 Flash-Lite $0.25/M input, $1.50/M output. Set a spend cap and disable automatic paid fallback. [Groq price](https://console.groq.com/docs/model/openai/gpt-oss-120b) · [Gemini price](https://ai.google.dev/gemini-api/docs/pricing)

## Token-Saving Patterns

The dominant token cost in orchestrated work is the **root conversation context**, not
the free model's API call. The patterns below keep large or repetitive content out of
the conversation so free compute stays practical for long-running campaigns.

| Pattern                        | How it helps                                                        | How to apply here                                                                                          |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| File-based research handoff    | A subagent fetches and condenses; root reads only the summary file  | `scripts/free-research.mjs --output-file` or `--prompt-file` with `--output-file` on `free-model-pool.mjs` |
| Parallel read-only subagents   | Multiple research threads, each with its own context window         | Launch 2–4 `task` subagents on free Laguna, each writing its own summary file                              |
| Bounded output caps            | Prevents a free model from emitting a wall of raw text              | Always pass `--max-tokens`; inspect `finish_reason` for truncated results                                  |
| Reuse fetched evidence         | Avoid re-fetching the same URLs across passes                       | No cache is implemented; retain a source checklist and reuse saved evidence instead of repeating searches  |
| Grep then read                 | Search within content before loading it fully                       | The AWS free-terms subagent used targeted grep on a saved fetch; apply that pattern to all research        |
| Never bulk webfetch in root    | Each `webfetch` result enters the conversation                      | Delegate all URL fetches to a subagent or to `free-research.mjs`                                           |
| Never bulk chat-search in root | `kilo_local_recall` returns matched snippets that still cost tokens | Search inside a subagent; return only the relevant session IDs + 1-line summaries                          |
| Prompt caching where supported | Reduces token-billed repetition across retries                      | Groq caching for repeated prompts; verify cache-hit fields before relying on it                            |
| Deduplicate evidence           | Don't re-verify the same source across passes                       | Track verified URLs in a checklist file; skip on subsequent sweeps                                         |

### Codex Chat Gotchas (from free-compute research session)

The session `ses_e95bcfdcfffexvg2k2FBPlDWOm` did extensive free-compute research but burned
excessive root-context tokens. Key lessons that every orchestrator should apply:

1. **The configured Exa allowance was exhausted.** In this session, it returned HTTP 402
   after about four queries and reported $10.01 used. This is an account-specific observation,
   not a verified universal Exa monthly cap. It blocked the search provider, not provider
   documentation; the session pivoted to direct fetches of primary docs.
2. **Bulk `webfetch` in root context is the single biggest token drain.** The chat did 20+
   `webfetch` calls directly, loading full HTML/markdown into the conversation. The operator
   explicitly said: "you are searching too deep. go slower and delegate all next fan-off
   research (if any) to free models. This chat used too much tokens."
3. **Free model results are unreliable for factual claims.** The research returned false
   quota claims (NVIDIA production use, Hugging Face free credits). Always verify important
   findings against primary sources.
4. **`OpenRouter/openrouter/free` can return empty completions.** A smoke routed to
   Liquid LFM2.5-2.6B spent 420 reasoning tokens and returned no final text
   (`finish_reason=length`). Prefer exact IDs.
5. **Groq API requires a browser `User-Agent`.** Python's default UA gets Cloudflare
   `403/1010`; `User-Agent: Mozilla/5.0` worked.
6. **Kilo Laguna S can 429 even within the 200 req/hour/IP cap.** Rate limits can differ by
   account/IDE. Always handle 429 gracefully.
7. **Beam was absent from the live Kilo catalog at the time of the session.** Do not configure
   it as a working fallback until it reappears in a fresh catalog and is tested.
8. **OpenCode's free models are limited-time and app-bound.** Not suitable as general
   API/subagent fallbacks.
9. **Cerebras is a $5 promotional credit, not recurring free.** Stop when the credit expires.
10. **GitHub Models is retired** (as of 2026-07-30). Do not recommend it.
11. **Colab free runtimes prohibit SSH/remote control, web services, distributed workers.**
    Never use Colab as a background worker or CI runner.
12. **Hugging Face ZeroGPU is not a T4.** The official docs describe RTX Pro 6000 Blackwell-backed
    dynamic hardware and a 5-minute daily quota for free accounts, resetting 24 hours after first
    use. It is a narrow Spaces quota, not general-purpose GPU capacity. [ZeroGPU docs](https://huggingface.co/docs/hub/spaces-zerogpu)
13. **AWS Free Tier is no longer 12-month/750-hours.** Current model is $200 credit over 6 months.
    Old tutorials citing 750 hrs EC2/month are stale.

**Rule of thumb:** bulk URL fetches and chat searches belong in a verified free read-only
delegate with a file-based evidence handoff. `free-research.mjs` handles public URL lists;
it is not a chat-history search tool. If the host cannot guarantee a free route, do not
silently switch bulk research to a paid model.
