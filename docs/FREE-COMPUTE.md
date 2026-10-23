# Free and Low-Cost Model Compute

**Checked: 2026-10-23.** Catalogs and quotas change; refresh before use.

## Routing

1. **Use Kilo Laguna S (`poolside/laguna-s-2.1:free`) whenever available.** The user reports it works well; this repo's evidence shows repeated use and zero cost. All tested free models are less capable than GPT Luna; Nemotron is below Laguna S.
2. **When Laguna/Kilo quota is exhausted, try another currently free provider/model.** Prefer exact model IDs and verify zero input/output price. Stop retrying a provider after quota/capacity errors; never silently fall back to paid inference.
3. Use free models for bounded research, extraction, code search, and simple reviews. Check response text and `finish_reason`; HTTP 200 can still mean empty output.

## Observed results

| Route                        | Evidence                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kilo Laguna S                | Repeated use in Kilo history; previous smoke returned `LAGUNA_OK` at $0. A follow-up returned 429 (quota/capacity). Published Kilo cap: up to 200 requests/hour/IP. [Limits](https://kilo.ai/docs/gateway/usage-and-billing)                                                                            |
| OpenRouter exact `:free` IDs | On 2026-10-23, 17 catalog IDs had zero input/output prices. With optional reasoning disabled, Nemotron 3 Ultra, Cohere North Mini Code, and Dots3-Note Preview returned short completions at $0. Short smoke tests; Laguna remains preferred. [Catalog](https://openrouter.ai/collections/free-models/) |
| OpenRouter `openrouter/free` | Selected Liquid LFM2.5-2.6B; spent 420 reasoning tokens over 51s and returned no final text (`finish_reason=length`). Use exact IDs when possible.                                                                                                                                                      |
| Other OpenRouter probes      | Laguna XS, Gemma 4, and Xing returned 429; Inkling Small returned 403 (harness restricted). Outcomes may change.                                                                                                                                                                                        |
| Groq GPT-OSS 20B             | Two account keys made concurrent calls (HTTP 200; 114/100 tokens). `code_interpreter` ran Python (603 tokens). Default urllib UA hit Cloudflare 403/1010; `Mozilla/5.0` worked. [Code execution](https://console.groq.com/docs/tool-use/built-in-tools/code-execution)                                  |
| Kilo pool failures           | `kilo-auto/free` and `recursive/flint-v1.0:free`: empty output; `nvidia/nemotron-3.5-super-vl:free`: HTTP 502. Latency was not recorded. These IDs remain quarantined in `scripts/free-model-pool.mjs`.                                                                                                 |

Free-model research returned false quota claims, including NVIDIA production use and Hugging Face credits; other suggested free API quotas lacked official sources. Treat answers as leads; verify quotas with provider docs.

## Other free capacity

Groq was probed; other rows are docs research, not account tests.

| Provider                         | Published free allowance/access                                                   | Notes                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenRouter                       | 50 free-model requests/day, 20/min; $10+ balance unlocks 1,000/day, still 20/min. | $10 is account balance, not tokens; failed calls count. [Limits](https://openrouter.ai/pricing/)                                                                                                         |
| Gemini API                       | Gemini 3.1 Flash-Lite lists free Standard and Batch input/output.                 | Project quotas apply. [Pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Limits](https://ai.google.dev/gemini-api/docs/rate-limits)                                                             |
| Google Antigravity CLI           | $0 Individual plan; dynamic weekly quota.                                         | CLI supports async subagents and `/usage`; Teamwork and third-party access are paid. [Plans](https://www.antigravity.google/docs/plans) · [Subagents](https://www.antigravity.google/docs/cli-subagents) |
| OpenCode Console                 | Multiple zero-price models, including Nemotron, MiniMax, GLM, DeepSeek, and MiMo. | Limited-time offers; free chat models run in OpenCode, not Codex/API clients. [Models](https://dev.opencode.ai/v2/docs/console/models/)                                                                  |
| NVIDIA NIM                       | Free hosted developer access for prototyping.                                     | May be rate limited; no fixed quota or unbounded gateway verified. [FAQ](https://docs.api.nvidia.com/nim/docs/product)                                                                                   |
| Groq                             | GPT-OSS 20B/120B: 30 RPM, 1,000 RPD, 8K TPM, 200K TPD.                            | Confirm current org limits. Prompt caching is supported for GPT-OSS. [Limits](https://console.groq.com/docs/rate-limits)                                                                                 |
| Alibaba Model Studio             | Eligible new accounts: typically 1M combined tokens/model for 90 days.            | Region/model eligibility applies; enable **Free Quota Only**. [Quota](https://help.aliyun.com/en/model-studio/new-free-quota)                                                                            |
| Cohere trial                     | 1,000 calls/month; North Mini Code: 20 RPM.                                       | [Limits](https://docs.cohere.com/v2/docs/rate-limits)                                                                                                                                                    |
| Cerebras                         | Free API tier; 8K context.                                                        | Numeric allowance not published. [Pricing](https://inference-docs.cerebras.ai/support/pricing)                                                                                                           |
| Mistral                          | Free mode, no card, limited monthly usage.                                        | Account-specific limits. [Free mode](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)                                                                           |
| Cloudflare Workers AI            | 10,000 neurons/day on Workers Free.                                               | Neurons are not tokens; some models require paid Workers. [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)                                                                      |
| Hugging Face Inference Providers | No free monthly credits.                                                          | Requires purchased credits or PRO. [Pricing](https://huggingface.co/docs/inference-providers/pricing)                                                                                                    |

## Usage notes

- Machine-local keys (mode `600`, never commit): `~/.config/groq/api_key` (account 1), `~/.config/groq/api_key_account2`, `~/.config/openrouter/api_key`. Load with `export GROQ_API_KEY="$(cat ~/.config/groq/api_key)" GROQ_API_KEY_2="$(cat ~/.config/groq/api_key_account2)" OPENROUTER_API_KEY="$(cat ~/.config/openrouter/api_key)"`. Run independent Groq jobs concurrently using the corresponding variable per worker.
- Batch large text sweeps into bounded independent chunks; ask for concise results with source links or paths.
- Groq uses `https://api.groq.com/openai/v1`. Python urllib's default user agent got Cloudflare `403/1010`; `User-Agent: Mozilla/5.0` worked. Limits are organization-wide across keys; keep each account within its limits and don't switch keys to bypass 429s. [Limits](https://console.groq.com/docs/rate-limits)
- Groq GPT-OSS 20B/120B offer server-side Python `code_interpreter` and `browser_search`. Code execution is ephemeral and isolated; it can run snippets, not access local files or execute this repository's test suite. [Built-in tools](https://console.groq.com/docs/tool-use/built-in-tools)
- OpenRouter reasoning tokens count against `max_tokens`. For optional reasoning, inspect model metadata; disabling it can prevent empty completions. Check content, `finish_reason`, and usage. [Reasoning docs](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- Gemini Batch and Groq prompt caching can reduce cost/throughput pressure where supported; check current quotas and cache-hit fields.
- Track limits by provider/model, honor `Retry-After`, and rotate providers after exhaustion. Do not rotate accounts or IPs to evade limits.
- Paid fallback examples: Groq GPT-OSS 120B $0.15/M input, $0.60/M output; Gemini 3.1 Flash-Lite $0.25/M input, $1.50/M output. Set a spend cap and disable automatic paid fallback. [Groq price](https://console.groq.com/docs/model/openai/gpt-oss-120b) · [Gemini price](https://ai.google.dev/gemini-api/docs/pricing)
