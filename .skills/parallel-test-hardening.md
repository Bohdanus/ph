---
name: parallel-test-hardening
description: >-
  Harden and write tests in the `ph` photo editor using wave-based parallel
  free read-only model reviews. Launch up to 3 children per wave, persist coordinator-owned
  findings to `.kilo/plans/` for crash survival, and cycle exploration → proposals → review →
  fixes. Free children return proposed test content; the coordinator owns file writes, commands,
  and all Git operations.
---

# Parallel Test Hardening for Free Models

Free model catalogs and limits change. Keep each task to one test file, request a
compact structured result, and persist hand-offs in `.kilo/plans/` before starting
the next wave. Select models from the refreshed catalog according to `MODELS.md`;
do not reuse model names, variants, or quotas from old runs. Free children are read-only:
use Kilo's `explore` role or the project's `read-only-research` profile only with Bash,
edit, write, patch, and file-mutating MCP tools denied. If the host cannot enforce and verify
that boundary, use the tool-free free-completion runner and provide the source excerpts it needs.

## Crash Analysis

**Root cause of previous failures:** Broad multi-file tasks exceeded model output
budgets during exploration. Keep subtasks narrow and save concise results before
launching another wave. This history is not a permanent ban on any model; use the
current catalog and policy in `MODELS.md`.

**Fixes applied in this skill:**

1. **One narrow outcome per child** — one small test proposal, no
   broad rewrites
2. **Current model selection** — use an exact free model/provider pair from the
   refreshed catalog; do not hardcode a model into this workflow
3. **JSON-only output** — subagents return structured JSON, not prose
4. **Crash recovery via `.kilo/plans/`** — every wave's results persisted before
   the next wave launches; re-read and relaunch only the missing file
5. **No Git in subagents** — only the coordinator commits

## When to Use

- Test suite is green but brittle / stale / missing coverage
- Multiple test files need updates after a production change
- You need to write several new test files from scratch
- Previous subagent attempts hit output limits or produced no edits

## Architecture

| Phase                | Wave | Subagents                | Output                                                                                                                   |
| -------------------- | ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **1. Exploration**   | W1a  | Up to 3, one file each   | `.kilo/plans/wave-1a-exploration.json` — per-file: imports, helpers, fixtures, test gaps, stale assertions, crash points |
|                      | W1b  | Up to 3, different files | `.kilo/plans/wave-1b-exploration.json`                                                                                   |
| **2. Proposals**     | W2a  | Up to 3, one file each   | `.kilo/plans/wave-2a-proposals.json` — per-file: proposed diff or complete new file content                              |
|                      | W2b  | Up to 3, different files | `.kilo/plans/wave-2b-proposals.json`                                                                                     |
| **3. Review**        | W3   | 1 (read-only reviewer)   | `.kilo/plans/wave-3-review.json` — findings against the diff and coordinator-supplied gate output                        |
| **4. Fix proposals** | W4   | 1-3                      | `.kilo/plans/wave-4-fixes.json` — per-file: failure + proposed correction                                                |

After each wave, the coordinator writes accepted results to its JSON plan **before** launching
the next. Free children return results in their task response and never write plan files. If a child dies,
re-read the plan and relaunch only that file.

## Safety Constraints (READ BEFORE LAUNCHING)

### Subagents MUST NOT:

- Edit or write files, including test files and `.kilo/plans/` — return proposed diffs or content in the task response
- Run shell commands, npm/npx commands, tests, builds, or Git commands
- Use file-mutating MCP tools; deny connected write/delete tools not covered by common patterns
- Edit production/source files (`src/` non-test files)
- Run `git` commands (commit, merge, push, branch, worktree, stash, reset)
- Modify `package.json`, `tsconfig.json`, `vitest.config.*`, or other config
- Add `data-testid` to production components
- Weaken assertions to make tests pass
- Re-record snapshots without approval
- Run from the main checkout (must be in a worktree)

### Only the coordinator MAY:

- Commit test changes (`git add <specific test files>` + commit)
- Merge to main (with `Branch:` trailer)
- Push to origin
- Apply accepted test proposals in the task worktree and run applicable npm gates there
- Modify `.kilo/plans/` JSON files for crash recovery
- Update `scripts/__tests__/docs-index.test.mjs` ALLOWED_UNLISTED for new docs

## Prerequisites

1. **Worktree exists** — never fan out from main checkout
2. **Current model/provider pair** — follow `MODELS.md`, refresh the free catalog with
   `node scripts/free-model-pool.mjs --list`, and pass the exact eligible model and
   provider together. Do not treat swarm status as budget telemetry.
   Free children must use a verified read-only profile; if the host cannot deny and verify Bash
   and file-mutation tools, use the tool-free completion runner.
3. **One file per subagent** — never two agents on one file
4. **Wave limit** — at most 3 subagents; use fewer when current budget or provider
   limits require it
5. **Task scope is tiny** — one small outcome, not a broad rewrite

## Before Phase 1: Create and verify the task worktree

Follow `AGENTS.md` before any Git command or child launch. The task checkout belongs under the
repository root's `.kilo/worktrees/`, even when the selected main worktree is itself inside that
directory.

```bash
git worktree list --porcelain
# Select the absolute path from the stanza with: branch refs/heads/main
MAIN_WORKTREE="<absolute-main-worktree-path>"
TASK_NAME="test-improve-<slug>"
: "${MAIN_WORKTREE:?Set MAIN_WORKTREE from the refs/heads/main worktree stanza}"
if [ "$MAIN_WORKTREE" = "<absolute-main-worktree-path>" ] || [ "$TASK_NAME" = "test-improve-<slug>" ]; then
  printf 'Replace the main-worktree and task-name placeholders before continuing\n' >&2
  exit 1
fi
GIT_COMMON_DIR="$(git -C "$MAIN_WORKTREE" rev-parse --path-format=absolute --git-common-dir)"
PROJECT_ROOT="$(dirname "$GIT_COMMON_DIR")"
case "$MAIN_WORKTREE" in
  "$PROJECT_ROOT"|"$PROJECT_ROOT"/.kilo/worktrees/*) ;;
  *) printf 'Selected main worktree is outside the expected repository: %s\n' "$MAIN_WORKTREE" >&2; exit 1 ;;
esac
TASK_WORKTREE="$PROJECT_ROOT/.kilo/worktrees/$TASK_NAME"
cd "$MAIN_WORKTREE" || exit 1
pwd
git -C "$MAIN_WORKTREE" rev-parse --show-toplevel
git -C "$MAIN_WORKTREE" rev-parse --git-dir --git-common-dir
test "$(pwd -P)" = "$(git rev-parse --show-toplevel)" || exit 1
test "$(git rev-parse --abbrev-ref HEAD)" = "main" || exit 1
git -C "$MAIN_WORKTREE" worktree add -b "task/$TASK_NAME" "$TASK_WORKTREE" main
cd "$TASK_WORKTREE" || exit 1
pwd
git rev-parse --show-toplevel
git rev-parse --git-dir --git-common-dir
test "$(pwd -P)" = "$(git rev-parse --show-toplevel)" || exit 1
```

Create and verify the checkout before launching children. Give each child its absolute path and an
empty write set.

## Phase 1: Exploration (2 waves × up to 3 agents)

### Task Template (Exploration)

Summarize supplied stack traces without source line numbers; use the file path and test or symbol
name to identify the failure.

```json
{
  "description": "Explore: <file-path>",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "READ-ONLY exploration. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>. The coordinator supplies the latest test result summary; do not run commands. If no result is supplied, set testCounts to null.\n\nReturn ONLY a JSON object (no prose) with these keys:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"imports\": [\"exact import specifiers from the file\"],\n  \"helpers\": [\"function/class names defined in the file\"],\n  \"fixtures\": [\"test fixtures or factories used\"],\n  \"testCounts\": {\"pass\": <n>, \"fail\": <n>, \"skip\": <n>} | null,\n  \"crashPoint\": \"exact supplied error if any, else null\",\n  \"staleAssertions\": [\"description of assertions that contradict current production code\"],\n  \"missingCoverage\": [\"what the file should test but doesn't\"],\n  \"dependencies\": [\"other test files this file depends on or mirrors\"],\n  \"productionSymbols\": [\"production functions/types this test imports or mocks\"]\n}\n\nRead only the assigned file, related production code, and supplied output. Do not edit or write files, run shell/npm/npx commands, use Git, or use file-mutation tools. If operating through the tool-free completion runner, rely only on the source and output excerpts in this prompt. Output pure JSON."
}
```

### Wave 1a — First 3 test files

Launch up to 3 `task` subagents in parallel with the template above, each targeting a
different test file.

### Wave 1b — Next 3 test files

After Wave 1a completes, read `wave-1a-exploration.json`, then launch Wave 1b
for the next 3 files.

**Coordinator persists after each wave:**

```bash
cat wave-1a-*.json | jq -s . > .kilo/plans/wave-1a-exploration.json
```

## Phase 2: Proposals (2 waves × up to 3 agents)

### Task Template (Test Proposal)

```json
{
  "description": "Propose test changes: <file-path>",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "READ-ONLY test proposal. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nRead the exploration JSON and source excerpts supplied in this prompt. Your exploration summary for THIS file:\n<PASTE_THIS_FILES_EXPLORATION_JSON>\n\nPropose a focused test change. Return a unified diff, or the complete file content only for a new file. Do NOT edit or write files. Return ONLY JSON:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"action\": \"create\" | \"modify\",\n  \"proposal\": \"<UNIFIED_DIFF_OR_COMPLETE_NEW_FILE_CONTENT>\",\n  \"imports\": [\"import specifiers used\"],\n  \"helpers\": [\"helper functions defined\"],\n  \"testCases\": [\"descriptive names of tests proposed\"],\n  \"evidence\": [\"source symbols and test contracts supporting the proposal\"]\n}\n\nConstraints:\n- Use EXACT imports and helper signatures from exploration\n- Mirror patterns from sibling test files (HistoryTab.test.tsx pattern for panel tests)\n- Do NOT weaken assertions to go green\n- Do NOT add `data-testid` to production\n- Do not run shell/npm/npx commands, tests, builds, or Git; do not use file-mutation tools\n- If output limit is reached, return a concise JSON summary with \"proposalStatus\": \"incomplete\" and say what context or output is missing"
}
```

### Wave 2a — First 3 files

Launch up to 3 subagents with their per-file exploration data.

### Wave 2b — Next 3 files

After Wave 2a, read its plan, launch Wave 2b for different files.

**Persist after each wave:**

```bash
cat wave-2a-*.json | jq -s . > .kilo/plans/wave-2a-proposals.json
```

The coordinator reviews each proposal, applies accepted changes in the task worktree, and owns all
file writes. Free children return proposals in their task response only.

## Phase 3: Coordinator Verification and Read-Only Review

The coordinator runs the repository's focused test command for all changed files, plus applicable
`npm run tsc`, `npm run lint:check`, and build gates, from the verified task worktree. Free children
do not run these commands. A read-only reviewer can inspect the candidate diff and the complete,
bounded outputs the coordinator supplies, then report any mismatch between the proposed tests,
source contracts, and observed gate results.

### Task Template (Review)

```json
{
  "description": "Read-only review: test hardening batch",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "READ-ONLY review. Worktree: <ABSOLUTE_WORKTREE_PATH>.\n\nReview the supplied candidate diff, exploration summaries, proposal summaries, and coordinator-provided focused test, typecheck, lint, and build outputs. Do not run commands or infer a passing gate when its output was not supplied.\n\nReturn ONLY JSON:\n{\n  \"findings\": [{\"file\": \"<FILE_PATH>\", \"identifier\": \"symbol, test name, heading, or unique phrase\", \"evidence\": \"<specific source or supplied output>\", \"failure\": \"<concrete risk>\"}],\n  \"missingEvidence\": [\"gate or context not supplied\"],\n  \"coverageConcerns\": [\"specific scenario not covered\"]\n}\n\nDo not include source line numbers. Do not edit or write files, run shell/npm/npx commands, tests, builds, or Git, or use file-mutation tools. The coordinator owns gate results, the landing decision, and Git operations."
}
```

## Phase 4: Fix Proposals & Loop Back (1-3 children)

### Task Template (Fixes)

```json
{
  "description": "Propose a test fix: <file-path>",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "READ-ONLY fix proposal. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nRead the supplied review findings and source excerpts. Failure:\n<PASTE_FAILURE_JSON>\n\nPropose the smallest correction. Return ONLY JSON:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"proposal\": \"<UNIFIED_DIFF_OR_EDIT_INSTRUCTIONS>\",\n  \"evidence\": [\"source contract and test behavior supporting the fix\"]\n}\n\nDo not edit or write files, run shell/npm/npx commands, tests, builds, or Git, or use file-mutation tools. Do NOT add new test cases beyond fixing the reported failure. The coordinator applies and verifies accepted proposals."
}
```

### Loop Protocol

After Phase 3, the coordinator reads `wave-3-review.json` alongside actual focused-test,
typecheck, lint, and build results.

1. If coordinator-run gates pass, the review has no unresolved blocking findings, and all required
   evidence is present, the coordinator follows repository landing procedure. A review response
   never authorizes a commit by itself.
2. If a gate fails, a blocking finding remains, or evidence is missing, request one focused fix
   proposal for each affected file (max 3 concurrent). The coordinator applies accepted proposals,
   reruns applicable gates, and records the updated state in the plan.
3. Limit fix/review loops to three per target. If the issue remains, stop and record the unresolved
   evidence and blocker in the durable handoff.

## Crash Recovery Protocol

If ANY subagent dies (output limit, timeout, crash):

1. **Read the latest plan file** — it has all completed work
2. **Identify which file(s) are incomplete** — missing from the plan or marked `TRUNCATED`
3. **Re-launch ONLY that file** with the same phase template, passing prior plan context
4. **Never re-do completed files** — their JSON is already in the plan

Example recovery:

```bash
# Check what's in the plan
cat .kilo/plans/wave-2a-proposals.json | jq '.[] | .file'

# Re-launch only the missing file
# (use the Test Proposal template with that file's exploration data)
```

## Model Selection

Use the current catalog and rules in `MODELS.md`; this skill does not maintain a
model list or provider quota. Before every launch, the coordinator runs
`node scripts/free-model-pool.mjs --list` to verify current zero-priced choices.
Pass the exact model/provider pair to Kilo `task` and verify the resolved model.
If the budget or free route is uncertain or exhausted, stop instead of silently
falling back to a paid model.

## File Scope Rules

- **One test file per subagent** — no overlap
- **Test files only** — never touch production
- **Imports from exploration** — use exact specifiers found
- **Mirror existing patterns** — HistoryTab.test.tsx is the gold standard for panel tests
- **No `git` operations in subagents** — coordinator commits
- **No merge or push by subagents** — coordinator handles landing

## Example Plan Structure

`.kilo/plans/wave-1a-exploration.json`:

The values below are illustrative only; they are not a current test baseline or a live defect list.

```json
[
  {
    "file": "src/components/Mobile/__tests__/MobileLayersDrawer.test.tsx",
    "imports": ["useHistory", "selectHistoryPanelProjection", "HistoryItem"],
    "helpers": ["seedHistory", "openHistoryTab", "historyRow", "rewindControl", "eyeControl"],
    "fixtures": ["storeStateMock", "freshLayers"],
    "testCounts": { "pass": 0, "fail": 33, "skip": 0 },
    "crashPoint": "TypeError: Cannot read properties of undefined (reading 'rows') in MobileLayersDrawer",
    "staleAssertions": [],
    "missingCoverage": ["historyPanelProjection mock fixture"],
    "dependencies": ["src/components/SidebarRight/__tests__/HistoryTab.test.tsx"],
    "productionSymbols": ["useHistory", "selectHistoryPanelProjection"]
  }
]
```

## Never

- Launch more than 3 subagents concurrently
- Put two subagents on the same file
- Skip the exploration phase
- Output prose instead of JSON from subagents
- Commit without the review wave passing
- Use `git add -A` or `git stash` in the worktree
- Run from the main checkout
- Assign free-model subagents to any Git operations
- Let a subagent merge or push to origin
- Let a free child edit any file; children may propose test changes, and the coordinator applies them
