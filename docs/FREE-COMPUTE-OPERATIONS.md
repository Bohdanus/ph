# Free-compute operations

Current operating instructions for the free-model runner. Historical measurements belong in
[`FREE-COMPUTE.md`](FREE-COMPUTE.md).

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

The runner refreshes OpenRouter's public catalog, requires exact-zero pricing, and tries Laguna S
2.1 first when it is present. HTTP 401/402 exhausts the source. A model HTTP 429 triggers a check
of the account's daily free-model counter: the runner rotates to another exact-zero model while
requests remain and stops when the counter is exhausted. If the counter cannot be read, it tries
another verified-free model within the three-model run limit. Inference gets five minutes; catalog
and quota requests keep a separate 15-second timeout. A quota snapshot is only current at the time
it was read and can change when other tools use the account.
OpenRouter Laguna receives at least 1,024 completion tokens so reasoning has room to finish; other
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

## Runner commands

```sh
node scripts/free-model-pool.mjs --list
node scripts/free-model-pool.mjs --prompt-file ./prompt.txt --max-tokens 1200 --output-file ./result.txt
node scripts/free-model-pool.mjs --openrouter-quota
node scripts/free-research.mjs --prompt-file ./prompt.txt --url-list ./urls.txt --output-file ./summary.md --max-tokens 1500
```

The inference fallback order is Kilo, OpenRouter, Groq, then OpenCode; catalog checks can run in
parallel, but completions are attempted in that order. The pool tries at most three eligible
models per provider and never falls back to paid models. OpenRouter HTTP 401/402 exhausts that
source; an OpenRouter model HTTP 429 checks the daily counter and rotates models while requests
remain, stopping when the counter reaches zero. Groq rotates per-key on HTTP 401/402/429. `--list`
refreshes public catalogs and
does not send an inference request. For Kilo, `configured: null` means the CLI was found but its
saved login was not probed; for OpenRouter, `configured` reflects `OPENROUTER_API_KEY`. The
OpenRouter quota command does not report Kilo's separate IP-based free-model limit. See
[MODELS.md](../MODELS.md) for both providers' published limits. The URL runner accepts at most 20
public HTTPS URLs and writes only its condensed result. Quarantine operations are
`npm run free:quarantine -- list|add|release|prune`.
