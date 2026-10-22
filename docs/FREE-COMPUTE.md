# Free and Low-Cost Model Compute

**Checked: 2026-10-22.** Provider catalogs, quotas, and promotions change; recheck the linked
official pages and live model catalog before each run. “Requests” and vendor-specific credits are
not interchangeable with tokens.

## Verified on this machine

| Source                                     | Result                                                                                                                                                                                                                                                                              | Use                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jan at `http://127.0.0.1:1337/v1`          | `/v1/models` listed `MiMo-V2_6-Distill-Qwen-9B-Q5_K_M`; it returned `MIMO_OK` for a 13-token prompt/6-token completion in 0.58 s warm, after a prior 14/6-token request took 8.46 s. The earlier `Jan-v3.5-4B-Q4_K_XL` smoke test returned `JAN_OK` in 490 ms.                      | These are API smoke tests, not quality benchmarks. Both models work through Jan's OpenAI-compatible API. Prefer MiMo where its quality is needed; use the smaller Jan model for low-latency triage. Local work consumes machine resources rather than hosted-provider request quotas. [Jan API server](https://jan.ai/docs/api-server) |
| Kilo gateway, `poolside/laguna-s-2.1:free` | Live catalog marked both prices zero and the model free. A harmless 53-prompt/5-output-token request returned `LAGUNA_OK` in 5.7 s at zero cost. A local Kilo session also records 11 successful calls using this resolved model (about 1.95M input and 72.5K output tokens total). | Preferred remote free model from observed evidence. A follow-up returned 429 in 620 ms. Treat 429 as source exhaustion, not model failure; wait for the published 200 requests/hour/IP window to reset. [Usage and billing](https://kilo.ai/docs/gateway/usage-and-billing)                                                            |

The earlier free-model-pool run had no per-model latency measurement, so do not label its failures
“instant.” Its captured outcomes were enough to quarantine these Kilo candidates until a deliberate
requalification:

| Kilo model ID                       | Observed failure                           |
| ----------------------------------- | ------------------------------------------ |
| `kilo-auto/free`                    | Empty completion (`finish_reason=length`). |
| `nvidia/nemotron-3.5-super-vl:free` | HTTP 502, provider error.                  |
| `recursive/flint-v1.0:free`         | Empty completion (`finish_reason=length`). |

The pool runner filters these three IDs from Kilo results. A `429` is a provider quota/capacity
signal, not evidence that a model is intrinsically bad; stop retrying that provider for the run.

## More capacity worth using

| Provider                         | Published free allowance                                                                                               | Practical note                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kilo                             | 200 free requests/hour/IP.                                                                                             | Request cap, not a token quota; use only catalog-confirmed free models. [Usage and billing](https://kilo.ai/docs/gateway/usage-and-billing)                                                                                                                                                             |
| OpenRouter                       | 50 free-model requests/day, 20/minute; a $10+ credit balance raises the free-model cap to 1,000/day, still 20/minute.  | This purchases a balance, not tokens. Failed free calls count; use explicit `:free` IDs and never allow a paid fallback. [Limits and caveats](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/)                                                             |
| Alibaba Model Studio             | New users may receive typically 1M combined input/output tokens per eligible model, valid for 90 days.                 | Region/model eligibility varies across the documentation. Enable **Free Quota Only** before use to stop at the limit. [Quota rules](https://help.aliyun.com/en/model-studio/new-free-quota)                                                                                                             |
| Groq                             | Free GPT-OSS 120B: 1,000 requests/day, 8K TPM, 200K TPD.                                                               | The token/day limit makes this a predictable supplemental pool. Read current organization limits and response headers. [Rate limits](https://console.groq.com/docs/rate-limits)                                                                                                                         |
| Gemini API                       | Free input/output on selected models; current pricing also lists Gemini 3.1 Flash-Lite Batch input and output as free. | Check AI Studio for the actual project/model quota and batch enqueue cap. Free-tier data may be used to improve Google's products. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) · [Pricing and data terms](https://ai.google.dev/gemini-api/docs/pricing)                           |
| Mistral API                      | “Free mode” has no card requirement and includes limited API usage.                                                    | Numeric free caps are not stated in the setup guide; verify the account’s model limits before depending on it. [Free mode setup](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key) · [Rate-limit behavior](https://docs.mistral.ai/resources/known-limitations) |
| Cohere trial key                 | 1,000 calls/month; chat endpoints list 20 requests/minute per model.                                                   | Better for occasional evaluations or batched embedding/rerank work than a high-volume chat-agent pool. [Rate limits](https://docs.cohere.com/v2/docs/rate-limits)                                                                                                                                       |
| OpenCode Console                 | Its current catalog marks several models free, many explicitly limited-time.                                           | Free access is tied to a Console account/key; quotas and duration are not guaranteed. Recheck model and price before use. [Models](https://dev.opencode.ai/v2/docs/console/models/)                                                                                                                     |
| SambaNova Cloud                  | The current “Free” plan page asks users to add a payment method and purchase credits before the first request.         | Do not count it as recurring zero-cost inference; review current onboarding terms before paying. [Plans](https://cloud.sambanova.ai/plans)                                                                                                                                                              |
| Cloudflare Workers AI            | 10,000 neurons/day at no charge on Workers Free.                                                                       | Neurons are not comparable to tokens; some newer models require Workers Paid. [Pricing and allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                                                                                   |
| Hugging Face Inference Providers | Free accounts currently receive $0.10/month of credits, subject to change.                                             | Treat as a small testing buffer, not a high-volume pool; extra usage requires purchased credits. [Pricing and billing](https://huggingface.co/docs/inference-providers/pricing)                                                                                                                         |

## High-throughput patterns

- **Queue offline work through Gemini Batch.** Gemini 3.1 Flash-Lite's current pricing table lists
  free-tier Batch input and output. This is useful for independent tasks such as classifying,
  extracting, or summarizing a large corpus where immediate responses are unnecessary. Batch has
  its own quotas and enqueued-token caps; check the project's live limits, and do not assume the
  paid-tier batch cap applies to a free project. The documented 24-hour completion window is an
  objective, not a per-job guarantee.
  Free-tier data may be used to improve Google's products. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) ·
  [Batch API](https://ai.google.dev/gemini-api/docs/batch-api) ·
  [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- **Reuse exact prompt prefixes on Groq.** Automatic caching currently supports GPT-OSS 20B,
  GPT-OSS 120B, and GPT-OSS-Safeguard 20B. Put stable instructions, schemas, and shared context
  first; append the changing query last. Cache hits discount cached input by 50% and cached tokens
  do not count against rate limits. Hits are best-effort, expire after two idle hours, and do not
  stack with batch discounts. Check `usage.prompt_tokens_details.cached_tokens` to verify benefit.
  [Prompt caching](https://console.groq.com/docs/prompt-caching) ·
  [Rate limits](https://console.groq.com/docs/rate-limits)
- **Use local Jan before spending hosted capacity.** Deduplicate records, split long documents into
  bounded excerpts, classify/filter locally, and send only uncertain or high-value cases to hosted
  models. Measure throughput and output quality on a representative sample; local inference trades
  provider quotas for device time, power, and memory.
- **Track quota by provider, model, and window.** Record request/token counters and response limit
  headers, honor `Retry-After`, and circuit-break a source after quota or capacity errors. Keep a
  separate hard spend ceiling and disable paid fallback in every client. Rotate among legitimately
  available providers/models only; never evade caps by changing accounts or IPs.

## Low-cost token volume

When free pools are exhausted, choose by the input/output mix. Current published examples:

- Groq GPT-OSS 120B: $0.15/M input and $0.60/M output; $10 buys about 66.7M input **or**
  16.7M output tokens before other constraints. [Price](https://console.groq.com/docs/model/openai/gpt-oss-120b)
- Gemini 3.1 Flash-Lite: $0.25/M input and $1.50/M output on the listed paid Standard tier; $10 buys
  about 40M input **or** 6.7M output tokens. Paid Batch halves those rates; its free-tier Batch
  rates are currently listed as free. [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- OpenRouter's $10 balance can unlock the 1,000/day free-request tier, but it is not a token
  allotment and can also fund paid requests if the client permits them.

For repeated prompts, provider-supported caching can reduce duplicate inference cost; it does not
create new daily quota. For bulk reading, prefer local Jan models when quality and hardware are
sufficient, and send only bounded, relevant excerpts to remote models.

## Operating rules

1. Prefer local Jan for private or high-volume sweeps; prefer Kilo Laguna S for remote free work.
2. Refresh catalogs and verify exact model/provider and zero input/output prices before a run.
3. Quarantine a model after repeatable empty/5xx failures; treat 429 as temporary source exhaustion.
4. Cap retries, use backoff, batch high-signal text, cache repeat work, and stop rather than falling
   through to paid inference.
5. Do not rotate accounts or IPs to evade provider limits. Never send secrets or confidential
   project content to a free endpoint without checking its data policy.
