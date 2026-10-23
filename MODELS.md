# Models and Providers

## Paid Models (not free)

| Model  | Provider | Variant | Use                                            |
| ------ | -------- | ------- | ---------------------------------------------- |
| Luna 6 | openai   | xhigh   | MANDATORY: keep context size UNDER 272k tokens |

## Free Models

| Rank | Model                           | Provider | Variant  | Use                                                          |
| ---- | ------------------------------- | -------- | -------- | ------------------------------------------------------------ |
| 0    | Poolside: Laguna S 2.1 (free)   | kilo     | thinking | TOP free model; use this exact free catalog entry            |
| 1    | Reflection: Beam 1.0 (free)     | kilo     | max      | Fast free model; not fully tested — verify important results |
| 2    | Stealth: Glyph Cluster (free)   | kilo     | xhigh    | Strong general-purpose free model                            |
| 3    | Dots Studio: Dots3-Note Preview | kilo     | thinking | Less reliable; verify results                                |
| 4    | StepFun: Step 3.7 Flash         | kilo     | high     | Fast free model                                              |

## Provider Rules

- GPT models (Luna, Terra, and Sol) must always use `openai`: `task --model "<model>" --provider "openai"`.
- **Free-first:** Prefer free models for high-signal text sweeps (web research, docs, chat history, code search) and simple code writing or review. Batch large inputs into bounded chunks and return concise results with source paths or citations. Try another free source if one is unavailable or rate-limited; never silently fall through to a paid model.
- **Choose a free source:** Start with the verified Kilo Laguna S model (`poolside/laguna-s-2.1:free`) when available; Kilo usually has more free capacity than OpenRouter, but that can change. Do not use the quarantined Kilo IDs (documented in `docs/FREE-COMPUTE.md`) unless they are deliberately requalified. OpenRouter is also allowed for free work: use `--provider "openrouter"` with a current model explicitly marked `:free`. Check the live catalog, exact provider/model pair, price, and limits before a sweep; do not assume an old model name is still free. Other remote options include Gemini API, OpenCode Console, Google Antigravity, and NVIDIA NIM; current limits and data terms are in `docs/FREE-COMPUTE.md`, a broad dated research library not linked from routine docs. Do not use paid OpenRouter models without explicit approval.
- **Direct API free routes:** Groq offers free GPT-OSS 20B/120B via its OpenAI-compatible API when `GROQ_API_KEY` is set. Current limits and key setup are in `docs/FREE-COMPUTE.md`. Groq is a direct API route, not a native Kilo subagent provider — do not assume `provider: "groq"` works in `task` without a live native catalog match. Kilo's `free-model-pool.mjs` now includes Groq when `GROQ_API_KEY` is present.
- Pass `model` and `provider` together.
- Free sessions must not launch GPT subagents or perform Git operations.
- Kilo's anonymous free gateway currently documents 200 requests/hour per IP; account/IDE and provider limits may differ.
- Model names can be ambiguous between free and paid variants; use the full name with the `(free)` suffix (for example, `Reflection: Beam 1.0 (free)`).

## Free Model Rotation

For repeatable text sweeps or small independent review tasks, use `node scripts/free-model-pool.mjs --list` to refresh the current eligible catalog. It reads Kilo's public gateway catalog and, when `OPENROUTER_API_KEY` is set, OpenRouter's catalog, and when `GROQ_API_KEY` is set, Groq's model list. The runner accepts only Kilo entries with `isFree` or `:free` and exact zero prompt/completion prices, OpenRouter entries ending in `:free` with exact zero prices, and Groq entries matching the known free GPT-OSS model IDs. It tries at most three eligible model IDs per provider per run, then rotates to the next provider. HTTP 402 or 429 immediately exhausts that provider. A catalog failure skips that source and keeps other sources available. It never retries through a paid model.

To run one bounded prompt, save it to a file and use `node scripts/free-model-pool.mjs --prompt-file /path/to/prompt.txt --max-tokens 1200`. Add `--output-file /path/to/result.txt` to write the result to a file instead of stdout — this avoids loading the model's response into the conversation context, a critical token-saving measure for large outputs. The API key is optional and read only from `OPENROUTER_API_KEY` and `GROQ_API_KEY`; don't place keys in prompt files, arguments, logs, or tracked files. Avoid sending confidential data: free inference terms and retention vary by upstream provider. Kilo documents anonymous free access at 200 requests/hour/IP; OpenRouter currently lists 50 requests/day on its free plan. Limits and catalogs change, so refresh the catalog for each run.

For multi-URL research sweeps, use `node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH --max-tokens N`. This is the **token-saving research protocol** (see below): the script fetches all URLs in parallel, condenses them via a free model, and writes only the condensed summary to the output file. The caller reads the summary file, not the raw web content.

OpenCode Console also currently lists zero-priced models, but its Console API requires a Console key and its free catalog includes limited-time offerings. Add it or another source to the runner only after checking its current official API endpoint, authentication requirements, and zero input and output prices. Product or IDE free access does not imply free API access. OpenRouter's `openrouter/free` router is not included because the runner requires the catalog to prove the price of each selected model explicitly.

The runner is a completion client, not a tool-using agent. For Kilo repository subagents, use the live model/provider pair from the refreshed catalog with the native `task` tool, pass model and provider together, and inspect the child session's resolved model. Keep free children read-only and give them bounded tasks; the coordinator owns edits and Git. If the native task tool reports rate exhaustion, choose a different eligible provider/model or stop when the list is exhausted. Do not use paid fallback. Codex model routing, context, and launch mechanics are different; see [`docs/CODEX-ORCHESTRATION.md`](docs/CODEX-ORCHESTRATION.md). For mock coverage, run `npm run test -- scripts/__tests__/free-model-pool.test.mjs`; for a live no-key Kilo catalog check, run `node scripts/free-model-pool.mjs --list --limit 5`. Live inference smoke checks should use a harmless non-sensitive prompt.

## Token-Saving Research Protocol

When a task requires heavy web research (many URL fetches, code search across many files, or chat-history mining), the biggest token cost is the **root conversation context**, not the free model's API call. The protocol below keeps large content out of the conversation:

1. **Delegate to a free read-only subagent** (`task` with a free model). The subagent has its own context window; its raw fetches never enter root context.
2. **The subagent writes a CONDENSED file**, not raw content. A brief question + 5–10 bullet evidence-backed findings with URL/citation, written to a path the root owns.
3. **Root reads only the file.** Never re-fetch or re-read the raw sources in root.
4. **Never do bulk `webfetch` in root.** A prior Codex chat that did 20+ `webfetch` calls directly in context burned far more tokens than the free model calls themselves; the search-tool allowance was exhausted ($10/month Exa) before the research finished.

**Concrete tools:**

- **`scripts/free-research.mjs`** — for URL-based research: reads a prompt file and a URL list, fetches all URLs in parallel (bounded concurrency), condenses via a free model, and writes only the summary to `--output-file`. Usage:

  ```
  node scripts/free-research.mjs \
    --prompt-file ./prompt.txt \
    --url-list ./urls.txt \
    --output-file ./summary.md \
    --max-tokens 1500
  ```

  The caller reads `summary.md`, not the 20 fetched pages.

- **`--output-file` on `free-model-pool.mjs`** — for a single model call whose result would be large: write to a file instead of stdout to avoid loading it into conversation. Add `--output-file PATH` to any `--prompt-file` invocation.

- **`npm run test -- scripts/__tests__/free-model-pool.test.mjs scripts/__tests__/free-model-pool-groq.test.mjs scripts/__tests__/free-research.test.mjs`** — run all free-model pool + research tests.

## Quota-Aware Subagents

Before **each** subagent launch, read the newest swarm reading with
`npm run swarm -- tokens --json`; do not reuse a reading from before another
subagent was launched. The board sums per-message session-DB usage against an
operator-set budget; its remaining tokens and next-expiry time are rough estimates,
not an authoritative account balance/reset. `reset_at` estimates the oldest
matching message rolling out of the window; `resetAtEstimated` marks this clearly.
If the reading is absent, older than 90 minutes, incomplete, unbudgeted or otherwise
uncertain, fail closed and prefer a free subagent; treat an unknown reset as not near.

For routing, "low allowance" means 20% or less of the configured five-hour token
budget remains; "reset is near" means the estimated next expiry is 60 minutes or
less. When allowance is low and the estimated expiry is more than 60 minutes away
(or unknown), launch a free model by default. Consider paid Luna only when no
suitable free model can do the task, and state that reason before launch. **Do not
launch Terra or Sol as a subagent in this low-allowance state.**

The only strong override is an explicit instruction from the operator in the
current conversation that names Terra or Sol for the specific subtask and
acknowledges the remaining-budget risk. A general request for rigor, a prior
conversation, a model recommendation from another agent, or an ambiguous request
does not override this rule. Do not infer an override or ask an agent to provide
one on the operator's behalf.
