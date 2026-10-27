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

- Refresh candidates with `node scripts/free-model-pool.mjs --list`. Kilo/OpenRouter require exact-zero prices, OpenCode requires provider-owned `-free` IDs, and Groq allows only `openai/gpt-oss-120b` after explicit Free-plan opt-in.
- Never silently fall back to paid inference. The runner tries up to three eligible models per source; a provider quota or rate-limit failure exhausts that source for the run.
- In Kilo tasks, pass `model` and `provider` together; GPT models use `openai`. Free sessions must not launch GPT children or perform Git operations.

## Free-agent boundaries

- Free Kilo children are read-only: use `read-only-research` for visible sessions and `explore` for internal tasks. Deny shell, edit, write, patch, and all connected file-mutation tools. If the host cannot verify this boundary, use the completion runner or do not launch the child.
- The completion runner has no agent tools. The coordinator owns file edits and Git; cap fan-out at 15.
- Use concise evidence-backed results. For large outputs, use `--output-file`; use `free-research.mjs` only for bounded public HTTPS URL lists.

## Research and credentials

Bulk web, code, or chat-history research must use a verified free read-only route and return a short result for root verification. If none is available, stop before paid research. For secure credential discovery, provider setup, quotas, and runner commands, see [`docs/FREE-COMPUTE-OPERATIONS.md`](docs/FREE-COMPUTE-OPERATIONS.md).
