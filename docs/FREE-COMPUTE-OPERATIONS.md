# Free-compute operations

Current operating instructions for the free-model runner. Historical measurements belong in
[`FREE-COMPUTE.md`](FREE-COMPUTE.md).

## Find credentials safely

If the operator says credentials were saved, search the relevant local chat before concluding they
are absent: use [Kilo chat history](../.skills/kilo-chat-history.md) or [Codex chat history](../.skills/codex-chat-history.md).
Never print key files, dump the environment, include credentials in prompts, or copy secret values
into logs. Report only the provider, path, and whether authentication is available.

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

The pool tries at most three eligible models per provider; HTTP 402/429 exhausts that provider for
the run. It never falls back to paid models. `--list` refreshes public catalogs and does not send
an inference request. `--openrouter-quota` reads OpenRouter's daily counter only; it does not
report Kilo's separate IP-based free-model limit. See [MODELS.md](../MODELS.md) for both providers'
published limits. The URL runner accepts at most 20 public HTTPS URLs and writes only its
condensed result. Quarantine operations are `npm run free:quarantine -- list|add|release|prune`.
