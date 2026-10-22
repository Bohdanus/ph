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
