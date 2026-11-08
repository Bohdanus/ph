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
rejects tool events and reported non-zero cost. Inference has a five-minute default timeout, extended
to twelve minutes for the exact Nemotron 3 Ultra model. It
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

The runner refreshes OpenRouter's public catalog and requires exact-zero pricing. It probes
`GET /api/v1/key` only when routing reaches the first OpenRouter inference route, then uses the live
`used`, `limit`, and `remaining` counters. If remaining is zero, it stores the current UTC date and
skips OpenRouter until the date changes; no scheduled reset is required. If the probe is unknown,
only one inference request is permitted and the quota-present retry is disabled. A positive quota
allows one same-route retry after a bounded wait (maximum 60 seconds). HTTP 401/402 exhausts
OpenRouter for the run. A zero `X-RateLimit-Remaining` on a 429 identifies a platform rate limit and
skips the source for that run without blaming the model. A zero daily counter persists today's
exhaustion marker. Three confirmed upstream/model 429s for the same OpenRouter model in three hours
create a two-hour model quarantine; 250 confirmed model-attributable failures in seven days create a
seven-day quarantine. Network errors, truncation, empty responses, and unresolved model IDs do not
increment those counters. OpenRouter currently documents 20 requests per minute and 50 daily by
default, rising to 1,000 after qualifying lifetime credit purchases; failed attempts count. These
published limits can change, while `/api/v1/key` remains the account's live daily counter, not the
per-minute limit. See [OpenRouter's free-model limits](https://openrouter.ai/collections/free-models)
and [API rate-limit reference](https://openrouter.ai/docs/api_reference/limits). A quota snapshot can
change when other tools use the account.

OpenRouter can return HTTP 200 with no visible text when a reasoning model spends its output budget
on reasoning. The pool accepts only non-empty completions with `finish_reason: stop`; an incomplete
answer is discarded and the next eligible provider for that same model is tried before lower-ranked
models. If `--max-tokens` is omitted, Nemotron 3 Ultra gets 4,000 output tokens and other models get
1,200. An explicit Nemotron token cap is preserved. Verify the returned model and finish reason.
OpenRouter's
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

The runner accepts provider-owned model IDs ending in `-free`, denies tool use, and requires a clean
CLI exit with non-empty text. The exact canonical Nemotron ID is the only suffix exception, and only
when the live catalog marks it provider-owned. Display-name similarity is insufficient. OpenCode CLI
JSON output can omit its final `step_finish` event; a clean exit, text response, and free catalog ID
are sufficient when no explicit error, tool call, or non-zero cost was reported. The
`provider.free-limit` error is an account quota event: OpenCode is skipped for the current run with
no long-lived cooldown. Other transient/model-specific 429s may receive at most one bounded retry.

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

The inference order is model-first: try the exact Nemotron model on Kilo, OpenRouter, and OpenCode
before changing models; then try other OpenRouter models, other OpenCode models, and Groq. Lower
ranked Kilo models are not fallback routes. Catalog checks can run in parallel; inference is
sequential and capped at three attempts per source. The pool never falls back to paid models. Kilo
401/402 stops Kilo for the run; a 429 also records a one-hour Kilo cooldown. Groq retires a supplied
key on 401/402/429 and stops when all supplied keys are exhausted. OpenRouter uses the live daily
counter and platform headers as described above. `provider.free-limit` skips OpenCode for the run
without a persistent provider cooldown. Non-zero or invalid reported cost and explicit content-policy
rejections fail closed across all providers, including Kilo and OpenCode; HTTP 200 with
`finish_reason: content_filter` also stops routing. `--list` refreshes public catalogs and does not
send an inference request.
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
When omitted, Nemotron receives 4,000 output tokens; other routes default to 1,200. Explicit
Nemotron values are preserved. GPT-OSS on Groq retains its 1,024-token floor for hidden reasoning
tokens. Nemotron receives a 12-minute inference timeout across eligible providers; other routes
receive five minutes. Catalog and quota calls use 15 seconds.

### Catalog ordering

Within the Nemotron tier, provider order is Kilo, OpenRouter, then OpenCode, and every candidate
must be live and verified. In fallback, OpenRouter precedes OpenCode, with Groq last; lower Kilo
models are not attempted. OpenCode Nemotron requires an exact canonical ID match. Other candidates
retain each provider's catalog order; disabled model families are filtered before ordering. Do not
assume a named alternative remains available: refresh the catalog for each run.

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
