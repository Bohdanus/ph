---
name: worktree-merge-harvest
description: Land useful work from free worktrees onto main using the reviewed harvest procedure.
---

# Worktree Merge Harvest

The authoritative, tracked playbook is `.skills/worktree-merge-harvest.md`.
Before harvesting or cleaning up a worktree, read that file from the active,
verified task worktree and follow its current procedure. Do not rely on a copied
procedure here: this Kilo runtime entry is deliberately only a loader so it
cannot drift from the tracked playbook.

---

## Free Model Review Guidance

When dispatching review subagents for candidate branches:

- **Use `read-only-research` profile** (`.kilo/agent/read-only-research.md`) with Nemotron 3 Ultra via Kilo provider
- **Run `node scripts/free-model-pool.mjs --list` and `--openrouter-quota`** before launching free subagents
- **Launch free subagents via `scripts/free-subagent-launcher.mjs`** for catalog validation
- **Pass `model` AND `provider` together** per MODELS.md mandatory rule: `model: "nvidia/nemotron-3-ultra-550b-a55b:free", provider: "kilo", variant: "high"`
- **Quota exhaustion handling**: if free routes are exhausted, pause review and continue with coordinator-owned verification or record evidence-based handoff
- **Partial landing procedure**: if a candidate has separable commits, land verified subset and defer the rest

## Constraints (Enforced)

- **Worktree verification**: run `git -C <worktree> rev-parse --git-dir --git-common-dir` after creation
- **Never `git stash`** — use worktree or `HUSKY=0 git commit` on throwaway branch instead
- **Never resolve conflicts in main worktree**
- **Never `git add -A` in any worktree**
- **Never `git branch -D`** — use `-d` which refuses on unmerged branches
- **Preflight**: `npm run repo:state` before any action
- **Regenerate `WORKTREES.json`** after every action before re-reading
