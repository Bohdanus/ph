# Models and Providers

## Paid Models (not free)

| Model  | Provider | Variant | Use                                            |
| ------ | -------- | ------- | ---------------------------------------------- |
| Luna 6 | openai   | xhigh   | MANDATORY: keep context size UNDER 272k tokens |

## Free Models

| Model                         | Provider | Variant  | Use                                                        |
| ----------------------------- | -------- | -------- | ---------------------------------------------------------- |
| Poolside: Laguna S 2.1 (free) | kilo     | thinking | Preferred when present in the current free catalog; verify |

Do not treat old model lists as current. For alternatives, query the live catalog and
select an exact model/provider pair with verified zero pricing.

**Use free models aggressively** for bounded, read-only text work. Quotas are provider-specific:
Kilo's anonymous gateway allows 200 requests/hour/IP; OpenRouter allows 1,000/day for accounts
with at least $10 in lifetime credits. The OpenRouter counter resets at 00:00 UTC and does not
measure Kilo usage. Other account, IDE, or provider limits may apply. Use exact free entries
from the live catalog, cap fan-out at 15 agents, and never silently fall back to paid.

## Provider Rules

- GPT models (Luna 6) must always use `openai`: `task --model "<model>" --provider "openai"`.
- **Free-first:** Prefer free models for high-signal text sweeps (web research, docs, chat history, code search) and simple code writing or review. Batch large inputs into bounded chunks and return concise results with source paths or citations. Try another free source if one is unavailable or rate-limited; never silently fall through to a paid model.
- **Choose a free source:** Start with Kilo Laguna S (`poolside/laguna-s-2.1:free`) when present in the live catalog. `node scripts/free-model-pool.mjs --list` shows eligible Kilo/OpenRouter entries; every OpenRouter price field and conditional override must be zero. Numeric zero and fixed-point strings such as `0.000000000000` count as exact zero; no positive price is rounded down. Do not use models absent from the refreshed catalog or paid OpenRouter models without explicit approval.
- **Manual Groq fallback (not in the runner):** For a confirmed Groq Free-plan account, use `GROQ_API_KEY` with the OpenAI-compatible API at `https://api.groq.com/openai/v1`, model `openai/gpt-oss-120b`, and `reasoning_effort: "low"` (tested to avoid empty replies at small output budgets). Published Free-plan limits are 30 RPM, 1,000 RPD, 8K TPM, and 200K TPD ([official limits](https://console.groq.com/docs/rate-limits)); limits are organization-wide and the account dashboard is authoritative. Groq's model catalog does not expose prices, so the runner cannot verify free pricing: use only as an explicit manual fallback, never automatic routing or paid fallback.
- Pass `model` and `provider` together.
- Free sessions must not launch GPT subagents or perform Git operations.
- **Deletion safety for free Kilo agents:** Kilo exposes tool-level permissions, not a delete-only permission. For visible Kilo sessions, use the project `read-only-research` agent in `.kilo/agent/read-only-research.md`; it denies `edit`, `bash`, `task`, external-directory access, and common file-mutating MCP tool names. For internal free `task` children, use the read-only `explore` role and verify there are no write/patch tools. Explicitly deny any connected MCP file-write/delete tools not covered by its name patterns; if the host cannot guarantee that boundary, use `free-model-pool.mjs` (a completion client without agent tools) or do not launch the free child. Free children return concise findings only; the coordinator writes files and owns all changes.
- Model names can be ambiguous between free and paid variants; use the full name with the `(free)` suffix (for example, `Reflection: Beam 1.0 (free)`).

## Free Model Rotation

Use `node scripts/free-model-pool.mjs --list` to refresh the eligible free catalog. The runner accepts Kilo `isFree`/`:free` entries and OpenRouter `:free` entries with exact-zero pricing only. It tries up to three eligible IDs per provider; HTTP 402/429 exhausts that provider. Never falls back to paid models.

**Bounded prompt:** `node scripts/free-model-pool.mjs --prompt-file /path/to/prompt.txt --max-tokens 1200 [--output-file /path/to/result.txt]`

**Multi-URL research:** `node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH --max-tokens N` (max 20 HTTPS URLs, 512 KiB/response, 40K aggregate chars)

**OpenRouter quota check:** `node scripts/free-model-pool.mjs --openrouter-quota` — reports `used`/`limit`/`remaining`. Query before/after large fan-outs; this does not report Kilo usage.

**Free model constraints:**

- Pass `model` and `provider` together
- Free sessions must not launch GPT subagents or perform Git operations
- **Deletion safety:** Use `read-only-research` agent for visible sessions; `explore` role for internal children. Deny `edit`, `bash`, write/patch tools. No delete-only permission exists — deny all mutations.
- Use full model name with `(free)` suffix to avoid ambiguity (e.g., `Reflection: Beam 1.0 (free)`)

**Quarantine:** source/model-specific, 6h default for confirmed rate limits, max 72h. Expired entries re-enter rotation. Use `npm run free:quarantine -- list|add|release|prune`. Do not quarantine for global quota, context overflow, external API failure, or tool/orchestration error. Schedule reviews with `cron_create`, not OS cron.

**Runner is a completion client, not a tool-using agent.** For repo research, use read-only `explore` role with exact free model/provider. **Never give free Kilo children file-writing, patching, or shell tools.** Deny `edit`, `bash`, write/patch tools. If read-only boundary cannot be verified, use completion runner or don't launch. Free children return concise findings; coordinator writes files and owns Git. Never silently fall back to paid. Cap at 15 concurrent agents.

Test: `npm run test -- scripts/__tests__/free-model-pool.test.mjs scripts/__tests__/free-model-pool-external.test.mjs scripts/__tests__/free-research.test.mjs`

## Token-Saving Research Protocol

When a task requires heavy web research (many URL fetches, code search across many files, or chat-history mining), the biggest avoidable token cost is often the **root conversation context**, not the free model's API call. Bulk research MUST use a free read-only subagent that returns a concise result, or the bounded `free-research.mjs` runner for public URLs. The root does narrow verification and writes any needed files. If no verified free route with read-only tools is available, stop or obtain explicit operator authorization before using a paid route.

1. **Delegate to a free read-only subagent** when the host exposes a verified free route. Give it only the bounded question and evidence scope; do not grant a free Kilo child write or shell tools.
2. **The child returns a CONDENSED result**, not raw content: 5–10 evidence-backed bullets with URLs/session IDs and uncertainty. The coordinator writes any summary file.
3. **Root reads only the concise result** and performs narrow verification. A child reduces root context only if its tool output and final reply are concise; raw sources returned by the child still become root-context tokens.
4. **Never do bulk `webfetch` or chat-history searches in root** when a free delegate or bounded file-based runner can do them. In the prior Codex research session, Exa's configured allowance returned HTTP 402 after about four searches and reported $10.01 used; treat that as an account-specific observed limit, not a universal Exa quota.

**Concrete tools:**

- **`scripts/free-research.mjs`** — for URL-based research: reads a prompt file and a URL list, fetches all URLs in parallel (bounded concurrency), condenses via a free model, and writes only the summary to `--output-file`. Usage:

  ```
  node scripts/free-research.mjs \
    --prompt-file ./prompt.txt \
    --url-list ./urls.txt \
    --output-file ./summary.md \
    --max-tokens 1500
  ```

  The caller reads `summary.md`, not the fetched pages. The helper handles public HTTPS URLs only; chat-history mining must use a free read-only delegate that returns concise findings for the coordinator to write.

- **`--output-file` on `free-model-pool.mjs`** — for a single model call whose result would be large: write to a file instead of stdout to avoid loading it into conversation. Add `--output-file PATH` to any `--prompt-file` invocation.

- **`npm run test -- scripts/__tests__/free-model-pool.test.mjs scripts/__tests__/free-model-pool-external.test.mjs scripts/__tests__/free-research.test.mjs`** — run free-model pool and research tests.
