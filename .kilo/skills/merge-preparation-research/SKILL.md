# Skill: merge-preparation-research

# Merge Preparation Research

## 🚫 **THIS SKILL IS STRICTLY READ-ONLY — NO MUTATIONS ALLOWED** 🚫

A **preparational READ-ONLY pass** that performs rigorous, parallelized, systemic research on a
specific stale/unmerged worktree before any merge attempt. The output is a **complete research
dossier file** — **NEVER** code edits, **NEVER** git mutations, **NEVER** merge resolution.

## When to use

- You have identified a specific at-risk, free worktree (via `stale-worktree-reclaim` or
  `worktree-merge-harvest` inventory)
- You need to deeply understand the worktree's content, history, conflicts, and requirements
  **before** deciding whether/how to merge
- You want to delegate heavy research to free subagents while protecting your context
- The worktree may have complex conflicts, silent reverts, or overlapping features with main

## Phase 0: Viability Gate (Mandatory First Step)

Before investing in deep research, verify the worktree is still viable:

```bash
git cherry main <branch>            # EMPTY = every patch already absorbed by main (hard-merge Phase 0)
git log --oneline main..<branch>    # what is genuinely not there
```

If `git cherry` is empty, **stop** — branch is patch-absorbed by main (per hard-merge Phase 0 and stale-worktree-reclaim case a-bis). Do not proceed with research.

## Core Principles

| Principle                       | Enforcement                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| **🚫 READ-ONLY — NO MUTATIONS** | **NEVER** edit code files, **NEVER** edit tracked docs, **NEVER** run git mutating commands |
| **Context-safe**                | Dump raw data to a file in Wave 1; fan out subagents in Wave 2                              |
| **Correctness over speed**      | Cross-validate heavily; no false positives                                                  |
| **Deep understanding first**    | Recover the actual requirement from chats, not commit subjects                              |
| **Data collection is the goal** | Conflict analysis is optional; understanding is mandatory                                   |

## Wave Architecture

### Wave 1: Raw Data Dump (Context Protection)

**Goal**: Capture all raw facts about the worktree into a durable file before context compaction.

**Delegation**: Fan out 5-10 `explore` subagents in parallel, each with a focused query.

**Subagent tasks** (run concurrently):

1. **Git facts**: `git log --oneline -30`, `git status --short`, `git diff --stat`, `git cherry main <branch>`, `git log --oneline main..<branch>`, `git log --oneline <branch>..main`
2. **Full diff**: `git diff main...<branch>` (three-dot = merge-base diff)
3. **File inventory**: List all changed files with line counts; categorize by type (source, test, config, docs)
4. **Chat archaeology**: `kilo_memory_recall search` (mode=search) on branch name, commit subjects, changed file paths, feature keywords
5. **Board state**: `npm run swarm -- doctor --dry-run` for this worktree's branch; check `WORKTREES.json` ownership fields
6. **Main divergence**: `git merge-tree --write-tree --name-only main <branch>` to get conflicting paths; compare with candidate's tested tree
7. **Silent reverts**: Set-difference sweep — files changed in main since branch point that the branch does not touch
8. **Test impact**: List all test files in diff; check if any tests were deleted or modified in ways that weaken coverage
9. **External refs**: Search `docs/PHOTOSHOP-UX.md` and `docs/TOOLS-TOO-HARD.md` first (per AGENTS.md and hard-merge Phase 2), then Adobe Photoshop docs / web for the feature behavior the branch implements
10. **Inventory snapshot**: Run `node scripts/worktree-inventory.mjs` and extract this worktree's full record

**Output**: Write all raw outputs to `.kilo/plans/merge-prep-<worktree-name>-<timestamp>.json` (structured) and `.md` (human-readable summary).

**Critical**: This file survives context compaction. Do not keep raw data in context.

### Wave 2: Parallel Code Review & Analysis

**Goal**: Deep analysis of the dumped data by specialized subagents.

**Delegation**: Fan out 3-5 `read-only-research` subagents (or `explore` with read-only permissions), each assigned a review domain.

**Review domains** (assign based on Wave 1 findings):

1. **Requirement Recovery**: What was this branch actually for? Trace every commit to chat turns, Adobe specs, or AGENTS.md. Quote sources.
2. **Conflict & Concurrency Analysis**: Map every conflicted hunk (if merge attempted), classify using hard-merge taxonomy. Predict merge-tree result. Identify silent reverts and set-difference issues.
3. **Behavioral Correctness**: Does the implementation match Photoshop behavior? Primary-source research required for non-trivial algorithms.
4. **Test & Gate Impact**: Will this pass current gates? Which tests are affected? Any test erosion?
5. **Architectural Fit**: Does this align with current project architecture (replay, durable, store, tools)? Any contract violations?

**Each subagent returns**: Structured findings appended to the Wave 1 dossier file.

**Coordinator updates**: Plan file with findings, conflict assessment, expectations about possible conflicts.

## Output Artifact

A single comprehensive dossier file at:

```
.kilo/plans/merge-prep-<worktree-name>-<timestamp>.md
```

**Required sections**:

1. **Worktree Identity**: name, path, branch, HEAD, base commit, main HEAD at research time
2. **Raw Data Dump** (Wave 1): All git outputs, chat search results, board state, inventory record
3. **Requirement Recovery**: Quoted chat turns, Adobe doc URLs, AGENTS.md sections — what the branch was FOR
4. **Change Analysis**: Categorized diff summary, file types, line counts, test impact
5. **Conflict & Merge Prediction**: `merge-tree` result, conflicted files/hunks, silent reverts, set-difference
6. **Review Findings** (Wave 2): Per-domain analysis with evidence
7. **Risk Assessment**: Land / salvage / reimplement / defer / reject with reasoning
8. **Conflict Expectations**: Specific files/hunks likely to conflict, severity, suggested approach
9. **Open Questions**: Blocking questions only a person can answer (per hard-merge format)
10. **Research Log**: Every search query, subagent task, tool call, and timestamp for reproducibility

**Pre-finalization gate** (mandatory before considering dossier complete):

```bash
# Re-derive conflict state immediately before finalizing (per stale-worktree-reclaim §4b)
node scripts/worktree-inventory.mjs
# Re-check ahead, behind, conflict counts

# Verify all CI gates pass in candidate worktree
npm run tsc
npm run build
npm run lint:check
npm run test
```

Dossier is incomplete unless all four gates pass.

## Subagent Model & Provider

- **Default**: Kilo Nemotron 3 Ultra (free) — `model: "nvidia/nemotron-3-ultra-550b-a55b:free", provider: "kilo", variant: "high"` (MODELS.md preferred free model)
- **Fallback**: OpenRouter Nemotron 3 Ultra (free quota) — verify via `node scripts/free-model-pool.mjs --openrouter-quota`
- **Fallback**: Groq if available — requires `GROQ_FREE_PLAN=1` and distinct org keys
- **Never**: Kilo subagents without explicit free model (they consume gateway quota)
- **Pass `model` AND `provider` together** in every subagent launch

## Permissions for Subagents

- **Deny**: `edit`, any filesystem write/patch/delete MCP tools
- **Allow**: `read`, `glob`, `grep`, `semantic_search`, `kilo_memory_recall`, `webfetch`, `websearch`, `bash` (restricted to read-only git commands: `git log`, `git diff`, `git status`, `git merge-tree --name-only`, `git cherry`)
- **Profile**: Use `read-only-research` agent profile or `explore` with explicit deny list

## Integration with Other Skills

| Skill                    | Relationship                                                                     |
| ------------------------ | -------------------------------------------------------------------------------- |
| `stale-worktree-reclaim` | Runs first; identifies candidate worktrees. This skill picks ONE and deep-dives. |
| `worktree-merge-harvest` | Runs after; uses this dossier to decide land/salvage/reimplement.                |
| `hard-merge`             | If conflicts are complex, this dossier feeds hard-merge Phase 1-2.               |

## Constraints (Enforced)

- **Free subagents must use `read-only-research` profile** (`.kilo/agent/read-only-research.md`) with Nemotron 3 Ultra via Kilo provider
- **Run `node scripts/free-model-pool.mjs --list` and `--openrouter-quota`** before launching free subagents
- **Launch free subagents via `scripts/free-subagent-launcher.mjs`** for catalog validation
- **Pass `model` AND `provider` together** per MODELS.md mandatory rule
- **Worktree verification**: run `git -C <worktree> rev-parse --git-dir --git-common-dir` after creation

## 🚫 **NEVER — ABSOLUTE PROHIBITIONS**

**THIS SKILL MUST NEVER:**

- Edit any code file, tracked document, or config
- Run `git merge`, `git rebase`, `git cherry-pick`, `git push`, `git commit`, `git reset`, `git stash`
- Resolve conflicts or propose merge resolutions
- Weaken gates or skip validation
- Assume the branch's commit subjects reflect the true requirement
- Trust inventory `action` field without independent verification

**ANY VIOLATION OF THESE RULES IS A FUNDAMENTAL BREACH OF THIS SKILL'S PURPOSE.**

## Entry Point

Run this skill when you have:

1. A specific worktree name/path from fresh inventory
2. Confirmed it is **free** (no live writers, no recent edits, not claimed by another chat)
3. Confirmed it is **at-risk** (stale, behind main, dirty, or conflicting)
4. Need a rigorous research foundation before any merge decision

The skill produces the dossier; the **human decides** the next action.

---

_This skill is the "measure twice" before "cut once" of the merge pipeline._
