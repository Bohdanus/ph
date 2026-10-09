---
name: parallel-test-hardening
description: Harden and write tests in the `ph` photo editor using wave-based parallel subagents designed for weaker free models (Nemotron, Dots3, Step 3.7). Launches 3 subagents per wave, records all findings in `.kilo/plans/` for crash survival, three phases: exploration → writing → review.
---

# Parallel Test Hardening for Free Models

Free models (Nemotron 3 Ultra, Dots3-Note Preview, Step 3.7 Flash) have smaller context windows, hit output limits, and lose coherence on complex multi-file tasks. This skill fans out **three subagents per wave** — one file per agent — with structured hand-offs persisted to `.kilo/plans/` so crashes don't lose progress.

## When to Use

- Test suite is green but brittle / stale / missing coverage
- Multiple test files need updates after a production change
- You need to write several new test files from scratch
- Previous subagent attempts hit output limits or produced no edits

## Architecture

| Phase | Wave | Subagents | Output |
|-------|------|-----------|--------|
| **1. Exploration** | W1a | 3 | `.kilo/plans/wave-1a-exploration.json` — per-file: imports, helpers, fixtures, test gaps, stale assertions, crash points |
| | W1b | 3 (different files) | `.kilo/plans/wave-1b-exploration.json` |
| **2. Writing** | W2a | 3 | `.kilo/plans/wave-2a-writing.json` — per-file: complete diff or new file content, import list, helper signatures |
| | W2b | 3 (different files) | `.kilo/plans/wave-2b-writing.json` |
| **3. Review** | W3 | 1 (aggregator) | `.kilo/plans/wave-3-review.json` — pass/fail, typecheck, lint, coverage delta, merge plan |

Each wave writes its JSON **before** launching the next. If a subagent dies, re-read the plan and relaunch only that file.

## Prerequisites

1. **Worktree exists** — never fan out from main checkout
2. **Model + provider explicit** — `Nemotron 3 Ultra` + `kilo`, `Dots3-Note Preview` + `kilo`, or `Step 3.7 Flash` + `kilo`
3. **One file per subagent** — never two agents on one file
4. **`provider` must be `kilo`** for free models

## Phase 1: Exploration (2 waves × 3 agents)

### Task Template (Exploration)

```json
{
  "description": "Explore: <file-path>",
  "model": "Nemotron 3 Ultra",
  "provider": "kilo",
  "variant": "high",
  "prompt": "READ-ONLY exploration. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nReturn ONLY a JSON object (no prose) with these keys:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"imports\": [\"exact import specifiers from the file\"],\n  \"helpers\": [\"function/class names defined in the file\"],\n  \"fixtures\": [\"test fixtures or factories used\"],\n  \"testCounts\": {\"pass\": <n>, \"fail\": <n>, \"skip\": <n>} (run vitest on this file first),\n  \"crashPoint\": \"exact error if any, else null\",\n  \"staleAssertions\": [\"description of assertions that contradict current production code\"],\n  \"missingCoverage\": [\"what the file should test but doesn't\"],\n  \"dependencies\": [\"other test files this file depends on or mirrors\"],\n  \"productionSymbols\": [\"production functions/types this test imports or mocks\"]\n}\n\nDo NOT edit files. Run `npx vitest run <FILE_PATH> 2>&1` first. If it crashes, capture the error. Then read the file and related production code. Output pure JSON."
}
```

### Wave 1a — First 3 test files
Launch 3 `task` subagents in parallel with the template above, each targeting a different test file.

### Wave 1b — Next 3 test files
After Wave 1a completes, read `wave-1a-exploration.json`, then launch Wave 1b for the next 3 files.

**Persist after each wave:**
```bash
# After wave completes, merge individual JSONs into the plan file
cat wave-1a-*.json | jq -s . > .kilo/plans/wave-1a-exploration.json
```

## Phase 2: Writing (2 waves × 3 agents)

### Task Template (Writing)

```json
{
  "description": "Write: <file-path>",
  "model": "Nemotron 3 Ultra",
  "provider": "kilo",
  "variant": "high",
  "prompt": "WRITE-ONLY task. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nRead `.kilo/plans/wave-1a-exploration.json` and `wave-1b-exploration.json` for context.\n\nYour exploration summary for THIS file:\n<PASTE_THIS_FILES_EXPLORATION_JSON>\n\nWrite the COMPLETE new file content (or a unified diff if editing). Do NOT output prose. Return ONLY JSON:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"action\": \"create\" | \"replace\",\n  \"content\": \"<ENTIRE_FILE_CONTENT_AS_STRING>\",\n  \"imports\": [\"import specifiers used\"],\n  \"helpers\": [\"helper functions defined\"],\n  \"testCases\": [\"descriptive names of test cases added/changed\"],\n  \"verificationCommand\": \"npx vitest run <FILE_PATH> 2>&1\"\n}\n\nConstraints:\n- Use EXACT imports and helper signatures from exploration\n- Mirror patterns from sibling test files (HistoryTab.test.tsx pattern for panel tests)\n- Do NOT weaken assertions to go green\n- Do NOT add `data-testid` to production\n- Run ONLY the verification command and report exact pass/fail\n- If output limit hit, output the JSON with \"content\": \"TRUNCATED\" and re-launch with \"continue from line N\""
}
```

### Wave 2a — First 3 files
Launch 3 subagents with their per-file exploration data.

### Wave 2b — Next 3 files
After Wave 2a, read its plan, launch Wave 2b.

**Persist after each wave:**
```bash
cat wave-2a-*.json | jq -s . > .kilo/plans/wave-2a-writing.json
```

## Phase 3: Review (1 aggregator agent)

### Task Template (Review)

```json
{
  "description": "Review: test hardening batch",
  "model": "Nemotron 3 Ultra",
  "provider": "kilo",
  "variant": "high",
  "prompt": "REVIEW task. Worktree: <ABSOLUTE_WORKTREE_PATH>.\n\nRead `.kilo/plans/wave-1a-exploration.json`, `wave-1b-exploration.json`, `wave-2a-writing.json`, `wave-2b-writing.json`.\n\nRun verification for ALL changed files:\n- `npx vitest run <FILE1> <FILE2> ... 2>&1`\n- `npm run tsc` (typecheck)\n- `npm run lint` if available\n\nReturn ONLY JSON:\n{\n  \"allTestsPass\": true | false,\n  \"typecheckPass\": true | false,\n  \"lintPass\": true | false,\n  \"filesVerified\": [\"<FILE_PATH>\", ...],\n  \"failures\": [{\"file\": \"<FILE_PATH>\", \"error\": \"<exact error>\"}],\n  \"coverageDelta\": {\"lines\": <n>, \"branches\": <n>, \"functions\": <n>} (if measurable),\n  \"mergePlan\": [\"git add <FILE1>\", \"git add <FILE2>\", ...],\n  \"readyToCommit\": true | false,\n  \"loopAgain\": true | false\n}\n\nIf any file fails, output the exact error and STOP — do not commit. Set \"loopAgain\": true if coverage gaps remain or new production changes landed."
}
```

## Phase 4: Fixes & Loop Back (1-3 agents)

### Task Template (Fixes)

```json
{
  "description": "Fix: <file-path>",
  "model": "Nemotron 3 Ultra",
  "provider": "kilo",
  "variant": "high",
  "prompt": "FIX task. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nRead `.kilo/plans/wave-3-review.json` — it contains failures for this file.\n\nYour failure:\n<PASTE_FAILURE_JSON>\n\nFix ONLY the reported failure. Return ONLY JSON:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"action\": \"replace\",\n  \"content\": \"<ENTIRE_FILE_CONTENT_AS_STRING>\",\n  \"verificationCommand\": \"npx vitest run <FILE_PATH> 2>&1\"\n}\n\nRun the verification command and confirm pass. Do NOT add new test cases beyond fixing the failure."
}
```

### Loop Protocol

After Phase 3 Review:

1. **If `readyToCommit: true` AND `loopAgain: false`** → Commit and STOP. Hardening complete.

2. **If `readyToCommit: false` OR `loopAgain: true`** → Enter Wave 4 (Fixes):
   - Launch 1-3 fix agents for each failed file (max 3 concurrent)
   - Each fix agent outputs its JSON to `wave-4-fixes.json`
   - After all fixes pass, **loop back to Phase 1 (Exploration)** with updated file list
   - Increment wave numbers: `wave-1c-exploration.json`, `wave-2c-writing.json`, `wave-3-review.json` (overwrite)

3. **Maximum 3 loops** — after 3 full cycles, escalate to HANDOFF.md if still not green.

**Loop counter persisted in `.kilo/plans/loop-count.json`:**
```json
{"loop": 1, "maxLoops": 3, "lastWave": "wave-3-review"}
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

## Model Selection Guide

| Model | Provider | Variant | Best For |
|-------|----------|---------|----------|
| Nemotron 3 Ultra | kilo | high | Exploration (thorough, slow) |
| Nemotron 3 Ultra | kilo | high | Writing (careful, verbose) |
| Dots3-Note Preview | kilo | thinking | Review (fast, structured) |
| Step 3.7 Flash | kilo | high | Writing (fast, accurate) |

**Never use Poolside Laguna S 2.1** — rate limited to 2 concurrent, expires often.

## File Scope Rules

- **One test file per subagent** — no overlap
- **Test files only** — never touch production
- **Imports from exploration** — use exact specifiers found
- **Mirror existing patterns** — HistoryTab.test.tsx is the gold standard for panel tests
- **No `git` operations** in subagents — coordinator commits

## Example Plan Structure

`.kilo/plans/wave-1a-exploration.json`:
```json
[
  {
    "file": "src/components/Mobile/__tests__/MobileLayersDrawer.test.tsx",
    "imports": ["useHistory", "selectHistoryPanelProjection", "HistoryItem"],
    "helpers": ["seedHistory", "openHistoryTab", "historyRow", "rewindControl", "eyeControl"],
    "fixtures": ["storeStateMock", "freshLayers"],
    "testCounts": {"pass": 0, "fail": 33, "skip": 0},
    "crashPoint": "TypeError: Cannot read properties of undefined (reading 'rows') at MobileLayersDrawer.tsx:34",
    "staleAssertions": [],
    "missingCoverage": ["historyPanelProjection mock fixture", "durable fallback row rendering", "gesture gate with projection"],
    "dependencies": ["src/components/SidebarRight/__tests__/HistoryTab.test.tsx"],
    "productionSymbols": ["useHistory", "selectHistoryPanelProjection", "getHistoryItemTitle"]
  },
  ...
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