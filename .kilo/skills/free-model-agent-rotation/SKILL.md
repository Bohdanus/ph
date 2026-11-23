# Free Model Agent Rotation

Use verified free models for bounded research, text sweeps, code search, and routine reviews. Split independent read-only work into small, evidence-based requests. Follow [`MODELS.md`](../MODELS.md) for current route policy and cost rules.

## Refresh and select

Run `node scripts/free-model-pool.mjs --list` from a repository worktree to refresh the live catalog. A listed route proves only that the catalog currently advertises it as free; it does not prove authentication, quota, or capacity. For Kilo, `configured: null` means CLI discovery succeeded but authentication was not tested.

For a standalone completion, save a non-sensitive prompt outside the repository and run:

```sh
node scripts/free-model-pool.mjs --prompt-file /tmp/free-task.txt --output-file /tmp/free-task-result.txt
```

The automatic pool tries the exact Nemotron 3 Ultra model before weaker models on eligible, verified-free routes. To require the exact Kilo route, set both `--provider` and `--model`:

```sh
node scripts/free-model-pool.mjs --prompt-file /tmp/nemotron-review.txt \
  --provider kilo --model nvidia/nemotron-3-ultra-550b-a55b:free --max-tokens 8192
```

Setting both flags restricts catalog discovery and inference to that exact provider/model pair; if unavailable, quarantined, or unverified free, the run stops without fallback. Either flag on its own filters only that dimension. Kilo has no hard token-limit option: `--max-tokens 8192` is a response-length instruction, so verify that the completion returned non-empty text with the expected source/model, finish reason, and reported cost. See [`docs/FREE-COMPUTE-OPERATIONS.md`](../docs/FREE-COMPUTE-OPERATIONS.md#kilo-code) for WSL setup and route details.

### WSL with Windows-saved Kilo auth

Run from the WSL task worktree with WSL Node/npm. Confirm the shell is using Linux executables before invoking npm or Kilo:

```sh
source "$HOME/.nvm/nvm.sh"
nvm use default
command -v node npm kilo
node --version
npm --version
```

When credentials are stored by Windows Kilo, set `XDG_DATA_HOME` to the Windows profile's `.local/share` directory converted with `wslpath -u`, then confirm `kilo/auth.json` is readable. The adapter links only `auth.json` into an isolated Linux-local XDG data root. Do not point raw Kilo CLI state at a Windows-mounted `kilo.db`. Verify the route with the pinned completion; a catalog row does not test login.

## Free subagents and completion fallback

Inside Kilo Code, use the read-only `explore` role for internal `task` research, or [`.kilo/agent/read-only-research.md`](../.kilo/agent/read-only-research.md) for visible research sessions. Pass `model: "nvidia/nemotron-3-ultra-550b-a55b:free"` and `provider: "kilo"` together. Verify the resolved model and deny `edit`, `bash`, and every connected file-mutating tool. A free task child returns findings; the coordinator owns edits and Git operations.

In Codex, do not assume `spawn_agent` can route to Kilo: this host may accept a model override without a provider. Use the pinned completion runner for free Nemotron analysis when the host cannot guarantee a free subagent route, and label it a completion rather than a subagent. Treat Nemotron findings on hard reasoning as leads and verify them against source and tests.

## Data handling

Do not send credentials, private chat content, or confidential repository data to providers unless the applicable provider terms and user authorization allow it. Kilo warns that Auto Free may log prompts and use them to improve upstream services; some model providers have stricter trial terms. OpenRouter and promotional model availability can change. Confirm current source terms before sending sensitive data.

Do not infer API access from a free IDE plan. OpenCode is used through its CLI, not an IDE session or generic model HTTP API; a provider-owned `-free` catalog ID establishes model eligibility but not authentication or capacity. Kilo and OpenRouter require exact-zero catalog pricing, and OpenRouter inference needs `OPENROUTER_API_KEY`. Keep the task coordinator responsible for edits, validation, and Git operations.
