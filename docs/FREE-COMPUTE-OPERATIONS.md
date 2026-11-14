# Free-compute operations

Current operating instructions for the free-model runner. Historical measurements belong in
[`FREE-COMPUTE.md`](FREE-COMPUTE.md).

## Model policy

The required policy is model-first: order routes by maintained model-strength rank across providers.
Try exact Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b:free`) through every eligible,
verified-free provider before trying a weaker model. Xing 4.0 is the next explicitly ranked fallback;
unranked models share the final tier and are interleaved by provider. A quarantine or failure excludes
only its provider/model pair. Never bypass pricing, authentication, quota, quarantine, or safety
controls.

As of 2026-11-12, the exact OpenRouter pair is under a 168-hour `poor_performance` quarantine
through `2026-11-19T02:03:21.539Z`; that does not quarantine the model on other providers. The exact
Kilo route remains approved. Active quarantines are removed before route ordering. Check
`npm run free:quarantine -- list` for current expiry and refresh catalogs with
`npm run free:models -- --list` before a run.

For Nemotron, request high reasoning where supported, a minimum 4,096-token response budget, and a
12-minute inference timeout. The runner defaults to 4,096 tokens; callers may request up to 65,536
subject to the provider's live endpoint ceiling. Kilo has no provider-side token-limit flag and
receives a response-length instruction instead. Verify the resolved route, non-empty text, finish
reason, and cost. The runner ranks Nemotron first across eligible providers, then Xing 4.0, and
interleaves unranked fallback routes. See [`MODELS.md`](../MODELS.md).

## Find credentials safely

If the operator says credentials were saved, search the relevant local chat before concluding they
are absent: use [Kilo chat history](../.skills/kilo-chat-history.md) or [Codex chat history](../.skills/codex-chat-history.md).
Never print key files, dump the environment, include credentials in prompts, or copy secret values
into logs. Report only the provider, path, and whether authentication is available.

## Kilo Code

The Kilo adapter uses `kilo run`, which picks up the logged-in Kilo Gateway OAuth account used by
the Kilo Code extension. The shared completion pool selects verified-free Kilo routes in its
model-first provider order. The adapter discovers `kilo` on `PATH` and then checks common VS Code,
Cursor, and Windsurf extension folders. If discovery misses the installed CLI, set
`KILO_CLI` to its executable path. Check saved provider names with `kilo auth list`; never read or
print the Kilo auth database or JSON file.

`kilo run` starts with `--pure` and the tracked `free-completion` agent. That profile denies every
tool name. The prompt is piped through stdin, keeping it out of process arguments and avoiding
Kilo's file-attachment and external-directory permission checks. Do not add `--auto`: it would
broaden permissions beyond the tool-free profile. The runner verifies a clean JSON completion,
rejects tool events and reported non-zero cost. Inference has a five-minute timeout. It
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
`used`, `limit`, and `remaining` counters. OpenRouter notes the tier counter is not enforced for every
account or endpoint and does not gate BYOK; this runner conservatively stops when its live counter
reports zero. If remaining is zero, it stores the current UTC date and
skips OpenRouter until the date changes; no scheduled reset is required. If the initial probe is
unknown, only one inference request is permitted in that run; a positive post-attempt refresh does
not unlock another attempt. Quota-present retries require a positive initial probe. A positive quota
allows one bounded same-route retry for a transient OpenRouter response (maximum wait 60 seconds).
For an upstream/model-attributable HTTP 429 with a longer `Retry-After`, the pool refreshes daily
quota and skips only that model when the refreshed quota remains positive; zero or unknown quota
stops OpenRouter. Longer waits for other failures stop the source. If a bounded retry also fails,
the pool rotates to another eligible OpenRouter model when a fresh quota check is still positive and
the per-source attempt ceiling permits it. HTTP 401/402 exhausts
OpenRouter for the run. An `openrouter_*` limit source or zero `X-RateLimit-Remaining` on a 429 identifies a platform
rate limit and skips the source for that run without blaming the model. A zero daily counter persists today's
exhaustion marker. Three confirmed upstream/model rate-limit failures (HTTP 429 or typed
`rate_limit_exceeded`) for the same OpenRouter model in three hours create a two-hour quarantine; 250
confirmed model-attributable failures in seven days create a
seven-day quarantine. Network errors, truncation, empty responses, and unresolved model IDs do not
increment those counters. OpenRouter currently documents 20 requests per minute and 50 daily by
default, rising to 1,000 after qualifying lifetime credit purchases; failed attempts count. These
published limits can change, while `/api/v1/key` remains the account's live daily counter, not the
per-minute limit. See [OpenRouter's free-model limits](https://openrouter.ai/collections/free-models)
and [API rate-limit reference](https://openrouter.ai/docs/api_reference/limits). A quota snapshot can
change when other tools use the account.

OpenRouter can return HTTP 200 with no visible text when a reasoning model spends its output budget
on reasoning. Routes default to 1,200 completion tokens unless `--max-tokens` is set. The runner
accepts only non-empty completed text; inspect the returned model and finish reason. Truncation alone
does not update provider failure or quarantine state. OpenRouter's
[error guide](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/errors-and-debugging.mdx)
explains that retrying at the same exhausted budget does not fix reasoning-budget exhaustion.

## OpenCode

The runner calls `opencode run` through the OpenCode CLI; it does not call a generic model HTTP API.
The desktop UI is not required when the CLI is installed. Check authentication with `opencode auth
list` and locate the active data store with `opencode debug paths db`. OpenCode releases may store
credentials in `~/.local/share/opencode/opencode.db` or the older `auth.json`; `opencode.jsonc` is
configuration, not proof that credentials are absent. Do not inspect credential values in the
database or auth file. See the [OpenCode CLI auth guide](https://opencode.ai/docs/cli/) and
[storage guide](https://opencode.ai/docs/troubleshooting/).

The runner accepts provider-owned model IDs ending in `-free`, plus the exact Nemotron `:free` ID
only when the catalog marks it `owned_by: opencode`. It denies tool use and requires a clean CLI exit
with non-empty text. The current OpenCode catalog inspection on 2026-11-12 did not list the exact
Nemotron model, so no OpenCode Nemotron route was eligible in that check.
OpenCode CLI JSON output can omit its final `step_finish` event; a clean exit, text response, and free
catalog ID are sufficient when no explicit error, tool call, or non-zero cost was reported.
The typed `provider.free-limit` event and upstream `FreeUsageLimitError` alias both signal a service
quota for the account, workspace, and network. This remains a source-wide stop when there is no HTTP
status or when an earlier model-specific error came first. Skip OpenCode for the current run without
a long-lived cooldown or retry ([quota guidance](https://github.com/anomalyco/opencode/issues/60935)).
Check `opencode --version` and use v2;
OpenCode v1 no longer supports free models ([free-tier guidance](https://github.com/anomalyco/opencode/issues/59387)).
Other transient/model-specific 429s may receive at most one retry per route. Honor OpenCode's
`retryAfterMs`, `Retry-After-Ms`, and `Retry-After` metadata, including timing nested in
`responseHeaders`; across multiple model 429 events, wait for the longest requested delay. The
wait is capped at 60 seconds, and a longer server delay skips that retry. Both quota error types
skip OpenCode immediately regardless of any retry timing ([retry timing issue](https://github.com/anomalyco/opencode/issues/33955)).

## Groq

The runner reads `GROQ_API_KEY` or comma-separated `GROQ_API_KEYS` from its process environment.
It rotates only explicitly supplied keys after per-key 401/402/429 responses and does not read
key files during inference. `--probe-groq` can check saved-key files separately. Use keys from
distinct Free-plan organizations because Groq limits apply at the organization level. This
machine's saved-key convention is `~/.config/groq/api_key` and `~/.config/groq/api_key_*`.
A successful `/models` request proves the key is accepted, not that the organization is on Groq's Free plan.

To check saved-key authentication without sending an inference request, run
`node scripts/free-model-pool.mjs --probe-groq`. It discovers `api_key` and `api_key_*` in
`~/.config/groq/`; use `--groq-key-dir DIR` to select another directory or
`--groq-key-files PATH1,PATH2` to check explicit files. The report identifies each checked path and
whether its key authenticated; it does not establish that the account has Free-plan access.

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

**No local-model fallback.** Local inference was tested at ~32s for 4.1K tokens and produced truncated output and false claims, so it is not a supported route. Groq is cloud inference, not local processing. Groq says inference data is not retained by default, but reliability and abuse logs may retain inputs and outputs for up to 30 days unless Zero Data Retention is enabled ([data handling](https://console.groq.com/docs/your-data)). In `scripts/free-chat-search.mjs`, `--local-only` is an alias for `--no-summarize`; both skip model inference. The `free-model-pool.mjs` runner does not accept these flags.

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

The inference order follows maintained model-strength ranks across eligible providers: Nemotron 3
Ultra first, Xing 4.0 next, then the unranked fallback tier interleaved by provider. Catalog checks
can run in parallel; inference is sequential and capped at three attempts per source. It never falls
back to paid models. Kilo 401/402 stops Kilo for the run; a 429 records a
one-hour source cooldown. Groq retires a supplied key on 401/402/429 and stops when all supplied keys
are exhausted. OpenRouter uses the live daily counter and platform headers as described above;
401/402 or a zero platform remaining count skips the source for the run, and transient/upstream
failures receive at most one bounded retry when quota is known positive. `provider.free-limit` skips
OpenCode for the run without a persistent provider cooldown; a transient model-attributable 429 may
be retried once. Non-zero or invalid reported cost and explicit content-policy rejections fail closed
across providers, including Kilo and OpenCode; HTTP 200 with `finish_reason: content_filter` also
stops routing. `--list` refreshes public catalogs and does
not send an inference request.
OpenRouter upstream 429 responses can include typed `error.metadata.error_type` and may include
`error.metadata.provider_code` without platform rate-limit headers; with verified positive daily quota,
the runner keeps that failure attributable to its model and applies a same-route retry if quota remains.
Typed 502 `provider_unavailable`, 503 `provider_overloaded`, and 504 `timeout` errors establish upstream
attribution even when `provider_code` is absent; generic HTTP 500 `server` errors remain unattributed
unless other provider metadata is present.
Because failed requests can consume the daily cap, the runner refreshes quota after a nonterminal failed
or incomplete attempt, including transport and response parsing failures, before another OpenRouter
inference. A zero or unknown refreshed quota stops the source;
terminal safety outcomes do not send another inference. At most one bounded transient retry is allowed per
OpenRouter run. A platform `X-RateLimit-Remaining: 0` still stops OpenRouter for the run. After HTTP 200 is
committed, typed provider errors may appear in top-level `error.metadata` or `choices[].error.metadata`;
transient rate-limit, overloaded, unavailable, and timeout types receive the same retry.
`content_policy_violation` and `refusal` in the typed error metadata stop all provider fallback; see the
[OpenRouter error reference](https://openrouter.ai/docs/api_reference/errors-and-debugging) and
[free-model limits](https://openrouter.ai/collections/free-models).
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

Nemotron's required profile is high reasoning where supported, at least 4,096 response tokens, and a
12-minute inference timeout. The runner defaults this route to 4,096 tokens; callers may explicitly
request up to 65,536 subject to the endpoint ceiling. Kilo receives a response-length instruction
because its CLI has no provider-side output limit. Other routes default to 1,200 tokens and five
minutes; GPT-OSS on Groq retains its 1,024-token floor for hidden reasoning tokens. Catalog and quota
calls use 15 seconds.

### Catalog ordering

Rank by model strength before provider. Put the exact Nemotron 3 Ultra ID first across every
eligible provider, Xing 4.0 next, and interleave unranked models within the final tier; route-specific
quarantine removes only that pair. Refresh catalogs for each run rather than assuming a named model or
route remains available. Update the explicit ranking only with evidence-backed model comparisons.

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
