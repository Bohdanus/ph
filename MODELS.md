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

- Inference attempts providers in this order: Kilo, OpenRouter, Groq, then OpenCode. Catalog checks
  can run in parallel; inference is sequential. A provider is skipped unless its route is configured
  and its model is currently verified free.
- Refresh candidates with `node scripts/free-model-pool.mjs --list`. Check the exact model/provider pair: Kilo and OpenRouter require exact-zero prices, OpenCode requires provider-owned `-free` IDs, and Groq allows only `openai/gpt-oss-120b` after explicit Free-plan opt-in.
- The runner sends Kilo inference through the installed Kilo Code CLI, so its saved Kilo Gateway OAuth is used. It searches `PATH` and common editor extension directories; set `KILO_CLI` only when discovery misses the executable. The child receives runtime paths but not other provider credentials or `KILO_CONFIG_CONTENT`; the tool-free `free-completion` agent and `--pure` mode block agent tools and external plugins.
- The Kilo CLI has no `--max-tokens` option. The runner's `--max-tokens` value is a response-length instruction for Kilo; the CLI/model controls the actual generation budget. OpenRouter and Groq receive a provider-side token limit.
- OpenRouter inference uses `OPENROUTER_API_KEY`. When Laguna S 2.1 appears in that live catalog, the runner tries it first, then preserves the catalog order. `--openrouter-quota` requires the same environment key; Kilo's locally stored OpenRouter credential is not read by the runner.
- OpenRouter Laguna receives at least 1,024 completion tokens so reasoning does not consume a tiny caller budget before a visible answer. The other OpenRouter models receive the requested `--max-tokens` value.
- Never silently fall back to paid inference. The runner tries up to three eligible models per source; a provider quota or rate-limit failure exhausts that source for the run.
- Catalog and quota requests have a 15-second timeout. Model inference has a five-minute timeout so reasoning models are not cut off by a catalog-sized deadline.
- In Kilo tasks, pass `model` and `provider` together; GPT models use `openai`. Free sessions must not launch GPT children or perform Git operations.

## Provider-specific free quotas

A provider name alone does not establish that a route is free. Verify the exact model/provider pair in the live catalog. Kilo and OpenRouter use separate free-model quotas:

| Provider ID  | Published free-model limit                                                         | What the quota check covers                                                                  |
| ------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `kilo`       | 200 requests per hour per IP, for authenticated and anonymous free-model requests. | `--openrouter-quota` does not read this Kilo gateway limit.                                  |
| `openrouter` | 20 requests per minute; 1,000 per day.                                             | `node scripts/free-model-pool.mjs --openrouter-quota` reads OpenRouter's daily counter only. |

A 429 or exhausted counter applies to the provider that returned it. Stop using that source for the run, and switch only to another model/provider pair verified as free. See [Kilo's gateway rate limits](https://kilo.ai/docs/gateway/usage-and-billing) and [OpenRouter's pricing and rate limits](https://openrouter.ai/pricing) for current published limits.

## Free-agent boundaries

- Free Kilo children are read-only: use `read-only-research` for visible sessions and `explore` for internal tasks. Deny shell, edit, write, patch, and all connected file-mutation tools. If the host cannot verify this boundary, use the completion runner or do not launch the child.
- The completion runner has no agent tools. Its Kilo CLI profile denies every tool name, pipes
  prompts through stdin, and never uses `--file` or `--auto`; the coordinator owns file edits and
  Git. Cap fan-out at 15.
- Use concise evidence-backed results. For large outputs, use `--output-file`; use `free-research.mjs` only for bounded public HTTPS URL lists.

## Research and credentials

Bulk web, code, or chat-history research must use a verified free read-only route and return a short result for root verification. If none is available, stop before paid research. For secure credential discovery, provider setup, and runner commands, see [`docs/FREE-COMPUTE-OPERATIONS.md`](docs/FREE-COMPUTE-OPERATIONS.md).
