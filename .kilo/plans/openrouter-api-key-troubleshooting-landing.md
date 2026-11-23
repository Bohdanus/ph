# OpenRouter API key troubleshooting: landing hold

**State:** The reviewed candidate is not landed. Task branch `task/openrouter-api-key-troubleshooting-20261123` is based on current `main` `ba114b8` and has feature changes in `docs/WSL-SETUP.md` and `scripts/free-model-pool.mjs`.

**Blocker:** `npm run repo:state -- --for-landing task/openrouter-api-key-troubleshooting-20261123` exits 1 because it reports a `MERGE_HEAD` in the primary root checkout, targeting `651e30fa8ead8b8a54ba602e461af1e423af2a6e`. Registering the clean replacement main worktree did not clear this finding. User instructions require leaving the primary root checkout untouched; no marker was cleared and no guard was bypassed.

The designated main landing worktree is `C:\Users\2025\ph\.kilo\worktrees\main-landing-openrouter-20261123`, clean at `ba114b8`; `npm run main:landing -- status` reported it free. The repo-state hold still applies.

**Validation:** Final free Nemotron review of the feature diff returned no findings. `npm run tsc`, `npm run build`, and commit hooks passed. No test suite was run.

**Resume:** Recheck the main ref, landing lease, and scoped repo-state result. Keep the primary root checkout untouched. After the operation marker is resolved through its owner-approved recovery and the scoped gate passes, recompute candidate/main/tree pins. If `main` advances, synchronize the task branch, review the resulting diff, and rerun validation. Land only through the owner-tracked wrapper.
