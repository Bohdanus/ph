# Free-compute operations

Current operating instructions for the free-model runner. Historical measurements belong in
[`FREE-COMPUTE.md`](FREE-COMPUTE.md).

## Model preferences

| Model                               | Rating      | Notes                                                                          |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| **NVIDIA Nemotron 3 Ultra (free)**  | **Best**    | Strong reasoning, reliable completions, preferred for all free inference tasks |
| **XingChen Xing4.0 29B A4B (free)** | Alternative | Works for simple prompts; hits 429 under load                                  |
| **Poolside Laguna (free)**          | Turned off  | Rate-limited (429s), unreliable                                                |

## Find credentials safely

If the operator says credentials were saved, search the relevant local chat before concluding they
are absent: use [Kilo chat history](../.skills/kilo-chat-history.md) or [Codex chat history](../.skills/codex-chat-history.md).
Never print key files, dump the environment, include credentials in prompts, or copy secret values
into logs. Report only the provider, path, and whether authentication is available.

## Kilo Code

The runner uses `kilo run` for Kilo inference, which picks up the logged-in Kilo Gateway OAuth
account used by the Kilo Code extension. It discovers `kilo` on `PATH` and then checks common VS
Code, Cursor, and Windsurf extension folders. If discovery misses the installed CLI, set
`KILO_CLI` to its executable path. Check saved provider names with `kilo auth list`; never read or
print the Kilo auth database or JSON file.

`kilo run` starts with `--pure` and the tracked `free-completion` agent. That profile denies every
tool name. The prompt is piped through stdin, keeping it out of process arguments and avoiding
Kilo's file-attachment and external-directory permission checks. Do not add `--auto`: it would
broaden permissions beyond the tool-free profile. The runner verifies a clean JSON completion,
rejects tool events and reported non-zero cost, and allows up to five minutes for inference. It
uses the public Kilo catalog only for model and exact-zero price discovery; it does not send
inference requests anonymously to the public Gateway endpoint. The child environment is limited to
runtime paths and locale settings, including the Kilo database selector; unrelated provider keys
and `KILO_CONFIG_CONTENT` are not passed through.

The current Kilo CLI has no `--max-tokens` option. For Kilo completions, the runner's
`--max-tokens` value is a response-length instruction; Kilo and the model control the actual
generation budget. The OpenRouter and Groq routes send a provider-side token limit.

## OpenRouter

OpenRouter inference uses `OPENROUTER_API_KEY` from the runner process. The runner neither reads
Kilo's saved OpenRouter credential nor prints the API key. Use a secret manager or an existing
protected environment setup to provide it. Check the account's daily counter without inference:

```sh
node scripts/free-model-pool.mjs --openrouter-quota
```

The runner refreshes OpenRouter's public catalog, requires exact-zero pricing, tries Nemotron 3 Ultra
first when it is present, then XingChen Xing4.0 as alternative. HTTP 401/402 exhaust the provider for the run; an inference HTTP 429 does
so only when rate-limit headers or the daily counter show no requests remaining. Otherwise, the
runner rotates among verified-free models within its per-run cap. A 429 from the quota endpoint is
treated as an unknown counter, not proof that inference is exhausted. Inference gets five minutes;
catalog and quota requests keep a separate 15-second timeout. A quota snapshot is only current at
the time it was read and can change when other tools use the account.
OpenRouter Nemotron 3 Ultra receives at least 1,024 completion tokens so reasoning has room to finish; other
models use the requested token limit.

## OpenCode

The runner calls `opencode run` through the OpenCode CLI; it does not call a generic model HTTP API.
The desktop UI is not required when the CLI is installed. Check authentication with `opencode auth
list` and locate the active data store with `opencode debug paths db`. OpenCode releases may store
credentials in `~/.local/share/opencode/opencode.db` or the older `auth.json`; `opencode.jsonc` is
configuration, not proof that credentials are absent. Do not inspect credential values in the
database or auth file. See the [OpenCode CLI auth guide](https://opencode.ai/docs/cli/) and
[storage guide](https://opencode.ai/docs/troubleshooting/).

The runner accepts only provider-owned model IDs ending in `-free`, denies tool use, and requires
a clean CLI exit with non-empty text. OpenCode CLI JSON output can omit its final `step_finish`
event; a clean exit, text response, and free catalog ID are sufficient when no explicit error,
tool call, or non-zero cost was reported. A provider 429 means its free quota is exhausted for now.

## Groq

The runner reads `GROQ_API_KEY` from its process environment; it does not read key files itself.
This machine's saved-key convention is `~/.config/groq/api_key` and `~/.config/groq/api_key_*`.
Choose the intended account; do not rotate through account files automatically. A successful
`/models` request proves the key is accepted, not that the organization is on Groq's Free plan.

For a confirmed Free-plan organization, load the selected key only into the runner process:

```sh
GROQ_API_KEY="$(cat "$HOME/.config/groq/api_key")" \
GROQ_FREE_PLAN=1 \
node scripts/free-model-pool.mjs --prompt-file ./prompt.txt --max-tokens 1200 --output-file ./result.txt
```

Replace the file path with the selected account's file. Set `GROQ_FREE_PLAN=1` only after the
account dashboard confirms Free tier; an API key alone is not evidence of free pricing. See
[Groq rate limits](https://console.groq.com/docs/rate-limits) and
[billing and usage](https://console.groq.com/docs/billing-faqs).
This enables Groq in the automatic pool, but another eligible source may answer first; check the
result's provider/model before treating a run as a Groq smoke test.

**Groq GPT-OSS-120B** is reasoning-capable and fast for bulk text sweeps; verify results before
relying on them. [OpenAI overview](https://openai.com/index/introducing-gpt-oss/).

**No local-model fallback.** A local `Jan-v3.5-4B-Q4_K_XL` was tested (commit 48848017) — ~32s for 4.1K tokens, truncated output, false claims. Unusable. Groq provides equivalent privacy with far better speed/reliability. No `--local-only` option exists; none needed — chat-history search data is already local, no secrets to hide.

## Free Subagent Launch Enforcement (NEW)

Mandatory pre-launch checks for ALL subagents:

```javascript
import { validateSubagentConfig } from '../scripts/free-model-validator.mjs';
await validateSubagentConfig({ model, provider, maxSubagents: 5 });
```

| Check                            | Module                     | Failure =        |
| -------------------------------- | -------------------------- | ---------------- |
| Model + provider together        | `free-model-validator.mjs` | Hard stop        |
| Model in verified free catalog   | `validateFreeModel()`      | Hard stop        |
| Known paid patterns rejected     | `isKnownPaidModel()`       | Hard stop        |
| OpenRouter quota >= maxSubagents | `probeOpenRouterQuota()`   | Hard stop        |
| Provider credentials present     | ENV check                  | Hard stop        |
| Max 15 concurrent free subagents | Config                     | Hard stop        |
| No fallback to paid              | `free-subagent-retry.mjs`  | Exhausted = stop |

New modules:

- `scripts/free-model-validator.mjs` — Programmatic free model validation
- `scripts/free-subagent-launcher.mjs` — Wrapper enforcing free-only routing
- `scripts/free-subagent-retry.mjs` — Rate-limit aware retry with exponential backoff

## Runner commands

```sh
node scripts/free-model-pool.mjs --help
node scripts/free-model-pool.mjs --list
node scripts/free-model-pool.mjs --prompt-file ./prompt.txt --max-tokens 1200 --output-file ./result.txt
node scripts/free-model-pool.mjs --openrouter-quota
node scripts/free-research.mjs --prompt-file ./prompt.txt --url-list ./urls.txt --output-file ./summary.md --max-tokens 1500
```

The inference fallback order is Kilo, OpenRouter, Groq, then OpenCode; catalog checks can run in
parallel, but completions are attempted in that order. The pool tries at most three eligible
models per provider and never falls back to paid models. Kilo tries other eligible models after request errors. Groq stops for the run on HTTP 401/402/429.
OpenRouter 401/402 exhausts the source; on 429,
the runner stops when the platform remaining-request header or daily counter is zero, and
otherwise tries another verified-free model within the three-model cap. If the quota counter is
unavailable, rotation stays bounded by that cap. Explicit content-policy rejections and
`finish_reason: content_filter` stop routing across providers so the same request is not retried
elsewhere. `--list` refreshes public catalogs and does not send an inference request.
`--openrouter-quota` reads OpenRouter's daily counter only; it does not report Kilo's separate
IP-based free-model limit. See [MODELS.md](../MODELS.md) for published limits. The URL runner
accepts at most 20 public HTTPS URLs and writes only its condensed result. Quarantine operations are
`npm run free:quarantine -- list|add|release|prune`.

### Chat-history search

Searches local Kilo and Codex databases. Model mode sends the query and excerpts to a free provider
after best-effort redaction; `--local-only` and `--no-summarize` make no model calls. Local output
may contain sensitive text. `--since DATE` and `--directory PATH` scope results; `--offset` pages
candidate sessions per source before matching. Keep filters fixed between pages and use the printed
next offset. Run `npm run free:chat-search -- --help` for options.

```sh
npm run free:chat-search -- --prompt-file ./query.txt --since 2026-10-21 --local-only
```

### Reasoning-model token budgets

Kilo Nemotron 3 Ultra uses the Kilo CLI's `high` variant. The CLI has no provider-side
`--max-tokens` option, so the runner uses the requested value only as a response-length instruction.
For OpenRouter, the preferred Nemotron 3 Ultra model receives at least 1,024 completion tokens so
reasoning has room to finish; other models use the requested token limit. GPT-OSS models on Groq
are also clamped to 1,024 tokens to account for hidden reasoning tokens.

### Catalog ordering

Within each provider, candidate models are sorted by preference. Kilo and OpenRouter prefer
`nvidia/nemotron-3-ultra-550b-a55b:free` first, then `xingchen-agi/xing4.0-29b-a4b:free` as alternative. Laguna models are excluded (turned off). Without this
preference sort, OpenRouter's catalog returns models in its default order (Flint, XingChen,
etc.), which may not match the desired free model and can exhaust the three-per-provider
attempt cap before reaching Nemotron 3 Ultra.

### Scheduled failure reports

The hourly `free-model-sweep` cron job scans Kilo, Codex, and OpenRouter logs for quota/capacity
errors (429s, empty completions, content-policy blocks) and writes a summary to
`docs/handoffs/free-model-sweep-<date>.md`. It runs report-only: it does not modify quarantine
state or rotate credentials. Start it with `npm run free:sweep`:

```sh
node scripts/cron/free-model-sweep.mjs --report-only
```
