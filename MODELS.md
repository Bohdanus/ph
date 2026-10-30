# Models and Providers

## Current defaults

| Model                         | Provider | Variant    | Use                                        |
| ----------------------------- | -------- | ---------- | ------------------------------------------ |
| Luna 6                        | `openai` | `xhigh`    | Paid; keep context under 272k tokens       |
| Poolside: Laguna S 2.1 (free) | `kilo`   | `thinking` | Preferred when present in the live catalog |

Use live catalogs, not stale model lists. Prefer verified free models for bounded research,
text sweeps, code search, and simple reviews. If no free route is available, stop or get explicit
operator authorization before using paid inference.

## Routing

- Refresh with `node scripts/free-model-pool.mjs --list`; catalog eligibility does not prove quota or capacity. Usable routes are Kilo, OpenRouter, then Groq.
- The Kilo route uses the extension-discovered `kilo` CLI and saved Gateway OAuth; it is needed only for Kilo. `KILO_CLI` overrides discovery. Its tool-free `free-completion` profile runs with `--pure`; the child environment excludes other provider keys and `KILO_CONFIG_CONTENT`. Do not add `--auto`.
- Kilo treats `--max-tokens` as a response-length instruction; OpenRouter and Groq enforce it provider-side.
- OpenRouter requires `OPENROUTER_API_KEY`, exact-zero pricing, and tries Laguna S 2.1 first with at least 1,024 output tokens. HTTP 401/402 exhausts the source. On HTTP 429, a zero OpenRouter platform `X-RateLimit-Remaining` header exhausts it for the run; otherwise the daily counter controls model rotation. Unknown counters stay within the three-model cap.
- Groq uses only `openai/gpt-oss-120b` after `GROQ_FREE_PLAN=1`. Inference reads `GROQ_API_KEY` or comma-separated `GROQ_API_KEYS` and rotates supplied keys on 401/402/429. Groq limits are organization-level; configure only confirmed distinct organizations. Inference does not load saved key files; `--probe-groq` probes them.
- An optional OpenCode CLI adapter remains in code, but this host has no `opencode` executable and its prior free-model completion returned `provider.free-limit` 429. Do not count it as a usable route until a free completion succeeds.
- Catalog/quota requests time out after 15 seconds; inference after five minutes. Never fall back silently to paid models. In Kilo tasks, pass `model` and `provider` together; GPT models use `openai`. Free sessions must not launch GPT children or perform Git operations.

## Provider-specific free quotas

A provider name alone does not establish that a route is free. Verify the exact model/provider pair and its quota:

| Provider ID  | Free limit                                    | Notes                                                                                        |
| ------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `kilo`       | 200 requests per hour per IP.                 | `--openrouter-quota` does not read Kilo's separate limit.                                    |
| `openrouter` | 20 requests per minute; 1,000 per day here.   | Quota probe reads a point-in-time daily counter only.                                        |
| `groq`       | GPT-OSS 120B: 30 RPM; 1,000 requests per day. | Free plan; organization-level. See [Groq limits](https://console.groq.com/docs/rate-limits). |

OpenRouter's daily counter does not report its 20-per-minute cap. Another Groq key from the same organization does not add quota. See [Kilo's gateway limits](https://kilo.ai/docs/gateway/usage-and-billing) and [OpenRouter's limits](https://openrouter.ai/docs/api-reference/limits).

### Groq

GPT-OSS is very fast but weak at reasoning. Reserve Groq for bulk text sweeps such as chat search and chat-history processing, not deep reasoning or code review. See [`docs/FREE-COMPUTE-OPERATIONS.md`](docs/FREE-COMPUTE-OPERATIONS.md) for key handling.

## Free-agent boundaries

- Free Kilo children are read-only: use `read-only-research` for visible sessions and `explore` for internal tasks. Deny shell, edit, write, patch, and all connected file-mutation tools. If the host cannot verify this boundary, use the completion runner or do not launch the child.
- The completion runner has no agent tools. Its Kilo CLI profile denies every tool name, pipes
  prompts through stdin, and never uses `--file` or `--auto`; the coordinator owns file edits and
  Git. Cap fan-out at 15.
- Use concise evidence-backed results. For large outputs, use `--output-file`; use `free-research.mjs` only for bounded public HTTPS URL lists.

## Research and credentials

Bulk web, code, or chat-history research must use a verified free read-only route and return a short result for root verification. If none is available, stop before paid research. For secure credential discovery, provider setup, and runner commands, see [`docs/FREE-COMPUTE-OPERATIONS.md`](docs/FREE-COMPUTE-OPERATIONS.md).
