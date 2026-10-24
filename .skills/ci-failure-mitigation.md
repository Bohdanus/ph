name: ci-failure-mitigation
description: >-
Analyzes non-browser CI failures (lint, typecheck, test, build, audit) from the
`ci` and `e2e-unit` jobs in GitHub Actions, fixes them via subagents who read CI
error logs to protect main context, then writes, reviews, commits, and merges.
Intentionally IGNORES browser-environment-dependent e2e spec failures (visual
regression baselines, pixel diffs, canvas rendering on Linux headless) unless
the failure is a logic defect that is OS-agnostic.
---

# CI Failure Mitigation Skill

This skill mitigates **non-browser CI failures** in the `ph` photo editor. It is
triggered when a CI run shows red in the `ci` or `e2e-unit` job, or in the `e2e` job
for **logic defects that are OS-agnostic** (not environment-specific rendering or
baseline mismatches).

## ⚠️ What This Skill IGNORES

### Browser / OS-specific e2e failures (do NOT attempt to fix):

- **Visual regression** — `e2e/export/visual-regression.spec.ts` JPEG/WebP/AVIF
  baseline comparisons, canvas pixel diffs, screenshot mismatches
  - **Canvas rendering** on headless Chrome/Linux/Windows vs. macOS
  - **Mouse/keyboard** interaction timing differences in headless mode
  - **Layout** differences due to font rendering or scrollbar width

> All of these are documented in `e2e/OPEN_PROBLEMS.md`. If an e2e failure appears
> to be in a browser spec but is actually a logic defect (e.g., "undo button not
> enabled", "expected state X but got Y"), the skill MAY address it.

### Known e2e environment-bound issues:

- Visual regression baselines: `darwin/` and `win32/` are committed; `linux/` is missing. The available EC2 host is ARM64 and must not be used to create a baseline for the `ubuntu-latest` x86-64 runner.
- Canvas rendering differences between headless Chrome on Linux/Windows and macOS
- The suite runs headless in CI on a cross-platform matrix (Linux, Windows, macOS)

## What This Skill ADDRESSES

### `ci` job failures (ubuntu-latest):

1. **Lint** (`npm run lint:check`) — ESLint errors or Prettier formatting failures; ESLint warnings are reported but do not fail the current script by themselves
2. **Type-check** (`npm run tsc`) — TypeScript compilation errors
3. **Tracked-TS assertion** — TS files not in any project's `include`
4. **Test** (`npm run test -- --coverage`) — unit test failures
5. **Build** (`npm run build`) — bundler/vite build errors
6. **Audit** (`npm audit --audit-level=high`) — high-severity vulnerability advisories
7. **Upload app coverage** — coverage artifact missing (usually cascade from earlier failure)

### `e2e-unit` job failures:

1. **Unit test the e2e helpers** (`npm run test:e2e:unit`)
2. **Cover the e2e helpers** (`npm run test:e2e:unit:coverage`)

## E2E Failure Classification (OS-agnostic vs environment-bound)

Some e2e tests fail on CI but are NOT environment-bound — they indicate real logic
defects. The skill must distinguish:

| Failure Type                               | Classification    | Action                                                                                           |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------ |
| Visual regression baseline mismatch        | Environment-bound | IGNORE — document in OPEN_PROBLEMS.md                                                            |
| Baseline missing for a platform            | Environment-bound | Do not skip; record on the matching runner, review every image, and commit the platform baseline |
| Canvas pixel comparison                    | Environment-bound | IGNORE — document in OPEN_PROBLEMS.md                                                            |
| CDP capture-size assertion                 | Environment-bound | IGNORE — documented in OPEN_PROBLEMS.md                                                          |
| `undo` button not enabled / state mismatch | **Logic defect**  | **FIX**                                                                                          |
| Expected state X but got Y (non-rendering) | **Logic defect**  | **FIX**                                                                                          |
| Accessibility axe violations               | **Logic defect**  | **FIX**                                                                                          |
| ErrorBoundary omits diagnostics            | **Logic defect**  | **FIX**                                                                                          |
| Test interrupted (crash/hang)              | **Logic defect**  | **FIX**                                                                                          |

**When in doubt, classify as environment-bound and document it.** Only fix if the
failure is clearly about application logic, not rendering on a specific OS/browser.

## Architecture

```
1. Fetch CI run failures via gh CLI
2. Subagent #1: Analyze CI job — read logs, extract failure reasons
3. Subagent #2: Analyze e2e-unit job — read logs, extract failure reasons
4. Subagent #3 (optional): Analyze e2e job — classify failures as env-bound vs logic
5. Subagent #4: Fix CI failures (lint, typecheck, test, build)
6. Subagent #5: Review changes — run lint, tsc, test locally
7. Commit with Chat trailer
8. Merge via worktree-merge-harvest skill
```

## Safety Constraints

### Subagents MUST NOT:

- Edit production/source files (`src/` non-test files) — only for lint warning fixes, never for logic changes
- Run `git push` — coordinator commits and merges only
- Merge to main directly — use worktree-merge-harvest skill
- Weaken assertions to make tests pass
- Add `data-testid` to production components (unless required for e2e stability)
- Run from the main checkout (must be in a worktree)
- Modify `package.json`, `tsconfig.json`, `vitest.config.*`, or other config files — unless config is the actual fix

### Only the coordinator MAY:

- Create worktrees
- Commit changes (`git add <specific files>` + commit with `Chat:` trailer)
- Merge to main (with `Branch:` trailer) — via worktree-merge-harvest skill
- Modify `.kilo/plans/` JSON files for crash recovery
- Update `e2e/OPEN_PROBLEMS.md` for newly discovered environment-bound issues

## Prerequisites

1. **GitHub PAT available** — either via `gh auth login` or `GH_TOKEN` env var
2. **Worktree exists** — all fixes happen in a dedicated worktree, never main
3. **Model + provider explicit** for each subagent (no defaults)
4. **One file per subagent** — never two agents on the same file
5. **Subagent reads CI logs** to protect main context — subagents are dispatched
   with extracted error text, not full CI logs

## Phase 1: Fetch & Analyze CI Failures

### Step 1.1: Identify the failing run

```bash
export PATH="$HOME/.local/bin:$PATH"
GH_TOKEN=<token> gh run list --repo <owner>/<repo> --limit 5 --json \
  conclusion,createdAt,headBranch,workflowName,url,status
```

Find the most recent run of the `CI` workflow with `conclusion: "failure"`.

### Step 1.2: Get failing job details

```bash
GH_TOKEN=<token> gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs \
  --jq '.jobs[] | select(.conclusion=="failure") | {id: .id, name: .name}'
```

### Step 1.3: Extract logs with context

For each failing job, fetch logs with enough context to identify the root cause:

```bash
GH_TOKEN=<token> gh run view <run-id> --log --job <job-id> | \
  grep -E "^(error|warning|Error|##\[error|##\[warning)" -A 3
```

**Subagent #1 (CI job analyzer)** receives the extracted logs and returns JSON.
The example below is from an earlier run that explicitly failed on warnings; current
CI invokes `npm run lint:check`, which reports ESLint warnings without failing on
them alone:

```json
{
  "jobName": "ci",
  "jobId": 123456789,
  "failedSteps": [
    {
      "stepName": "Lint",
      "stepConclusion": "failure",
      "errorType": "lint-warning",
      "errorSummary": "50 warnings treated as errors (0 errors)",
      "filesInvolved": ["src/components/DesktopHeader/DesktopHeader.tsx", ...],
      "rootCause": "react-refresh/only-export-components warnings + prettier formatting"
    }
  ],
  "fixableFailures": true,
  "requiresSourceChanges": true
}
```

**Subagent #2 (e2e-unit job analyzer)** — same format for `e2e-unit` job.

**Subagent #3 (e2e job classifier)** — classifies e2e failures as environment-bound
or logic defects, returns:

```json
{
  "jobName": "e2e",
  "failedTests": [
    {
      "testFile": "e2e/export/visual-regression.spec.ts",
      "testName": "exports to JPEG matches visual baseline",
      "classification": "environment-bound",
      "reason": "Visual regression baseline recorded on macOS, CI runs headless Chrome on Linux"
    },
    {
      "testFile": "e2e/sponge-tool.spec.ts",
      "testName": "Vibrance confines a saturate stroke to one gamut-boundary channel per pixel",
      "classification": "logic-defect",
      "reason": "Test interrupted: undo button not enabled — state management issue, not rendering"
    }
  ],
  "logicDefects": ["sponge-tool.spec.ts:589"],
  "envBoundFailures": ["visual-regression.spec.ts:83", ...]
}
```

## Phase 2: Fix Non-Browser Failures

### Step 2.1: Create fix worktree

```bash
MAIN="$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)"
git worktree add -b fix/ci-failures-$(date +%Y%m%d) \
  "$MAIN/.kilo/worktrees/fix-ci-failures-$(date +%Y%m%d)"
```

### Step 2.2: Dispatch fix subagents

Each subagent targets ONE file or ONE category of failure:

**Subagent #4 (Lint fixes)** — receives the files with ESLint errors or Prettier
failures and fixes them one at a time. Returns JSON per file:

```json
{
  "file": "<affected-file>",
  "action": "fixed",
  "change": "<description, e.g., moved export to constants.ts to resolve react-refresh/only-export-components>",
  "verificationCommand": "npx eslint <affected-file>"
}
```

**Subagent #5 (Typecheck fixes)** — receives TSC errors and fixes them.
**Subagent #6 (Test fixes)** — receives test failures and fixes them.
**Subagent #7 (Build fixes)** — receives build errors and fixes them.

Each fix subagent:

1. Reads the specific file(s) involved
2. Makes minimal, targeted changes
3. Runs the verification command locally
4. Returns JSON with the result

## Phase 3: Review & Merge

### Step 3.1: Local verification

The coordinator runs:

```bash
cd <worktree>
npm run lint:check     # must exit 0 with no ESLint errors or Prettier failures
npm run tsc            # must pass
npm run test           # must pass
npm run build          # must pass
```

### Step 3.2: Commit

```bash
cd <worktree>
# Stage only specific files, never git add -A
git add <fix-files...>    # the source files the subagents edited
git add .skills/parallel-test-hardening.md

# Commit with Chat trailer
CHAT_ID=$(sqlite3 -readonly ~/.local/share/kilo/kilo.db \
  "SELECT s.id FROM session s JOIN message m ON m.session_id=s.id \
   JOIN part p ON p.message_id=m.id WHERE s.parent_id IS NULL \
   AND json_extract(p.data,'\$.type')='text' \
   AND lower(json_extract(p.data,'\$.text')) LIKE '%<search-phrase-from-your-chat>%' \
   ORDER BY s.time_updated DESC LIMIT 1;")

git -c user.name="Kilo" -c user.email="kilo@kilo.ai" commit \
  -m "Fix CI failures: <description of the fixes>" \
  -m "Chat: $CHAT_ID"
```

### Step 3.3: Merge

Use the **worktree-merge-harvest** skill to merge the fix worktree into main.
The skill handles:

1. Re-reading status and diff before staging
2. Running independent code review
3. Passing tsc/build/test/test:e2e
4. Merging with `Branch:` trailer

## E2E Failure Documentation Protocol

When an e2e failure is classified as environment-bound, the coordinator must:

1. **Check `e2e/OPEN_PROBLEMS.md`** — is it already documented?
2. **If not documented** — add an entry with:
   - Exact test path and name
   - Error message
   - Why it is environment-bound (not a logic defect)
   - Any relevant context about the baseline

This ensures environment-bound failures are **recorded as known issues** rather than
being "fixed" by weakening assertions.

## Model Selection Guide

| Model                   | Provider | Variant  | Best For                        | Notes                                      |
| ----------------------- | -------- | -------- | ------------------------------- | ------------------------------------------ |
| Poolside Laguna S 2.1   | kilo     | thinking | Primary subagent work           | Preferred; rate-limited (max 2 concurrent) |
| Step 3.7 Flash          | kilo     | high     | Simple, single-file lint fixes  | Fast, accurate                             |
| Nemotron 3 Ultra (free) | kilo     | high     | Analysis, review, complex fixes | Thorough, slower; low confidence           |
| Dots3-Note Preview      | kilo     | thinking | Lightweight classification      | Summaries only                             |

**Avoid:** `LiquidAI LFM2.5-2.6B` — known rate-limited.
Free models must not perform Git operations (commit, merge, branch creation) per the free-model Git restriction in AGENTS.md.

## Example Workflow

```bash
# 1. Find the failing run
GH_TOKEN=$GH_TOKEN gh run list --repo <owner>/<repo> --limit 5

# 2. Get failing jobs
GH_TOKEN=$GH_TOKEN gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs

# 3. Get logs for the failing job
GH_TOKEN=$GH_TOKEN gh run view <run-id> --log --job <job-id> | grep -E "error|warning" -A 3

# 4. Create worktree and fix
MAIN="$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)"
git worktree add -b fix/ci-failures-$(date +%Y%m%d) \
  "$MAIN/.kilo/worktrees/fix-ci-failures-$(date +%Y%m%d)"

# 5. Fix files, verify locally
cd <worktree>
npm run lint:check && npm run tsc && npm run test

# 6. Commit with Chat trailer
# 7. Merge via worktree-merge-harvest skill
```

## Never

- Attempt to fix visual regression or canvas rendering e2e failures
- Weaken assertions, add skips, or suppress failures to make CI green
- Use `git add -A` — stage specific files only
- Merge without passing lint + typecheck + tests locally first
- Fix e2e environment-bound failures by changing code — document them instead
- Forget the Chat trailer on commits
