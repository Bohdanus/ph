# Free and Low-Cost Model Compute

**Checked: 2026-10-23.** Provider catalogs, quotas, prices, and promotions change. Refresh live
catalogs before each run and distinguish requests, tokens, and vendor-specific credits.

## Patterns from recent Codex and Kilo history

- The recurring strategy is free-first delegation for high-signal text work: web research, docs,
  chat-history extraction, code search, and simple read-only reviews. Laguna S is the first choice
  when Kilo capacity is available; OpenRouter is a fallback when Kilo is exhausted or when an
  independent completion review is useful.
- A free API completion is not automatically a tool-using subagent. This Codex collaboration
  runtime does not route `spawn_agent` to OpenRouter. Kilo `task`, OpenCode, or a separate agent
  harness must support the exact model/provider pair.
- Do not trust the requested model name alone. Kilo chat-history audits found calls resolving to a
  different model/provider pair than requested. Verify the child session's resolved model, and
  read both error and success records when auditing usage.
- A read-only Kilo database snapshot on 2026-10-23 showed 415 `ph` sessions whose current model
  field was `poolside/laguna-s-2.1:free`; their stored counters summed to about 136.5M input and
  2.84M output tokens at $0. This is evidence of substantial historical use, not an exact launch
  count: `session.model` is mutable, and a session may contain multiple turns.
- Recent Codex runs also found that a free catalog entry can be unavailable (429), return no final
  text, or consume a short output budget with hidden reasoning. Treat those as per-run provider or
  configuration outcomes; a 429 is not proof that a model is intrinsically poor.

## Tested on this machine

| Source and check                           | Result                                                                                                                                                                                                | Use                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kilo gateway, `poolside/laguna-s-2.1:free` | Prior smoke test returned `LAGUNA_OK` at zero cost; Kilo history shows repeated use. A follow-up returned 429.                                                                                        | Best evidenced remote free source here. Stop when the account/IP quota is exhausted and resume after its documented window. [Kilo usage and billing](https://kilo.ai/docs/gateway/usage-and-billing)                   |
| OpenRouter live catalog                    | On 2026-10-23, 17 explicit `:free` IDs had zero input/output prices.                                                                                                                                  | Use only refreshed IDs and exact model names when stable behavior matters. Catalog membership does not guarantee endpoint capacity or quality. [Free model catalog](https://openrouter.ai/collections/free-models/)    |
| OpenRouter exact free calls                | With `reasoning: { enabled: false }`, Nemotron 3 Ultra returned 121 output tokens in 3.5s, Cohere North Mini Code returned 37 in 1.7s, and Dots3-Note Preview returned 61 in 2.3s; each call cost $0. | These are short response smokes, not agent or quality benchmarks. Disabling optional reasoning avoided the empty completions seen in prior tests. Check the model catalog's `reasoning.mandatory` before disabling it. |
| OpenRouter `openrouter/free` auto-router   | It selected Liquid LFM2.5-2.6B, used 420 reasoning tokens in 51s, and returned no final text (`finish_reason=length`) at $0.                                                                          | The router can vary models automatically, but this smoke was not useful. Prefer exact IDs for bounded work and detect empty responses before using a result.                                                           |

Free-model review output also needs source checks: Nemotron incorrectly implied the free developer
license allows production self-hosting, and Cohere claimed Hugging Face free users receive monthly
credits, contradicted by the current primary docs. Dots returned “no findings” on the same short
fact-check. These samples are too small to rank models, but show why a confident free-model answer
is not evidence by itself.

The direct account probes in this section covered OpenRouter only. Other providers below are
research leads; their signup, account quota, and request path were not verified on this machine.

Earlier calls to Laguna XS, Gemma 4, and Xing returned 429; Inkling Small returned 403 because it was
restricted to supported agentic harnesses. Those outcomes describe the endpoints at that time, not
the underlying model quality. OpenRouter's free router also varies the selected model per request,
so output quality, speed, reasoning defaults, and data terms can change between calls.

Earlier Kilo pool failures are still quarantined by `scripts/free-model-pool.mjs`; the run did not
record per-model latency, so do not call these instant failures:

| Kilo model ID                       | Recorded result                            |
| ----------------------------------- | ------------------------------------------ |
| `kilo-auto/free`                    | Empty completion (`finish_reason=length`). |
| `nvidia/nemotron-3.5-super-vl:free` | HTTP 502 provider error.                   |
| `recursive/flint-v1.0:free`         | Empty completion (`finish_reason=length`). |

## More free capacity to consider

| Source                           | Published allowance or access                                                                                             | Practical note                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kilo gateway                     | Up to 200 free requests/hour/IP.                                                                                          | Request count, not token allowance; verify the resolved model and stop on quota exhaustion. [Usage and billing](https://kilo.ai/docs/gateway/usage-and-billing)                                                                                                                                                                                                                                                                                                              |
| OpenRouter free models           | 50 free-model requests/day and 20/minute; loading at least $10 in credits raises the daily cap to 1,000, still 20/minute. | The $10 is a balance, not a token pack. Failed requests count against the daily allowance. The `openrouter/free` router selects a free model dynamically; it is not included in this repo's pool runner because that runner verifies exact catalog IDs. [Pricing and limits](https://openrouter.ai/pricing/) · [Free router](https://openrouter.ai/openrouter/free)                                                                                                          |
| Google Gemini API                | Gemini 3.1 Flash-Lite currently lists free Standard **and Batch** input and output tokens.                                | Project/model quotas still apply and are shown in AI Studio. Google's pricing page says free-tier content may be used to improve products; keep private chat history out of free API prompts. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)                                                                                                                                                    |
| Google Antigravity CLI           | Individual plan costs $0 and has a weekly quota that varies with model availability and agent workload.                   | The CLI supports asynchronous subagents and `/usage` quota checks. The `/teamwork-preview` orchestrator and third-party model access require paid plans; no fixed free request count is published. This is a separate agent harness, not a Codex provider route. [Plans and quota](https://www.antigravity.google/docs/plans) · [CLI subagents](https://www.antigravity.google/docs/cli-subagents) · [Usage command](https://www.antigravity.google/docs/cli/commands/usage) |
| OpenCode Console                 | Current Console catalog lists multiple zero-price models, including Nemotron, MiniMax, GLM, DeepSeek, and MiMo variants.  | Many free offers are explicitly limited-time, and exact quotas are not published. Console account/key required; verify model price and privacy exceptions before each use. [Models and terms](https://dev.opencode.ai/v2/docs/console/models/)                                                                                                                                                                                                                               |
| NVIDIA API Catalog / NIM         | NVIDIA Developer Program offers hosted NIM endpoints for prototyping.                                                     | NVIDIA warns that hosted calls may be rate limited; no stable public token allowance was confirmed. Downloadable NIM is for research/development/testing on supported GPUs, not unlimited hosted inference or a free production license. [NIM FAQ](https://docs.api.nvidia.com/nim/docs/product) · [Run NIM Anywhere](https://docs.api.nvidia.com/nim/docs/run-anywhere)                                                                                                     |
| Groq                             | Free GPT-OSS 120B and 20B list 30 RPM, 1,000 RPD, 8K TPM, and 200K TPD.                                                   | TPD is the real ceiling for long sweeps. Check the organization's live limits and response headers. Cached prompt tokens do not count against rate limits for supported models. [Rate limits](https://console.groq.com/docs/rate-limits) · [Prompt caching](https://console.groq.com/docs/prompt-caching)                                                                                                                                                                    |
| Alibaba Model Studio             | Eligible new accounts may receive typically 1M combined input/output tokens per model for 90 days.                        | Free quota is region/model-specific, shared across account users, and expires. Enable **Free Quota Only** to stop at the limit; otherwise verified accounts can be billed after exhaustion. [Quota rules](https://help.aliyun.com/en/model-studio/new-free-quota)                                                                                                                                                                                                            |
| Cohere trial API                 | Trial keys allow 1,000 API calls/month; North Mini Code chat lists 20 requests/minute.                                    | Good for occasional bounded tasks, not a high-throughput agent pool. [Rate limits](https://docs.cohere.com/v2/docs/rate-limits)                                                                                                                                                                                                                                                                                                                                              |
| Cerebras Inference               | Free API key; free tier has lower limits and an 8K context window.                                                        | Fast hardware does not mean high free quota; numeric free limits are not published in the pricing page. [Pricing](https://inference-docs.cerebras.ai/support/pricing)                                                                                                                                                                                                                                                                                                        |
| Mistral API                      | Free mode enables API access without a payment card, with included monthly usage.                                         | Model-specific limits are shown in the account's Limits page; the public setup page does not state a universal allowance. [Free mode](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key) · [Usage limits](https://docs.mistral.ai/admin/billing-usage/usage-limits)                                                                                                                                                                   |
| Cloudflare Workers AI            | 10,000 neurons/day at no charge on Workers Free.                                                                          | Neurons are not comparable to tokens; some models require Workers Paid. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                                                                                                                                                                                                            |
| Hugging Face Inference Providers | Free accounts have no included monthly credits.                                                                           | Free users must buy credits or upgrade to PRO to use routed providers; don't count Hugging Face as a free inference pool. [Pricing](https://huggingface.co/docs/inference-providers/pricing)                                                                                                                                                                                                                                                                                 |

## Use free capacity efficiently

- **Split large sweeps into bounded independent chunks.** Free models are often slower and less
  reliable under long prompts. Give each call only relevant excerpts and request structured,
  source-backed findings. Keep output caps large enough for the expected answer.
- **Avoid reasoning-only empty completions.** OpenRouter documents that reasoning tokens count
  against `max_tokens`; a response can end with `finish_reason=length` and empty `content`. When a
  model supports optional reasoning, inspect its live `reasoning` metadata and consider
  `reasoning: { enabled: false }` for extraction or short review tasks. Otherwise set a supported
  reasoning budget or increase `max_tokens`, then check visible output and usage fields. [Reasoning
  tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- **Queue offline work with Gemini Batch.** Gemini 3.1 Flash-Lite currently lists both Standard
  and Batch as free input/output on the free tier. Check project quotas and token caps before
  enqueueing large jobs; free-tier prompt data may be used to improve Google's products. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Batch API](https://ai.google.dev/gemini-api/docs/batch-api)
- **Reuse exact prompt prefixes on Groq.** Automatic caching supports GPT-OSS 20B, GPT-OSS 120B,
  and GPT-OSS-Safeguard 20B. Stable instructions and schemas should precede changing inputs. Cache
  hits are best-effort and cached tokens do not count against rate limits. Check
  `usage.prompt_tokens_details.cached_tokens` to verify a hit. [Prompt caching](https://console.groq.com/docs/prompt-caching)
- **Monitor quota per provider, model, and window.** Record response headers and `Retry-After`,
  circuit-break after quota errors, and never retry through a paid model. Rotate across legitimately
  available services; do not rotate accounts or IPs to evade limits.
- **Check provider data terms before use.** OpenRouter evaluates retention per endpoint, but its
  free plan does not include Data Policy-Based Routing. Do not send secrets or confidential chat
  history to free endpoints unless their current terms explicitly permit it. [OpenRouter plans](https://openrouter.ai/pricing/) · [Data retention](https://openrouter.ai/blog/insights/zero-data-retention/)

## Low-cost fallback

When free pools are exhausted, consider price and task fit rather than adding concurrency blindly.
Current published examples include Groq GPT-OSS 120B at $0.15/M input and $0.60/M output, and
Gemini 3.1 Flash-Lite at $0.25/M input and $1.50/M output on paid Standard. OpenRouter's $10
balance can unlock 1,000 daily free-model requests, but does not buy tokens. Set a hard spend cap
and disable paid fallback in every client. [Groq model price](https://console.groq.com/docs/model/openai/gpt-oss-120b) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)

## Operating rules

1. Prefer the proven Kilo Laguna S route when its quota is available; add other providers only after
   verifying exact model, price, account limits, and data terms.
2. Use explicit `:free` models with zero input and output prices; avoid dynamic routers when a task
   requires stable model quality or a known data policy.
3. Keep retries bounded. Treat 429 as quota/capacity, distinguish it from a repeatable model defect,
   and stop rather than falling through to paid inference.
4. Inspect `finish_reason`, visible content, `usage`, and reasoning-token counts before accepting a
   free-model response. A successful HTTP status does not mean it produced a usable answer.
5. Use free models for broad extraction and first-pass review; verify important conclusions against
   primary sources or a separate reviewer before acting on them.
