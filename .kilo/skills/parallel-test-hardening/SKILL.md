name: parallel-test-hardening
description: >-
  Harden and write tests in the `ph` photo editor using wave-based parallel
  subagents. 3 subagents per wave max (Nemotron + 1 Laguna), findings persisted
  to `.kilo/plans/` for crash survival. Three phases: exploration → writing →
  review. Nemotron subagents may write and fix tests during review; if review
  finds massive issues the review wave repeats. NO subagent or coordinator may
  merge or push — landing is handled by a separate merge skill.
---

# Parallel Test Hardening for Free Models

Free models have smaller context windows, hit output limits, and lose coherence on
complex multi-file tasks. This skill fans out **3 subagents per wave** with
structured hand-offs persisted to `.kilo/plans/` so crashes don't lose progress.

## Crash Analysis

**Root cause of previous failures:** Subagents used 4× `Poolside Laguna S 2.1`
with `variant: thinking` simultaneously. Laguna was rate-limited and exhausted
output budget during exploration on complex multi-file tasks. Most subagents
died with no output written.

**Fixes applied in this skill:**

1. **Nemotron 3 Ultra (high) is the primary writer/explorer** — no output-limit
   deaths observed; thorough. **One Laguna (thinking) max per wave** as a
   secondary agent for narrow tasks.
2. **One narrow outcome per subagent** — one small edit, one test case, no broad
   rewrites
3. **JSON-only output** — subagents return structured JSON, not prose
4. **Crash recovery via `.kilo/plans/`** — every wave's results persisted before
   the next wave launches; re-read and relaunch only the missing file
5. **NO Git in subagents** — not even exploration reads git status in subagents;
   coordinator runs git

## When to Use

- Test suite is green but brittle / stale / missing coverage
- Multiple test files need updates after a production change
- You need to write several new test files from scratch
- Previous subagent attempts hit output limits or produced no edits

## Architecture

| Phase | Wave | Subagents | Output |
|-------|------|-----------|--------|
| **1. Exploration** | W1a | 3 (2 Nemotron + 1 Laguna) | `.kilo/plans/wave-1a-exploration.json` |
| | W1b | 3 (2 Nemotron + 1 Laguna) | `.kilo/plans/wave-1b-exploration.json` |
| **2. Writing** | W2a | 3 (2 Nemotron + 1 Laguna) | `.kilo/plans/wave-2a-writing.json` |
| | W2b | 3 (2 Nemotron + 1 Laguna) | `.kilo/plans/wave-2b-writing.json` |
| **3. Review** | W3 | 1 (Nemotron) | `.kilo/plans/wave-3-review.json` — pass/fail, issues |
| | W3-fix | 1-2 (Nemotron + optional Laguna) | Fixes + `wave-3-fixed.json` |
| | W3-recheck | 1 (Nemotron) | Repeats review if W3 found massive issues |

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

### Coordinator MUST NOT:
- **Merge** — use the worktree-merge-harvest skill
- **Push** — landing is a separate step
- `git add -A` or `git stash` in the worktree
- Skip the review wave

### Only the coordinator MAY:
- Commit test changes (`git add <specific test files>` + commit)
- Modify `.kilo/plans/` JSON files for crash recovery
- Update `scripts/__tests__/docs-index.test.mjs` ALLOWED_UNLISTED for new docs

## Prerequisites

1. **Worktree exists** — never fan out from main checkout
2. **Model + provider explicit** for each subagent
3. **One file per subagent** — never two agents on one file
4. **`provider` must be `kilo`** for free models
5. **Task scope is tiny** — one small outcome, not a broad rewrite

## Phase 1: Exploration (2 waves × 3 agents)

### Per-wave agent allocation

Launch exactly **3 subagents** per wave:
- **2× Nemotron 3 Ultra** (`provider: kilo`, `variant: high`) — primary explorers
- **1× Poolside Laguna S 2.1** (`provider: kilo`, `variant: thinking`) — narrow task only

### Task Template (Exploration)

```json
{
  "description": "Explore: <file-path>",
  "model": "Nemotron 3 Ultra",
  "provider": "kilo",
  "variant": "high",
  "prompt": "READ-ONLY exploration. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nReturn ONLY a JSON object (no prose) with these keys:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"imports\": [\"exact import specifiers from the file\"],\n  \"helpers\": [\"function/class names defined in the file\"],\n  \"fixtures\": [\"test fixtures or factories used\"],\n  \"testCounts\": {\"pass\": <n>, \"fail\": <n>, \"skip\": <n>},\n  \"crashPoint\": \"exact error if any, else null\",\n  \"staleAssertions\": [\"description of assertions that contradict current production code\"],\n  \"missingCoverage\": [\"what the file should test but doesn't\"],\n  \"dependencies\": [\"other test files this file depends on or mirrors\"],\n  \"productionSymbols\": [\"production functions/types this test imports or mocks\"]\n}\n\nDo NOT edit files, do NOT run git. Run only `npx vitest run <FILE_PATH> 2>&1`. If it crashes, capture the error. Then read the file and related production code. Output pure JSON."
}
```

### Wave 1a — First 3 test files
Launch 3 subagents in parallel, each targeting a different test file.

### Wave 1b — Next 3 test files
After Wave 1a completes, read `wave-1a-exploration.json`, then launch Wave 1b
for the next 3 files.

**Persist after each wave:**
```bash
cat wave-1a-*.json | jq -s . > .kilo/plans/wave-1a-exploration.json
```

## Phase 2: Writing (2 waves × 3 agents)

Same agent allocation: 2× Nemotron + 1× Laguna per wave.

### Task Template (Writing)

```json
{
  "description": "Write: <file-path>",
  "model": "Nemotron 3 Ultra",
  "provider": "kilo",
  "variant": "high",
  "prompt": "WRITE-ONLY task. Worktree: <ABSOLUTE_WORKTREE_PATH>. Target file: <FILE_PATH>.\n\nRead `.kilo/plans/wave-1a-exploration.json` and `wave-1b-exploration.json` for context.\n\nYour exploration summary for THIS file:\n<PASTE_THIS_FILES_EXPLORATION_JSON>\n\nWrite the COMPLETE new file content. Do NOT output prose. Return ONLY JSON:\n{\n  \"file\": \"<FILE_PATH>\",\n  \"action\": \"create\" | \"replace\",\n  \"content\": \"<ENTIRE_FILE_CONTENT_AS_STRING>\",\n  \"imports\": [\"import specifiers used\"],\n  \"helpers\": [\"helper functions defined\"],\n  \"testCases\": [\"descriptive names of test cases added/changed\"],\n  \"verificationCommand\": \"npx vitest run <FILE_PATH> 2>&1\"\n}\n\nConstraints:\n- Use EXACT imports and helper signatures from exploration\n- Mirror patterns from sibling test files\n- Do NOT weaken assertions to go green\n- Do NOT add `data-testid` to production\n- Do NOT run git, commit, merge, or push\n- Run ONLY the verification command and report exact pass/fail\n- If output limit hit, output the JSON with \"content\": \"TRUNCATED\" and re-launch with \"continue from line N\""
}
```

## Phase 3: Review (Nemotron aggregator + fix loop)

### Task Template (Review)

```json
{
  "description": "Review: test hardening batch",
  "model": "Nemotron 3 Ultra",
  "provider": "kilo",
  "variant": "high",
  "prompt": "REVIEW task. Worktree: <ABSOLUTE_WORKTREE_PATH>.\n\nRead `.kilo/plans/wave-1a-exploration.json`, `wave-1b-exploration.json`, `wave-2a-writing.json`, `wave-2b-writing.json`.\n\nRun verification for ALL changed files:\n- `npx vitest run <FILE1> <FILE2> ... 2>&1`\n- `npm run tsc` (typecheck)\n\nReturn ONLY JSON:\n{\n  \"allTestsPass\": true | false,\n  \"typecheckPass\": true | false,\n  \"filesVerified\": [\"<FILE_PATH>\", ...],\n  \"issues\": [{\"severity\": \"minor\" | \"massive\", \"file\": \"<FILE_PATH>\", \"error\": \"<exact error>\"}],\n  \"fixNeeded\": true | false,\n  \"allIssuesMinor\": true | false,\n  \"readyToCommit\": true | false\n}\n\nIf any file fails, output the exact error. If all issues are minor, the reviewer may fix them directly. If any issue is massive, do NOT fix — report and request another review wave."
}
```

### W3-fix (if needed)
- **1× Nemotron** (fixes minor issues directly, writes `wave-3-fixed.json`)
- **1× Laguna** (optional, narrow fix only)

### W3-recheck (if W3 found massive issues)
- **1× Nemotron** re-runs the review after W3-fix
- If still massive issues → escalate to HANDOFF.md

### Commit gate
Only the coordinator commits, and ONLY if:
- `allTestsPass: true`
- `typecheckPass: true`
- `readyToCommit: true`

**No merge, no push.** Use the worktree-merge-harvest skill for landing.

## Crash Recovery Protocol

If ANY subagent dies (output limit, timeout, crash):

1. **Read the latest plan file** — it has all completed work
2. **Identify which file(s) are incomplete** — missing from the plan or marked `TRUNCATED`
3. **Re-launch ONLY that file** with the same phase template, passing prior plan context
4. **Never re-do completed files** — their JSON is already in the plan
5. When re-launching a file whose agent died, keep tasks narrow — split a broad task into 2-3 smaller ones if needed

Example recovery:
```bash
# Check what's in the plan
cat .kilo/plans/wave-2a-writing.json | jq '.[] | .file'

# Re-launch only the missing file
# (use the Writing template with that file's exploration data)
```

## Model Selection Guide

| Model | Provider | Variant | Best For | Notes |
|-------|----------|---------|----------|-------|
| Nemotron 3 Ultra | kilo | high | Exploration, Writing, Review | Primary; no output-limit deaths |
| Poolside Laguna S 2.1 | kilo | thinking | Narrow secondary tasks only | Max 1 per wave; rate-limited |
| Dots3-Note Preview | kilo | — | **DO NOT USE** | Banned for subagents |
| Step 3.7 Flash | kilo | high | (unused) | Available if needed |

**Key rule:** 2× Nemotron + 1× Laguna per wave maximum. **3 concurrent subagents**, never more.

## File Scope Rules

- **One test file per subagent** — no overlap
- **Test files only** — never touch production
- **Imports from exploration** — use exact specifiers found
- **Mirror existing patterns** — HistoryTab.test.tsx is the gold standard for panel tests
- **No `git` operations in subagents** — coordinator commits
- **No merge or push** — by anyone; use worktree-merge-harvest skill

## Example Plan Structure

`.kilo/plans/wave-1a-exploration.json`:
```json
[
  {
    "file": "src/components/Mobile/__tests__/MobileLayersDrawer.test.tsx",
    "imports": ["useHistory", "selectHistoryPanelProjection", "HistoryItem"],
    "helpers": ["seedHistory", "openHistoryTab", "historyRow"],
    "fixtures": ["storeStateMock", "freshLayers"],
    "testCounts": {"pass": 0, "fail": 33, "skip": 0},
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
- Use more than 1 Laguna subagent per wave
- Put two subagents on the same file
- Skip the exploration phase
- Output prose instead of JSON from subagents
- Commit without the review wave passing
- Use `git add -A` or `git stash` in the worktree
- Run from the main checkout
- Assign free-model subagents to any Git operations
- Merge or push — **by anyone** — use the worktree-merge-harvest skill
- Edit source files from a subagent — tests only