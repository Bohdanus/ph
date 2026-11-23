---
name: pipeline-health
  Triage and minimally fix failing GitHub Actions pipeline gates in the ph photo
  editor using verified-free research where the active host supports it. Preserve
  every gate and record evidence-backed handoffs for platform-specific or unproven failures.
---

# Pipeline Health Skill

Use this skill to assess and repair failing GitHub Actions runs for this repository,
including the `Bohdanus/ph` mirror. Keep the task narrow: identify the current run,
classify each failure, fix only a locally reproducible and well-understood cause, then
prove the fix or leave a durable handoff.

## Model And Tool Boundaries

- Read `MODELS.md` before choosing a model or provider. Use live-verified exact-free
  routes only; never fall back to paid inference without explicit operator authorization.
- Use read-only free delegates for independent history archaeology, bounded research,
  and review when the active host can verify the resolved model and provider. Give each
  delegate a bounded question, evidence requirements, a concise output limit, and no
  write or Git tools. If the host lacks provider routing, use the repository's verified
  free completion runner where it applies; do not silently substitute a paid delegate.
- The root coordinator owns all edits, Git operations, final claim checks, and landing.
  Free Kilo sessions must not launch GPT children or perform Git operations.
- All edits and npm commands belong in the already-created task worktree under
  `.kilo/worktrees/`. Never edit or run npm in `main` or the caller's root checkout.
- Never open a browser. Use GitHub CLI evidence and the repository's headless E2E
  commands only.
- Do not modify `.git`, remove lock files, stash, reset, checkout over files, or
  discard unknown changes. Preserve unrelated work and report unexpected state.

## Triage

1. Read `AGENTS.md`, `MODELS.md`, `docs/TESTING.md`, and the relevant workflow or
   procedure before acting. Resolve the exact worktree, repository, and target branch
   from existing evidence; do not infer them from a stale local branch.
2. Query recent runs with `gh run list --repo <owner>/<repo> --workflow CI` and inspect the
   current `main` SHA with `gh run view <run-id> --repo <owner>/<repo> --json headSha,status,conclusion,jobs,url`.
   Treat the run for the latest target `main` SHA as current; older runs are comparison evidence,
   not current health.
3. Inspect every required job and failed step. Read bounded job logs with
   `gh run view <run-id> --repo <owner>/<repo> --job <job-id> --log`. Separate a root
   failure from downstream artifact-upload or aggregate-gate failures.
4. Record the run URL, exact SHA, job and step names, test titles, platforms, and the
   smallest relevant error excerpt before proposing any code change.
5. Classify each failure as source defect, test/fixture defect, workflow/configuration,
   runner/environment, baseline/visual variance, or cascade. Compare platforms and
   shards: the same failure on multiple operating systems is evidence against an
   OS-specific explanation, not proof of a specific source cause.

## Minimal Fix Rules

- Reproduce the smallest failing command in the task worktree before editing. Use the
  specific script or test first; run broad suites only when the fix's scope requires it.
- Fix the cause, not the signal. Do not weaken assertions, add skips, alter baselines,
  reclassify failures as expected, restore `continue-on-error`, remove required checks,
  or raise timeouts without measured evidence that the existing budget is insufficient.
- For inventory and guard tests, update the underlying fixture/spec to satisfy its
  actual contract when appropriate; do not simply add the new failure to an allowlist.
- Browser rendering, canvas pixel, and screenshot failures need attempt-level evidence.
  Do not treat them as environmental merely because they occur in E2E. Conversely, do
  not rewrite cross-platform raster expectations based on a single run.
- Do not claim Windows or macOS validation from a local nonmatching host. Leave
  platform-only results explicitly unproven until the corresponding CI job runs.
- Preserve unrelated staged and untracked files. Stage, commit, push, and merge are
  exclusively the git-capable owner's responsibility.

## Validation

Choose gates according to the affected scope, and report the exact commands and results:

- `npm run test:e2e:unit` for E2E helper unit tests.
- `npm run test -- <focused-test-path>` for focused Vitest tests.
- `npm run test -- --coverage`, `npm run tsc`, and `npm run build` for application CI.
- `npm run test:e2e` for a targeted local headless E2E reproduction.
- The cross-platform mirror workflow for full CI/E2E evidence; check `docs/E2E-MIRROR.md`.

Never state that CI is green because a local test passes. After changes, inspect the
diff and status in the task worktree. A new CI run must match the proposed commit SHA.

## Handoff

If the failure is not safely resolved in this pass, create or update one problem-focused
handoff under `.kilo/plans/` or the existing defect's canonical problem record. Include:

- Current run URL and exact source SHA.
- Failed required jobs/steps and relevant test titles/platforms.
- Evidence distinguishing what is known from what remains a hypothesis.
- Reproduction command or artifact needed next.
- A specific next action and why a blind fix is unsafe.

Do not write a changelog or claim completion while required gates remain red. The owner
must review the diff and continue the handoff through the repository's documented
worktree and landing procedures.
