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

**HEAVILY USE FREE SUBAGENTS.** Fan out bounded, read-only research, review, and code-search
tasks across currently available free models (including OpenRouter Nemotron and Kilo Laguna)
instead of leaving free quota unused. Check `node scripts/free-model-pool.mjs --openrouter-quota`
before and after large OpenRouter-backed fan-outs; the server counter is authoritative for
daily usage. Keep the global limit of 15 simultaneous subagents, use the exact free model and
provider from the live catalog, and never silently fall back to a paid model.

## Provider Rules

- GPT models (Luna, Terra, and Sol) must always use `openai`: `task --model "<model>" --provider "openai"`.
- **Free-first:** Prefer free models for high-signal text sweeps (web research, docs, chat history, code search) and simple code writing or review. Batch large inputs into bounded chunks and return concise results with source paths or citations. Try another free source if one is unavailable or rate-limited; never silently fall through to a paid model.
- **Choose a free source:** Start with Kilo Laguna S (`poolside/laguna-s-2.1:free`) when present in the live catalog. `node scripts/free-model-pool.mjs --list` shows eligible Kilo/OpenRouter entries; every OpenRouter price field and conditional override must be zero. Numeric zero and fixed-point strings such as `0.000000000000` count as exact zero; no positive price is rounded down. Do not use models absent from the refreshed catalog or paid OpenRouter models without explicit approval.
- **Groq is last-resort only:** Requires `GROQ_API_KEY`, `--groq-free-plan-only`, and independent confirmation that this account is on Groq Free; never use it on a paid plan. The runner cannot verify billing tier, and Groq is not a native Kilo subagent provider.
- Pass `model` and `provider` together.
- Free sessions must not launch GPT subagents or perform Git operations.
- Kilo's anonymous free gateway currently documents 200 requests/hour per IP; account/IDE and provider limits may differ.
- Model names can be ambiguous between free and paid variants; use the full name with the `(free)` suffix (for example, `Reflection: Beam 1.0 (free)`).

## Free Model Rotation

For repeatable text sweeps or small independent review tasks, use `node scripts/free-model-pool.mjs --list` to refresh the eligible catalog. It reads public Kilo and OpenRouter catalogs without credentials for discovery; the JSON `configured` field means local credentials and any required Groq opt-in are present, not that quota or capacity is available. The runner accepts Kilo entries with `isFree` or `:free` and exact zero pricing; OpenRouter `:free` entries require exact-zero prompt/completion prices and no non-zero charge in any pricing field or conditional override. It fails closed on unknown non-zero pricing fields. It tries at most three eligible IDs per provider per run; HTTP 402/429 exhausts that provider for the invocation, while catalog failures skip the source. It never falls back to paid Kilo or OpenRouter entries. Groq is an explicit last-resort route disabled by default.

To run one bounded prompt, save it to a file and use `node scripts/free-model-pool.mjs --prompt-file /path/to/prompt.txt --max-tokens 1200`. The runner bounds prompt files and prompts, reads provider responses as streams, and caps catalog bodies at 8 MiB and completion bodies at 1 MiB. It verifies Kilo/OpenRouter eligibility from the live catalog; Groq eligibility requires an explicit Free-plan confirmation. A reported non-zero or invalid usage cost stops the run before another request. Missing usage is `null` and is not proof of a charge or free eligibility. Use `--output-file /path/to/result.txt` to keep results out of stdout. Keys are read from `OPENROUTER_API_KEY` and, for explicit last-resort Groq use, `GROQ_API_KEY`; never put them in arguments, prompt files, logs, or tracked files. Avoid confidential data and refresh catalogs before each run.

For multi-URL research sweeps, use `node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH --max-tokens N`. It accepts at most 20 HTTPS URLs on the standard port, caps each response at 512 KiB, each source at 10,000 characters, aggregate source text at 40,000 characters, and the serialized prompt at 120,000 characters. Input files, URL length, question length, redirect hops, and concurrency are bounded too. It accepts text responses only, fetches in bounded parallelism, treats fetched pages as untrusted prompt data, and writes the route plus summary to the output file. The caller reads the summary file, not the raw page content. It rejects credentials, credential-like query keys (including OAuth `code` and `state`, and callback `hmac` values), IP literals, local hostnames, and DNS answers outside conservative public-address ranges. Each HTTPS request pins its socket lookup to the validated DNS answers and keeps the URL hostname for TLS verification; redirects are validated and resolved again. Use trusted public hosts and do not include secret-bearing query values.

OpenCode Console free-tier chat models require the OpenCode app; its official docs direct other
clients to paid models or Go. This generic runner intentionally does not send an OpenCode key
or call its free-model endpoint. Prefer the directly price-verified OpenRouter `:free` catalog.
The OpenRouter `openrouter/free` router is also excluded: its concrete model is selected only
after a request, too late to prevent a paid charge.

`--list` is discovery-only: it includes the public OpenRouter catalog and marks entries
`configured: false` when the inference key is missing. A configured route can still be
unavailable or rate limited.

`node scripts/free-model-pool.mjs --openrouter-quota` reports the server's current
`free_model_daily_requests.used`, `limit`, and `remaining` values without making an inference
request. Query before and after large fan-outs: this account-wide snapshot includes usage by
other tools and concurrent agents, unlike per-run attempt counts. `--probe-openrouter-quota`
logs the before-snapshot and skips OpenRouter when no daily requests remain. It is a
point-in-time counter, not a report of the 20-RPM limit or upstream capacity, and can race with
other requests. A failed/malformed probe is unknown and never replaces model-price validation.
OpenRouter documents 50 requests/day below 10 lifetime credits purchased and 1,000 at the
10-credit tier; the limit is **not based on current balance**. Its docs note the higher ceiling
can begin one credit below the table threshold for rounding/top-up fees. The API's returned
`limit` is authoritative. The daily free-model counter resets at 00:00 UTC.
[OpenRouter limits](https://openrouter.ai/docs/api-reference/limits)

The runner deliberately sends no reasoning override. OpenRouter says `reasoning.exclude` only
hides reasoning from the response; reasoning tokens still count toward the output budget, while
some models require reasoning and reject disabling it. A non-empty response is accepted only
with `finish_reason: stop`; incomplete or empty outputs rotate to another candidate. Usage,
finish reason, and model are written with the result. A provider-reported non-zero or malformed
cost stops the run immediately; missing cost metadata is reported but cannot independently
prove that a provider charged zero. [OpenRouter reasoning docs](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)

On HTTP 402/429, the runner exhausts that provider for this invocation and does not immediately
retry it. If the response includes `Retry-After`, it is included in the error for the operator;
the runner does not sleep, persist cross-run cooldown state, or switch accounts/IPs to evade
limits. OpenRouter notes that 429 can represent a global free-model limit or an upstream
provider limit. [OpenRouter limit handling](https://openrouter.ai/docs/api-reference/limits)

Quarantine is source/model-specific and expires: six hours by default for a confirmed
model-specific rate limit, with an absolute maximum of 72 hours. Expired entries are ignored by
the pool even before pruning, so models re-enter ordinary catalog rotation instead of being
permanently excluded. The project-shared `.kilo/free-model-quarantine.json` works across managed
worktrees (`FREE_MODEL_QUARANTINE_FILE` overrides it). On first pool/CLI use, the three former
hard-coded Kilo quarantines are imported into the local state file for a final 72-hour review
window; subsequent release or expiry is explicit and persistent. A malformed state file fails
closed before catalog requests.
A 3-day review cadence is for checking reports and current catalog health, not extending every
quarantine. Use `npm run free:quarantine -- list|add|release|prune` and follow the read-only
`.skills/free-model-chat-sweep.md` procedure. Do not quarantine a model for a global daily quota,
context overflow, external API failure, or tool/orchestration error. Do not install an hourly/daily
scheduler until the documented cron-hang and cross-session singleton problems are resolved; the
current runner does not install jobs.

The runner is a completion client, not a tool-using agent. For Kilo repository subagents, use the live model/provider pair from the refreshed catalog with the native `task` tool, pass model and provider together, and inspect the child's resolved model. **Fan out free subagents heavily for independent read-only exploration and review; keep each bounded and never exceed 15 concurrent agents.** The coordinator owns edits and Git. If a free task is rate limited, use another exact free model/provider or stop; never silently use paid fallback. Codex model routing and launch mechanics differ; see [`docs/CODEX-ORCHESTRATION.md`](docs/CODEX-ORCHESTRATION.md). For mock coverage, run `npm run test -- scripts/__tests__/free-model-pool.test.mjs scripts/__tests__/free-model-pool-groq.test.mjs scripts/__tests__/free-model-pool-external.test.mjs scripts/__tests__/free-research.test.mjs`; run `node scripts/free-model-pool.mjs --openrouter-quota` to check server-side daily usage before and after large fan-outs.

## Token-Saving Research Protocol

When a task requires heavy web research (many URL fetches, code search across many files, or chat-history mining), the biggest avoidable token cost is often the **root conversation context**, not the free model's API call. Bulk research MUST use a free read-only subagent with a file-based concise handoff, or the bounded `free-research.mjs` runner for public URLs. The root does only narrow verification. If no verified free route is available, stop or obtain explicit operator authorization before using a paid route.

1. **Delegate to a free read-only subagent** when the host exposes a verified free route. Give it only the bounded question, evidence scope, and an exclusive summary-file path.
2. **The subagent writes a CONDENSED file**, not raw content: 5–10 evidence-backed bullets with URLs/session IDs and uncertainty.
3. **Root reads only the summary file** and performs narrow verification. A child reduces root context only if its tool output and final reply are concise; raw sources returned by the child still become root-context tokens.
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

  The caller reads `summary.md`, not the fetched pages. The helper handles public HTTPS URLs only; chat-history mining must use a free read-only delegate and a concise file handoff.

- **`--output-file` on `free-model-pool.mjs`** — for a single model call whose result would be large: write to a file instead of stdout to avoid loading it into conversation. Add `--output-file PATH` to any `--prompt-file` invocation.

- **`npm run test -- scripts/__tests__/free-model-pool.test.mjs scripts/__tests__/free-model-pool-groq.test.mjs scripts/__tests__/free-model-pool-external.test.mjs scripts/__tests__/free-research.test.mjs`** — run free-model pool and research tests.
