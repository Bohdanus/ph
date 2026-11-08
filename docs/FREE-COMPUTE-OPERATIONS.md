# Free-compute operations

Current operating instructions for the free-model runner. Historical measurements belong in
[`FREE-COMPUTE.md`](FREE-COMPUTE.md).

## Model preferences

The runner prefers NVIDIA Nemotron 3 Ultra when it is present in the live catalog at exact-zero
pricing. This is an ordering preference, not a benchmark claim. The available free models change;
use `npm run free:models -- --list` to see the current provider/model pairs before a run.

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

The runner refreshes OpenRouter's public catalog, requires exact-zero pricing, and orders Nemotron 3
Ultra first when it is present. It does not depend on a fixed alternative model list. HTTP 401/402
exhaust the provider for the run. For HTTP 429, zero platform remaining requests or a zero daily
counter exhausts it; otherwise the runner rotates among verified-free models within its three-model
cap. For HTTP 503, it checks the daily counter before rotating because failed attempts count against
that allowance. A 429 from the quota endpoint is treated as an unknown counter, not proof that
inference is exhausted. The runner honors a valid `Retry-After` before another OpenRouter attempt;
waits longer than 60 seconds skip OpenRouter for that run. OpenRouter's free variants currently allow 20 requests
per minute and 50 requests per day by default, rising to 1,000 per day after a $10 credit purchase
(the higher cap starts at $9 to account for top-up fees). Failed attempts count toward the daily limit.
The live `/api/v1/key` quota check reports the daily counter, not the per-minute limit; see [OpenRouter's free-model limits](https://openrouter.ai/collections/free-models)
and [API rate-limit reference](https://openrouter.ai/docs/api_reference/limits) for the current
policy. Inference gets five minutes; catalog and quota requests keep a separate 15-second timeout.
A quota snapshot can change when other tools use the account.

OpenRouter can return HTTP 200 with no visible text when a reasoning model spends its output budget
on reasoning. The pool accepts only non-empty completions with `finish_reason: stop`; an incomplete
answer is discarded and the next eligible model is tried. For deliberate reasoning tasks, request a
larger `--max-tokens` budget and verify the returned model and finish reason. Nemotron 3 Ultra gets
at least 1,024 completion tokens; other OpenRouter models use the requested limit. OpenRouter's
[error guide](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/errors-and-debugging.mdx)
explains that retrying the same model does not fix a reasoning-budget exhaustion.

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

The runner reads `GROQ_API_KEY` or comma-separated `GROQ_API_KEYS` from its process environment.
It rotates only explicitly supplied keys after per-key 401/402/429 responses and does not read
key files during inference. `--probe-groq` can check saved-key files separately. Use keys from
distinct Free-plan organizations because Groq limits apply at the organization level. This
machine's saved-key convention is `~/.config/groq/api_key` and `~/.config/groq/api_key_*`.
A successful `/models` request proves the key is accepted, not that the organization is on Groq's Free plan.

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

**No local-model fallback.** A local `Jan-v3.5-4B-Q4_K_XL` was tested (commit 48848017) — ~32s for 4.1K tokens, truncated output, false claims. Unusable. Groq is cloud inference, not local processing. Groq says inference data is not retained by default, but reliability and abuse logs may retain inputs and outputs for up to 30 days unless Zero Data Retention is enabled ([data handling](https://console.groq.com/docs/your-data)). In `scripts/free-chat-search.mjs`, `--local-only` is an alias for `--no-summarize`; both skip model inference. The `free-model-pool.mjs` runner does not accept these flags.

## Optional free-subagent wrapper

The host-specific `scripts/free-subagent-launcher.mjs` wrapper can validate a batch
before calling a supplied `agent_manager` function:

```js
import { launchFreeResearchSubagents } from '../scripts/free-subagent-launcher.mjs';

await launchFreeResearchSubagents({
  prompts,
  maxSubagents: prompts.length,
  agentManager,
});
```

The wrapper checks each task's exact model/provider pair against the live free
catalog, requires an available OpenRouter quota when OpenRouter is selected,
requires explicit Free-plan opt-in and a selected key for Groq, and refuses
batches larger than 15. It uses only the `read-only-research` profile and does
not retry launches or rotate keys.

This is an opt-in helper, not a global hook: direct Kilo, Copilot, or other
host task calls do not pass through it automatically. Continue to enforce the
host's read-only tool permissions for every free child; do not launch free
subagents when that boundary cannot be verified. The helper does not establish
provider authentication for Kilo or OpenCode, and a live catalog alone is not
proof that a host task is configured to use that provider.

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
models per provider and never falls back to paid models. Kilo stops for the run on a reported
401/402/429; other completion errors may move to another eligible model. Groq retires a supplied key
on 401/402/429 and stops when all supplied keys are exhausted. OpenRouter 401/402 exhausts the
source; on 429, zero platform remaining requests or a zero daily counter exhausts it, and otherwise
the runner rotates within the three-model cap. On 503, it checks the daily counter before rotation.
Unknown counters stay within that cap. The runner honors `Retry-After` before another OpenRouter
request, and skips that source for the run if the requested wait exceeds 60 seconds. Explicit
content-policy rejections and
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

Within each provider, the runner sorts live candidates by its configured preference. Nemotron 3
Ultra is first when the provider currently lists it at exact-zero cost. Other candidates retain the
provider's catalog order; disabled model families are filtered before ordering. Do not assume a
named alternative remains available: refresh the catalog for each run.

### Report-only failure sweep

`npm run free:sweep` runs the sweep once. It reads recent Kilo SQLite and provider-log records,
Codex rollout metadata, and current OpenRouter catalog/quota health; it does not read OpenRouter
inference logs. It writes a report under `.kilo/sweep-reports/` by default (the directory follows
`FREE_MODEL_QUARANTINE_FILE` when that override is set). The report is local and includes session,
run, and record identifiers, so review it before sharing. It does not copy transcript text, send
history to a model, modify quarantine state, or rotate credentials. The repository does not install
an hourly scheduler; run the command manually or configure an external scheduler yourself.

```sh
npm run free:sweep
```
