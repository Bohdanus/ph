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

## Provider Rules

- GPT models (Luna, Terra, and Sol) must always use `openai`: `task --model "<model>" --provider "openai"`.
- **Free-first:** Prefer free models for high-signal text sweeps (web research, docs, chat history, code search) and simple code writing or review. Batch large inputs into bounded chunks and return concise results with source paths or citations. Try another free source if one is unavailable or rate-limited; never silently fall through to a paid model.
- **Choose a free source:** Start with the verified Kilo Laguna S model (`poolside/laguna-s-2.1:free`) when it appears in the live catalog. Use `node scripts/free-model-pool.mjs --list` to inspect exact eligible Kilo and OpenRouter entries; require exact zero input/output prices and do not assume old model names or quotas are current. Do not use a model absent from the refreshed catalog. Do not use paid OpenRouter models without explicit approval.
- **Groq is opt-in, not a verified free route:** GPT-OSS 20B/120B are available on Groq's $0 Free plan with rate limits, and have per-token prices on its Developer plan. The runner cannot inspect the account's billing plan. Only pass `--groq-free-plan-only` after independently confirming the Groq Console account is on the Free plan; do not use that flag on a paid plan. The model ID allowlist does not prove zero price. Groq is not a native Kilo subagent provider; do not pass `provider: "groq"` to `task` without a live native-catalog match.
- Pass `model` and `provider` together.
- Free sessions must not launch GPT subagents or perform Git operations.
- Kilo's anonymous free gateway currently documents 200 requests/hour per IP; account/IDE and provider limits may differ.
- Model names can be ambiguous between free and paid variants; use the full name with the `(free)` suffix (for example, `Reflection: Beam 1.0 (free)`).

## Free Model Rotation

For repeatable text sweeps or small independent review tasks, use `node scripts/free-model-pool.mjs --list` to refresh the current eligible catalog. It reads Kilo's public gateway catalog and, when `OPENROUTER_API_KEY` is set, OpenRouter's catalog. The runner accepts only Kilo entries with `isFree` or `:free` and exact zero prompt/completion prices, and OpenRouter entries ending in `:free` with exact zero prices. It tries at most three eligible model IDs per provider per run, then rotates to the next provider. HTTP 402 or 429 immediately exhausts that provider. A catalog failure skips that source and keeps other sources available. It never retries a paid Kilo or OpenRouter entry. Groq is excluded unless both `GROQ_API_KEY` and the explicit `--groq-free-plan-only` attestation are supplied; the runner cannot verify the account plan.

To run one bounded prompt, save it to a file and use `node scripts/free-model-pool.mjs --prompt-file /path/to/prompt.txt --max-tokens 1200`. Add `--output-file /path/to/result.txt` to write the result to a file instead of stdout — this avoids loading a large response into the conversation context. An OpenRouter API key is read only from `OPENROUTER_API_KEY`; Groq additionally requires `GROQ_API_KEY` and the explicit free-plan flag described above. Do not place keys in prompt files, arguments, logs, or tracked files. Avoid sending confidential data: free inference terms and retention vary by upstream provider. Limits and catalogs change, so refresh the catalog for each run.

For multi-URL research sweeps, use `node scripts/free-research.mjs --prompt-file PATH --url-list PATH --output-file PATH --max-tokens N`. It accepts at most 20 public HTTPS URLs, limits each response to 512 KiB, each source to 10,000 characters, and combined source text to 40,000 characters. It fetches in bounded parallelism, condenses through an eligible free route, and writes the route plus summary to the output file. The caller reads the summary file, not the raw page content. Redirects are revalidated. It rejects common local hostnames and IP literals but does not pin DNS resolution; use only trusted public hosts and do not provide credential-bearing URLs.

OpenCode Console also currently lists zero-priced models, but its Console API requires a Console key and its free catalog includes limited-time offerings. Add it or another source to the runner only after checking its current official API endpoint, authentication requirements, and zero input and output prices. Product or IDE free access does not imply free API access. OpenRouter's `openrouter/free` router is not included because the runner requires the catalog to prove the price of each selected model explicitly.

The runner is a completion client, not a tool-using agent. For Kilo repository subagents, use the live model/provider pair from the refreshed catalog with the native `task` tool, pass model and provider together, and inspect the child session's resolved model. Keep free children read-only and give them bounded tasks; the coordinator owns edits and Git. If the native task tool reports rate exhaustion, choose a different eligible provider/model or stop when the list is exhausted. Do not use paid fallback. Codex model routing, context, and launch mechanics are different; see [`docs/CODEX-ORCHESTRATION.md`](docs/CODEX-ORCHESTRATION.md). For mock coverage, run `npm run test -- scripts/__tests__/free-model-pool.test.mjs`; for a live no-key Kilo catalog check, run `node scripts/free-model-pool.mjs --list --limit 5`. Live inference smoke checks should use a harmless non-sensitive prompt.

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
