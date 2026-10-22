# Models and Providers

## Paid Models (not free)

| Model  | Provider | Variant | Use                                            |
| ------ | -------- | ------- | ---------------------------------------------- |
| Luna 6 | openai   | xhigh   | MANDATORY: keep context size UNDER 272k tokens |

## Free Models

| Rank | Model                           | Provider | Variant  | Use                                                          |
| ---- | ------------------------------- | -------- | -------- | ------------------------------------------------------------ |
| 0    | Laguna S (Poolside)             | kilo     | thinking | TOP free model; only use Laguna S free                       |
| 1    | Reflection: Beam 1.0 (free)     | kilo     | max      | Fast free model; not fully tested — verify important results |
| 2    | Stealth: Glyph Cluster (free)   | kilo     | xhigh    | Strong general-purpose free model                            |
| 3    | Dots Studio: Dots3-Note Preview | kilo     | thinking | Less reliable; verify results                                |
| 4    | StepFun: Step 3.7 Flash         | kilo     | high     | Fast free model                                              |

## Provider Rules

- GPT models (Luna, Terra, and Sol) must always use `openai`: `task --model "<model>" --provider "openai"`.
- **Free-first:** Prefer free models for high-signal text sweeps (web research, docs, chat history, code search) and simple code writing or review. Batch large inputs into bounded chunks and return concise results with source paths or citations. Try another free source if one is unavailable or rate-limited; never silently fall through to a paid model.
- **Choose a free source:** Start with Kilo (`--provider "kilo"`), using `kilo-auto/free` or a live catalog entry explicitly marked `(free)`; Kilo usually has more free capacity than OpenRouter, but that can change. OpenRouter is also allowed for free work: use `--provider "openrouter"` with `openrouter/free` or a current model explicitly marked `:free`. Check the live catalog, exact provider/model pair, price, and limits before a sweep; do not assume an old model name is still free. Other free options include OpenCode Console models marked Free and local models through Ollama or LM Studio. Do not use paid OpenRouter models without explicit approval.
- Pass `model` and `provider` together.
- Free sessions must not launch GPT subagents or perform Git operations.
- Kilo's anonymous free gateway currently documents 200 requests/hour per IP; account/IDE and provider limits may differ.
- Model names can be ambiguous between free and paid variants; use the full name with the `(free)` suffix (for example, `Reflection: Beam 1.0 (free)`).

## Free Model Rotation

For repeatable text sweeps or small independent review tasks, use `node scripts/free-model-pool.mjs --list` to refresh the current eligible catalog. It reads Kilo's public gateway catalog and, when `OPENROUTER_API_KEY` is set, OpenRouter's catalog. The runner accepts only Kilo entries with `isFree` or `:free` and exact zero prompt/completion prices, and OpenRouter entries ending in `:free` with exact zero prices. It tries eligible models in catalog order and moves to the next provider after a provider reports HTTP 402 or 429. A catalog failure skips that source and keeps other sources available. It never retries through a paid model.

To run one bounded prompt, save it to a file and use `node scripts/free-model-pool.mjs --prompt-file /path/to/prompt.txt --max-tokens 1200`. The API key is optional and read only from `OPENROUTER_API_KEY`; don't place keys in prompt files, arguments, logs, or tracked files. Avoid sending confidential data: free inference terms and retention vary by upstream provider. Kilo documents anonymous free access at 200 requests/hour/IP; OpenRouter currently lists 50 requests/day on its free plan. Limits and catalogs change, so refresh the catalog for each run.

OpenCode Console also currently lists zero-priced models, but its Console API requires a Console key and its free catalog includes limited-time offerings. Add it or another source to the runner only after checking its current official API endpoint, authentication requirements, and zero input and output prices. Product or IDE free access does not imply free API access. OpenRouter's `openrouter/free` router is not included because the runner requires the catalog to prove the price of each selected model explicitly.

The runner is a completion client, not a tool-using agent. For actual repository subagents, use the live model/provider pair from the refreshed catalog with the native `task` tool, pass model and provider together, and inspect the child session's resolved model. Keep free children read-only and give them bounded tasks; the coordinator owns edits and Git. If the native task tool reports rate exhaustion, choose a different eligible provider/model or stop when the list is exhausted. Do not use paid fallback. For mock coverage, run `npm run test -- scripts/__tests__/free-model-pool.test.mjs`; for a live no-key Kilo catalog check, run `node scripts/free-model-pool.mjs --list --limit 5`. Live inference smoke checks should use a harmless non-sensitive prompt.
