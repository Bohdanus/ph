---
name: parallel-test-hardening
description: >-
  Harden and write tests in the `ph` photo editor using wave-based parallel
  subagents. Launch up to 3 subagents per wave, persist findings to `.kilo/plans/`
  for crash survival, and cycle exploration → writing → review → fixes → loop-back.
  Subagents return proposed test content; the coordinator owns file writes and all
  Git operations.
---

# Parallel Test Hardening for Free Models

Free model catalogs and limits change. Keep each task to one test file, request a
compact structured result, and persist hand-offs in `.kilo/plans/` before starting
the next wave. Select models from the refreshed catalog according to `MODELS.md`;
do not reuse model names, variants, or quotas from old runs.

## Crash Analysis

**Root cause of previous failures:** Broad multi-file tasks exceeded model output
budgets during exploration. Keep subtasks narrow and save concise results before
launching another wave. This history is not a permanent ban on any model; use the
current catalog and policy in `MODELS.md`.

**Fixes applied in this skill:**

1. **One narrow outcome per subagent** — one small edit, one test case, no
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

| Phase              | Wave | Subagents                | Output                                                                                                                   |
| ------------------ | ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **1. Exploration** | W1a  | Up to 3, one file each   | `.kilo/plans/wave-1a-exploration.json` — per-file: imports, helpers, fixtures, test gaps, stale assertions, crash points |
|                    | W1b  | Up to 3, different files | `.kilo/plans/wave-1b-exploration.json`                                                                                   |
| **2. Writing**     | W2a  | Up to 3, one file each   | `.kilo/plans/wave-2a-writing.json` — per-file: complete file content, import list, helper signatures                     |
|                    | W2b  | Up to 3, different files | `.kilo/plans/wave-2b-writing.json`                                                                                       |
| **3. Review**      | W3   | 1 (aggregator)           | `.kilo/plans/wave-3-review.json` — pass/fail, typecheck, lint, coverage delta                                            |
| **4. Fixes**       | W4   | 1-3                      | `.kilo/plans/wave-4-fixes.json` — per-file: failure + fix                                                                |

Each wave writes its JSON **before** launching the next. If a subagent dies,
re-read the plan and relaunch only that file.

## Safety Constraints (READ BEFORE LAUNCHING)

### Subagents MUST NOT:

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
- Modify `.kilo/plans/` JSON files for crash recovery
- Update `scripts/__tests__/docs-index.test.mjs` ALLOWED_UNLISTED for new docs

## Prerequisites

1. **Worktree exists** — never fan out from main checkout
2. **Current model/provider pair** — follow `MODELS.md`, inspect the newest
   `npm run swarm -- tokens --json` reading, refresh the free catalog, and pass the
   exact model and provider together
3. **One file per subagent** — never two agents on one file
4. **Wave limit** — at most 3 subagents; use fewer when current budget or provider
   limits require it
5. **Task scope is tiny** — one small outcome, not a broad rewrite

## Phase 1: Exploration (2 waves × up to 3 agents)

### Task Template (Exploration)

```json
{
  "description": "Explore: <file-path>",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "READ-ONLY exploration. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nReturn ONLY a JSON object (no prose) with these keys:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"imports\": [\"exact import specifiers from the file\"],\n  \"helpers\": [\"function/class names defined in the file\"],\n  \"fixtures\": [\"test fixtures or factories used\"],\n  \"testCounts\": {\"pass\": <n>, \"fail\": <n>, \"skip\": <n>},\n  \"crashPoint\": \"exact error if any, else null\",\n  \"staleAssertions\": [\"description of assertions that contradict current production code\"],\n  \"missingCoverage\": [\"what the file should test but doesn't\"],\n  \"dependencies\": [\"other test files this file depends on or mirrors\"],\n  \"productionSymbols\": [\"production functions/types this test imports or mocks\"]\n}\n\nDo NOT edit files. Run `npx vitest run <FILE_PATH> 2>&1` first. If it crashes, capture the error. Then read the file and related production code. Output pure JSON."
}
```

### Wave 1a — First 3 test files

Launch up to 3 `task` subagents in parallel with the template above, each targeting a
different test file.

### Wave 1b — Next 3 test files

After Wave 1a completes, read `wave-1a-exploration.json`, then launch Wave 1b
for the next 3 files.

**Persist after each wave:**

```bash
cat wave-1a-*.json | jq -s . > .kilo/plans/wave-1a-exploration.json
```

## Phase 2: Writing (2 waves × up to 3 agents)

### Task Template (Writing)

```json
{
  "description": "Write: <file-path>",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "WRITE-ONLY task. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nRead `.kilo/plans/wave-1a-exploration.json` and `wave-1b-exploration.json` for context.\n\nYour exploration summary for THIS file:\n<PASTE_THIS_FILES_EXPLORATION_JSON>\n\nWrite the COMPLETE new file content (or a unified diff if editing). Do NOT output prose. Return ONLY JSON:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"action\": \"create\" | \"replace\",\n  \"content\": \"<ENTIRE_FILE_CONTENT_AS_STRING>\",\n  \"imports\": [\"import specifiers used\"],\n  \"helpers\": [\"helper functions defined\"],\n  \"testCases\": [\"descriptive names of test cases added/changed\"],\n  \"verificationCommand\": \"npx vitest run <FILE_PATH> 2>&1\"\n}\n\nConstraints:\n- Use EXACT imports and helper signatures from exploration\n- Mirror patterns from sibling test files (HistoryTab.test.tsx pattern for panel tests)\n- Do NOT weaken assertions to go green\n- Do NOT add `data-testid` to production\n- Do NOT run git, commit, merge, or push\n- Run ONLY the verification command and report exact pass/fail\n- If output limit hit, output the JSON with \"content\": \"TRUNCATED\" and re-launch with \"continue from line N\""
}
```

### Wave 2a — First 3 files

Launch up to 3 subagents with their per-file exploration data.

### Wave 2b — Next 3 files

After Wave 2a, read its plan, launch Wave 2b.

**Persist after each wave:**

```bash
cat wave-2a-*.json | jq -s . > .kilo/plans/wave-2a-writing.json
```

## Phase 3: Review (1 read-only aggregator)

### Task Template (Review)

```json
{
  "description": "Review: test hardening batch",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "REVIEW task. Worktree: <ABSOLUTE_WORKTREE_PATH>.\n\nRead `.kilo/plans/wave-1a-exploration.json`, `wave-1b-exploration.json`, `wave-2a-writing.json`, `wave-2b-writing.json`.\n\nRun verification for ALL changed files:\n- `npx vitest run <FILE1> <FILE2> ... 2>&1`\n- `npm run tsc` (typecheck)\n- `npm run lint` if available\n\nReturn ONLY JSON:\n{\n  \"allTestsPass\": true | false,\n  \"typecheckPass\": true | false,\n  \"lintPass\": true | false,\n  \"filesVerified\": [\"<FILE_PATH>\", ...],\n  \"failures\": [{\"file\": \"<FILE_PATH>\", \"error\": \"<exact error>\"}],\n  \"coverageDelta\": {\"lines\": <n>, \"branches\": <n>, \"functions\": <n>},\n  \"mergePlan\": [\"git add <FILE1>\", \"git add <FILE2>\", ...],\n  \"readyToCommit\": true | false,\n  \"loopAgain\": true | false\n}\n\nIf any file fails, output the exact error. Set \"loopAgain\": true if coverage gaps remain or new production changes landed. The coordinator commits only if allTestsPass AND typecheckPass AND readyToCommit are true."
}
```

## Phase 4: Fixes & Loop Back (1-3 agents)

### Task Template (Fixes)

```json
{
  "description": "Fix: <file-path>",
  "model": "<exact-free-model-id-from-current-catalog>",
  "provider": "<matching-provider-from-current-catalog>",
  "prompt": "FIX task. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nRead `.kilo/plans/wave-3-review.json` — it contains failures for this file.\n\nYour failure:\n<PASTE_FAILURE_JSON>\n\nFix ONLY the reported failure. Return ONLY JSON:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"action\": \"replace\",\n  \"content\": \"<ENTIRE_FILE_CONTENT_AS_STRING>\",\n  \"verificationCommand\": \"npx vitest run <FILE_PATH> 2>&1\"\n}\n\nRun the verification command and confirm pass. Do NOT add new test cases beyond fixing the failure. Do NOT run git, commit, merge, or push."
}
```

### Loop Protocol

After Phase 3 Review, read `wave-3-review.json`:

1. **If `allTestsPass: true` AND `typecheckPass: true` AND `readyToCommit: true` AND `loopAgain: false`** → Coordinator commits and STOP. Hardening complete.

2. **If `readyToCommit: false` OR `loopAgain: true` OR not all pass** → Enter Wave 4 (Fixes):
   - For each failed file, launch 1 fix agent (max 3 concurrent)
   - Each fix agent outputs JSON to `wave-4-fixes.json`
   - After all fixes pass, **loop back to Phase 1 (Exploration)**
   - Increment loop counter in `.kilo/plans/loop-count.json`

3. **Maximum 3 loops** — after 3 full cycles (W1a→W1b→W2a→W2b→W3→W4), escalate to
   HANDOFF.md if still not green.

**Loop counter persisted in `.kilo/plans/loop-count.json`:**

```json
{ "loop": 1, "maxLoops": 3, "lastWave": "wave-3-review" }
```

## Crash Recovery Protocol

If ANY subagent dies (output limit, timeout, crash):

1. **Read the latest plan file** — it has all completed work
2. **Identify which file(s) are incomplete** — missing from the plan or marked `TRUNCATED`
3. **Re-launch ONLY that file** with the same phase template, passing prior plan context
4. **Never re-do completed files** — their JSON is already in the plan

Example recovery:

```bash
# Check what's in the plan
cat .kilo/plans/wave-2a-writing.json | jq '.[] | .file'

# Re-launch only the missing file
# (use the Writing template with that file's exploration data)
```

## Model Selection

Use the current catalog and rules in `MODELS.md`; this skill does not maintain a
model list or provider quota. Before every launch, the coordinator inspects the
newest `npm run swarm -- tokens --json` reading and runs
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

```json
[
  {
    "file": "src/components/Mobile/__tests__/MobileLayersDrawer.test.tsx",
    "imports": ["useHistory", "selectHistoryPanelProjection", "HistoryItem"],
    "helpers": ["seedHistory", "openHistoryTab", "historyRow", "rewindControl", "eyeControl"],
    "fixtures": ["storeStateMock", "freshLayers"],
    "testCounts": { "pass": 0, "fail": 33, "skip": 0 },
    "crashPoint": "TypeError: Cannot read properties of undefined (reading 'rows') at MobileLayersDrawer.tsx:34",
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
- Edit source files from a subagent — tests only
