---
name: ci-failure-mitigation
description: >-
  Analyzes non-browser CI failures (lint, typecheck, test, build, audit) from the
  `ci` and `e2e-unit` jobs in GitHub Actions with read-only subagents who inspect
  bounded CI error logs, then has the coordinator apply, review, commit, and merge fixes.
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

- Visual baselines: capture Linux on the mirror's `ubuntu-latest` runner with `npm run test:e2e:mirror -- --linux-baselines --chat-id <native-id>`. Use the live EC2 host only for targeted ARM64 checks; see [`FREE-REMOTE-COMPUTE.md`](../docs/FREE-REMOTE-COMPUTE.md).
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
5. Coordinator: Apply fixes from accepted proposals in the task worktree
6. Read-only subagent: Review changes; coordinator runs lint, tsc, test locally
7. Commit with Chat trailer
8. Merge via worktree-merge-harvest skill
```

## Safety Constraints

### Subagents MUST NOT:

- Edit files or run Git commands — return findings and proposed patches; the coordinator applies edits and owns Git
- For production/source lint failures, return a minimal proposed patch; the coordinator decides whether to apply it
- Run `git push` — coordinator commits and merges only
- Merge to main directly — use worktree-merge-harvest skill
- Weaken assertions to make tests pass
- For a needed `data-testid`, return a minimal proposal; the coordinator decides whether and how to apply it
- Run from the main checkout (must be in a worktree)
- For config failures, return a specific proposed change; the coordinator decides whether and how to apply it

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
git worktree list --porcelain
# Set this to the absolute path from the stanza with: branch refs/heads/main
MAIN_WORKTREE="<absolute-main-worktree-path>"
TASK_NAME="fix-ci-failures-$(date +%Y%m%d)"
TASK_WORKTREE="$MAIN_WORKTREE/.kilo/worktrees/$TASK_NAME"
git -C "$MAIN_WORKTREE" worktree add -b "task/$TASK_NAME" "$TASK_WORKTREE" main
cd "$TASK_WORKTREE"
git rev-parse --show-toplevel
```

### Step 2.2: Dispatch read-only fix analysis

Each subagent analyzes ONE file or ONE category of failure, then returns a focused patch proposal. Subagents do not edit files or run commands; the coordinator applies accepted changes and runs verification.

**Subagent #4 (Lint analysis)** — receives the files with ESLint errors or Prettier
failures and proposes minimal fixes one at a time. Returns JSON per file:

```json
{
  "file": "<affected-file>",
  "action": "proposed",
  "change": "<description, e.g., moved export to constants.ts to resolve react-refresh/only-export-components>",
  "verificationCommand": "coordinator runs npm run lint:check"
}
```

**Subagent #5 (Typecheck analysis)** — receives TSC errors and proposes fixes.
**Subagent #6 (Test analysis)** — receives test failures and proposes fixes.
**Subagent #7 (Build analysis)** — receives build errors and proposes fixes.

Each analysis subagent:

1. Reads the specific file(s) involved
2. Returns a minimal, targeted unified diff or exact edit instructions
3. Does not edit files or run commands
4. Returns JSON with the proposal and relevant evidence

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
git add <fix-files...>    # the specific files the coordinator changed and reviewed
git add .skills/parallel-test-hardening.md

# Resolve the native session ID for the current host using docs/CHAT-ID.md.
# Verify the match; do not guess or select the first database row.
CHAT_ID="<verified-native-session-id>"

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

Read `MODELS.md` before selecting a model or provider. Refresh the free catalog, inspect the newest
token-capacity reading, and pass the exact model/provider pair together. Keep free subagents
read-only; the coordinator owns edits and all Git operations. If a free route is unavailable or
exhausted, do not silently fall back to paid inference; follow `MODELS.md` for the required operator
authorization and budget checks. In Codex, follow `docs/CODEX-ORCHESTRATION.md` instead of assuming
Kilo task routing is available.

## Example Workflow

```bash
# 1. Find the failing run
GH_TOKEN=$GH_TOKEN gh run list --repo <owner>/<repo> --limit 5

# 2. Get failing jobs
GH_TOKEN=$GH_TOKEN gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs

# 3. Get logs for the failing job
GH_TOKEN=$GH_TOKEN gh run view <run-id> --log --job <job-id> | grep -E "error|warning" -A 3

# 4. Create the worktree using the verified MAIN_WORKTREE and TASK_WORKTREE from Step 2.1.

# 5. Fix files, verify locally
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
