# Models & Providers — Quick Guide

## Free Model Ranking (bench: 2026-10-05, HANDOFF issue verification)

| Rank | Model (kilo provider)           | Variant  | Bench finding                                                         |
| ---- | ------------------------------- | -------- | --------------------------------------------------------------------- |
| 1    | Stealth: Glyph Cluster (free)   | xhigh    | Best overall; currently running here — strong for complex work        |
| 2    | NVIDIA: Nemotron 3 Ultra (free) | high     | Most thorough in prior bench; strong fallback                         |
| 3    | Dots Studio: Dots3-Note Preview | thinking | Consistent, caught nuanced partial fixes; less reliable than Nemotron |
| 4    | StepFun: Step 3.7 Flash         | high     | Fast, accurate                                                        |

Laguna S (Poolside) is the best provider-rated model but rate-limited — run max 1-2 simultaneously.
Laguna XS is weaker; avoid unless S is unavailable.

## GPT Subagent Setup

Use openrouter provider explicitly:

```
task --model "GPT Luna Latest" --provider "openrouter" --variant "xhigh" ...
```

Never route GPT through `kilo` provider.

## Constraints

- Free sessions must NEVER launch GPT subagents
- Free models = read-only research only; never Git operations
- Pass `model` + `provider` together

## Common Failures

| Failure                   | Cause                                           | Fix                                                |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Model name ambiguous      | "Nemotron 3 Ultra" matches free + paid variants | Use full name: `NVIDIA: Nemotron 3 Ultra (free)`   |
| Model not on provider     | "Space Bunny Alpha" not on kilo/openrouter      | Search via `agent_manager_models` first            |
| Rate limited              | Laguna/LiquidAI hits daily quota                | Retry after ~1m; don't parallelize past 1-2 Laguna |
| Credit-gated rejection    | Free tier exhausted                             | Swap to another free model with same task          |
| Free session launches GPT | Policy violation (free → paid)                  | Use openrouter provider for GPT                    |
