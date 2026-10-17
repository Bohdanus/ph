# Models and Providers

## Recommended Models

| Rank | Model                           | Provider | Variant  | Use                                                                                                          |
| ---- | ------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| 0    | Laguna S (Poolside)             | kilo     | thinking | TOP model for use; rate limiting is sometimes enabled for it — when not rate limited, only use Laguna S free |
| 1    | Reflection: Beam 1.0 (free)     | kilo     | max      | Second choice after Laguna; fast but not as reliable — can hallucinate, so verify important results          |
| 2    | Stealth: Glyph Cluster (free)   | kilo     | xhigh    | Strong general-purpose free model                                                                            |
| 3    | Dots Studio: Dots3-Note Preview | kilo     | thinking | Reliable free review model                                                                                   |
| 4    | StepFun: Step 3.7 Flash         | kilo     | high     | Fast free model                                                                                              |

## Provider Rules

- GPT models (Luna, Terra, and Sol) must always use `openai`: `task --model "<model>" --provider "openai"`.
- I do not have an OpenRouter budget, so use only free or very low-cost models there when unavoidable. Never use it for GPT models.
- Pass `model` and `provider` together.
- Free sessions must not launch GPT subagents or perform Git operations.
- `kilo` provides 200 requests/hour per IP and requires no credits.
- Model names can be ambiguous between free and paid variants; use the full name with the `(free)` suffix (for example, `Reflection: Beam 1.0 (free)`).
