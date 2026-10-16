# Models and Providers

## Free Model Ranking

Bench: 2026-10-05, HANDOFF issue verification.

| Rank | Model (kilo provider)           | Variant  | Bench finding                                                            |
| ---- | ------------------------------- | -------- | ------------------------------------------------------------------------ |
| 1    | Stealth: Glyph Cluster (free)   | xhigh    | Best overall; currently running here; strong for complex work            |
| 2    | NVIDIA: Nemotron 3 Ultra (free) | high     | Most thorough in prior bench; strong fallback                            |
| 3    | Dots Studio: Dots3-Note Preview | thinking | Consistent and caught nuanced partial fixes; less reliable than Nemotron |
| 4    | StepFun: Step 3.7 Flash         | high     | Fast and accurate                                                        |

Laguna S (Poolside) is the best provider-rated model but is rate-limited; run at most 1-2 simultaneously.
Laguna XS is weaker; avoid it unless S is unavailable.

## Providers

| Provider | Free quota        | Notes                           |
| -------- | ----------------- | ------------------------------- |
| kilo     | 200 req/hour (IP) | No credits needed; may log data |

## GPT Subagent Setup

GPT models (Luna, Terra, and Sol) must always use the OpenAI provider. Launch them with `task --model "<model>" --provider "openai"`.

I do not have an OpenRouter budget, so use only free or very low-cost models there when OpenRouter is unavoidable. Do not select it for GPT models.

## Constraints

- Free sessions must never launch GPT subagents.
- Free-model sessions are for read-only research; they must not perform Git operations.
- Pass `model` and `provider` together.

## Common Failures

| Failure              | Cause                                  | Fix                                            |
| -------------------- | -------------------------------------- | ---------------------------------------------- |
| Model name ambiguous | "Nemotron 3 Ultra" matches free + paid | Use full name with `(free)` suffix             |
| Rate limited         | Laguna/IP quota hit                    | Retry after about 1 minute; max 1-2 concurrent |
