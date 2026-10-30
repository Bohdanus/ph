# Free-compute operations

Current operating instructions for the free-model runner. Historical measurements belong in
[`FREE-COMPUTE.md`](FREE-COMPUTE.md).

## Find credentials safely

If the operator says credentials were saved, search the relevant local chat before concluding they
are absent: use [Kilo chat history](../.skills/kilo-chat-history.md) or [Codex chat history](../.skills/codex-chat-history.md).
Never print key files, dump the environment, include credentials in prompts, or copy secret values
into logs. Report only the provider, path, and whether authentication is available.

## Kilo Code

The Kilo route uses the CLI bundled with the Kilo Code extension and its saved Gateway OAuth. The
runner searches extension folders as well as `PATH`; `KILO_CLI` overrides discovery. It invokes the
tool-free `free-completion` profile with `--pure` and pipes prompts through stdin. The child gets
only Kilo runtime variables; other provider keys and `KILO_CONFIG_CONTENT` are excluded. Do not
add `--auto`. The runner requires clean text output and rejects tool events or nonzero cost.
`kilo auth list` shows provider names; never read or print the auth database. Kilo has no
`--max-tokens` flag, so that option is only a response-length instruction for this route.

## OpenRouter

OpenRouter inference uses `OPENROUTER_API_KEY` from the runner process. The runner neither reads
Kilo's saved OpenRouter credential nor prints the API key. Use a secret manager or an existing
protected environment setup to provide it. Check the account's daily counter without inference:

```sh
node scripts/free-model-pool.mjs --openrouter-quota
```

The runner requires exact-zero OpenRouter models and tries Laguna S 2.1 first. HTTP 401/402
exhausts OpenRouter. On HTTP 429, a zero OpenRouter platform `X-RateLimit-Remaining` header exhausts the source for
that run; otherwise it checks the daily counter, tries another free model while requests remain,
and stops at zero. An unavailable counter stays within the three-model cap. This account has a
1,000/day quota; the snapshot does not include the separate 20/minute limit. Laguna receives at
least 1,024 output tokens. See [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits).

## Groq

Inference reads one `GROQ_API_KEY` or comma-separated `GROQ_API_KEYS` from the protected process
environment. It rotates supplied keys on HTTP 401/402/429. Groq limits are organization-level;
only supply confirmed distinct organizations because the runner cannot verify key ownership.
Inference does not load saved key files. `--probe-groq` discovers and probes
`~/.config/groq/api_key*` for authentication only; it does not verify Free-plan status. Set
`GROQ_FREE_PLAN=1` only for confirmed Free-plan accounts. GPT-OSS 120B is very fast but weak at
reasoning; use it only for bulk text sweeps such as chat search/history. See [Groq limits](https://console.groq.com/docs/rate-limits).

## Runner commands

```sh
node scripts/free-model-pool.mjs --list
node scripts/free-model-pool.mjs --prompt-file ./prompt.txt --max-tokens 1200 --output-file ./result.txt
node scripts/free-model-pool.mjs --openrouter-quota
node scripts/free-research.mjs --prompt-file ./prompt.txt --url-list ./urls.txt --output-file ./summary.md --max-tokens 1500
```

The usable order is Kilo, OpenRouter, then Groq; the optional OpenCode adapter is not available
here (no CLI, and its prior free request returned 429). The pool tries at most three models per
provider and never falls back to paid models. `--list` reads catalogs, not quota or capacity. See
[MODELS.md](../MODELS.md) for limits. Failures do not sleep or retry the same model/key; errors
include `Retry-After` when provided. The URL runner accepts at most 20 public HTTPS URLs;
quarantine commands are `npm run free:quarantine -- list|add|release|prune`.
