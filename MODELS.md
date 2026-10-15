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

## Providers

| Provider   | Free quota        | Notes                           |
| ---------- | ----------------- | ------------------------------- |
| kilo       | 200 req/hour (IP) | No credits needed; may log data |
| openrouter | 50 req/day        | Need $10+ credits for 1K/day    |

## GPT Subagent Setup

GPT models (Luna, Terra, Sol) are paid — use openrouter provider with `task --model "<model>" --provider "openrouter"`.

## Constraints

- Free sessions must NEVER launch GPT subagents
- Free models = read-only research only; never Git operations
- Pass `model` + `provider` together

## Common Failures

| Failure              | Cause                                  | Fix                                    |
| -------------------- | -------------------------------------- | -------------------------------------- |
| Model name ambiguous | "Nemotron 3 Ultra" matches free + paid | Use full name with `(free)` suffix     |
| Rate limited         | Laguna/IP quota hit                    | Retry after ~1m; max 1-2 concurrent    |
| Credit-gated         | OpenRouter 50 req/day exhausted        | Use kilo provider instead (200 req/hr) |
