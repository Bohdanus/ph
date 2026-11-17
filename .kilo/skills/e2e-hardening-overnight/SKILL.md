---
name: e2e-hardening-overnight
description: >-
  Investigates flaky or failing Playwright CI runs with attempt-level evidence,
  distinguishes product, test, runner, and baseline causes, and hardens only
  reproduced defects using the repository's current E2E and landing procedures.
---

# E2E Hardening Overnight

Use this procedure for a failing or flaky E2E run, including cross-platform
differences. "Overnight" describes the kind of investigation, not permission to
schedule an unattended or recurring run. This skill does not prescribe a fix from a
failure signature alone: collect evidence, identify a root cause, and change only the
smallest relevant test or product behavior.

## Guardrails

- Work in a task worktree. Keep the candidate branch and final diff limited to the
  verified defect and its regression coverage.
- Read the current `AGENTS.md`, `MODELS.md`, `docs/TESTING.md`, `docs/E2E-MIRROR.md`,
  `docs/E2E-HARDENING-PLAN.md`, `HANDOFF.md`, `e2e/README.md`,
  `e2e/OPEN_PROBLEMS.md`, and `TEST-FLAKES.md` before selecting work. These files and
  the workflows are mutable; re-check their instructions and status on every invocation.
- Do not add `test.skip`, `test.fail`, grep filters, weaker assertions, arbitrary
  tolerances, extra retries, or longer timeouts to make a run green. Do not update a
  baseline just to match a failure. Baseline or skip-set changes require the current
  documented procedure and explicit review.
- Never run a headed browser, open a report or trace viewer, or use a browser tool.
  Inspect downloaded test-result files and images without opening a browser.
- Do not create cron or recurring schedules. Stop after the bounded task is complete;
  record unresolved work in its proper problem document rather than looping.
- Changes to Photoshop behavior or UX require Adobe or other primary-source research.
  A test-harness diagnosis alone is not evidence that product behavior should change.

## 1. Establish The Run

Record the repository (source or mirror), workflow run ID and attempt, head SHA,
workflow, failing job, platform, shard, and conclusion. The source and compute mirror
are separate repositories: a green mirror run does not prove source-repository CI is
green. See `docs/E2E-MIRROR.md` before dispatching mirror work.

Use the GitHub CLI's authenticated session; never put a PAT in a command, prompt,
tracked file, or log.

```bash
gh run list --repo <owner>/<repo> --limit 10 \
  --json databaseId,headSha,headBranch,workflowName,status,conclusion,createdAt,url
gh api "repos/<owner>/<repo>/actions/runs/<run-id>/jobs?per_page=100" \
  --jq '.jobs[] | {id,name,conclusion,started_at,completed_at}'
gh run view <run-id> --repo <owner>/<repo> --job <job-id> --log
gh run download <run-id> --repo <owner>/<repo> --dir <artifact-directory>
```

Inspect the current workflow for matrix dimensions, retries, reporters, artifact names,
retention, and timeout relationships before interpreting output. Artifact names are
matrix- and attempt-specific; do not guess a static name. If a run has multiple
attempts, select artifacts whose name matches the attempt under review. Preserve that
attempt's report and `test-results`. Current CI artifacts have a finite retention
period, so collect them promptly. A missing report after a cancellation or hard job
timeout is missing evidence, not a pass.

The current E2E matrix has three platform labels and two shards per platform. The CI
config retries tests and enables `failOnFlakyTests`, so a test that fails and later
passes can still fail the job. Read each attempt from the downloaded report; do not
interpret the final retry alone. Local runs have different worker and retry settings,
so a local pass does not rule out a CI-only race or scheduling issue.

## 2. Classify With Evidence

Before assigning a cause, compare the failure with the same test on the same SHA,
platform, browser channel/version, shard, and retry attempt when available. Read the
current `playwright.config.ts`, CI workflow, artifact report, and relevant source/test
code. Check `e2e/OPEN_PROBLEMS.md`, `TEST-FLAKES.md`, and
`HANDOFF.md` and `docs/E2E-HARDENING-PLAN.md`, then verify that each cited condition
still exists in the current tree.

Record one outcome per failing test:

| Outcome                 | Minimum evidence                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product/test regression | A deterministic mismatch with the current test contract or product behavior, not explained by invalid setup or baseline selection.                      |
| Flaky/race              | An unexpected attempt followed by a pass, or a bounded reproduction showing nondeterministic behavior; include the timing/event evidence.               |
| Runner/environment      | A platform or runner difference identified from the actual job and its environment, with evidence that the test/product expectation is otherwise valid. |
| Infrastructure/setup    | Evidence of a server, dependency, artifact, browser-install, port, or workflow failure rather than an application assertion.                            |
| Baseline data           | The expected platform baseline is absent, unreadable, or inconsistent with the documented capture process. Do not silently regenerate it.               |
| Unproven                | Available artifacts do not distinguish the above. Preserve the evidence and report the uncertainty; do not relabel it environment-bound to dismiss it.  |

A failure appearing on only one OS is not, by itself, proof of an environment issue.
For platform investigations, capture the actual `RUNNER_OS` and `RUNNER_ARCH` when
available, Node and Chrome versions, the platform label, and the baseline selected.
GitHub's hosted-runner images change; the [current runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
is useful context, not a substitute for the failing job's evidence. If architecture
was not recorded, mark it unknown rather than inferring it from the OS name.

The current workflow uses `ubuntu-latest`, `windows-latest`, and `macos-latest`. The
current GitHub reference lists standard Linux and Windows images as x64 and the public
mirror's `macos-latest` image as ARM64. Source and mirror are separate repositories,
and runner images can change; use that mapping only as a hypothesis until the actual
run's architecture is known.

The current visual-regression suite has committed platform-specific baselines under
`e2e/export/visual-regression.spec.ts-snapshots/export-baselines/{darwin,linux,win32}`.
Confirm the target baseline exists and is the one actually used before classifying a
pixel diff. Linux baseline capture and promotion are handled by the documented mirror
workflow; do not use local snapshot updates as a shortcut. Review every proposed
baseline change against the application contract. A platform-specific diff can be a
product regression, a test defect, or renderer variation; the image alone does not
decide which.

## 3. Diagnose Before Changing

Use these repository examples as investigation leads, not universal fixes. Check the
linked current tests and problem entry first; a documented issue may already be fixed
or superseded.

| Symptom                                                      | Evidence-led check                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus or keyboard assertion fails intermittently             | Inspect event ordering and the relevant focus state. The sidebar keyboard case records a focus race across `requestAnimationFrame`; wait for the observed event/state, not an arbitrary sleep.                                                                                                                                                                                                                       |
| Canvas capture or pointer geometry drifts                    | Check the coordinate origin at each boundary. Playwright `Locator.boundingBox()` is main-frame viewport-relative CSS geometry ([API reference](https://playwright.dev/docs/api/class-locator#locator-bounding-box)). For raw CDP capture, follow the current helper's viewport/page conversion at the CDP call site only; read scroll offset for each capture and verify the measured page did not change across it. |
| Canvas gesture changes after layout or document-size changes | Re-measure the current box and follow `documentToCanvasOffset` or the relevant existing helper. Do not copy viewport-relative literals or assume a seeded document size applies to an opened image.                                                                                                                                                                                                                  |
| Pixel assertion differs by a few pixels                      | Keep the assertion tied to the test's physical geometry and existing ceiling guard. Do not widen a threshold to absorb an unexplained diff or re-record a baseline to silence it.                                                                                                                                                                                                                                    |
| Export/download times out                                    | Separate encoder completion, UI readiness, and the browser download event. The AVIF entry in `e2e/OPEN_PROBLEMS.md` explicitly forbids raising `DOWNLOAD_TIMEOUT_MS` as a workaround; verify the current proposed remedy before changing the encoder path.                                                                                                                                                           |
| `<option>` disabled-state assertion behaves unexpectedly     | Check native option semantics and the current fixture/expectation. The recorded Playwright retargeting case is not a reason to weaken the assertion or copy an old matcher example.                                                                                                                                                                                                                                  |
| `page.goto()` or a hook times out                            | Inspect the webServer, global setup, port ownership, and Vite warmup path. The configured strict port and no-reuse policy make an occupied port a failure to diagnose, not a reason to attach to an unrelated server.                                                                                                                                                                                                |

Use Playwright's retrying locator assertions or await the specific event/state that
causes the behavior. Avoid fixed sleeps and one-shot reads of state that is expected
to change asynchronously. Do not raise a test timeout until a measured operation
budget and the related whole-run/job artifact deadlines have been reviewed together.

## 4. Delegate Bounded Research

Use free subagents for independent root-cause research or review, not to mutate the
worktree. Before each launch, read `MODELS.md` and follow the current token-capacity
check required by `AGENTS.md`. If that check is unavailable, stale, or incomplete,
treat capacity as unknown and use only free models. Refresh
`node scripts/free-model-pool.mjs --list` before launching and pass the exact free
`model` and `provider` to Kilo `task` calls. For large OpenRouter-backed fan-outs,
check `node scripts/free-model-pool.mjs --openrouter-quota` before and after. That
counter reports daily account usage, not requests-per-minute limits or upstream
capacity; a `configured` catalog entry does not guarantee a request will succeed.

On HTTP 402/429, do not immediately retry the exhausted provider. Rotate to another
currently listed zero-priced model/provider or stop if free capacity is exhausted.
Never silently fall back to paid compute. Do not send credentials, private chat
transcripts, or other sensitive content to a provider; use only the minimum
user-authorized repository context and follow current provider data terms.

Keep each wave to at most three independent reviewers and never exceed the global cap
of 15 concurrently running subagents, Agent Manager sessions, and background processes.
Assign distinct specs or questions; never have two agents edit or review different
versions of the same file. Free agents are read-only: they must not edit files, run Git
operations, push, commit, or merge. The coordinator owns all changes and Git
operations.

Give each reviewer the absolute worktree path, exact failing test and SHA, bounded
source scope, and this response shape:

```json
{
  "test": "e2e/example.spec.ts :: exact test title",
  "classification": "regression | flaky | runner | infrastructure | baseline | unproven",
  "evidence": ["path or report artifact and observed fact"],
  "rootCause": null,
  "proposal": "smallest safe next step",
  "confidence": "high | medium | low"
}
```

Replace `rootCause: null` with an evidence-backed explanation when one is established.

Treat agent conclusions as hypotheses. Reproduce factual disagreements in the current
tree and reject advice that is unsupported, broadens scope, weakens a gate, or changes
product behavior without the required primary-source research. For multi-wave work,
persist a concise recovery plan under `.kilo/plans/` before dispatch and update it
after each wave. Keep no more than three investigate-fix-review cycles; then resolve
remaining uncertainty in the appropriate problem document.

## 5. Fix And Verify

Make one minimal, cause-specific change at a time. Prefer a regression assertion that
would fail under the reproduced defect and pass with the fix. E2E specs use
`./fixtures/extended-test`; check `e2e/README.md` before changing fixtures or adding a
spec. Add an E2E test only for a reproduced browser-level defect lacking regression
coverage, or a concrete uncovered behavior required by the current hardening plan.

Run only the focused local checks first:

```bash
npm run test:e2e -- e2e/<spec>.spec.ts
npm run test:e2e:unit -- e2e/helpers/__tests__/<helper>.unit.test.ts
npm run tsc
npm run lint:check
```

Use the repository wrapper for local E2E; do not set `CI=true` to pretend a local run
matches the CI worker, retry, or timeout configuration. Broad or cross-platform E2E
runs use the mirror CLI from a clean, committed, non-`main` branch:

```bash
npm run test:e2e:mirror -- --spec e2e/<spec>.spec.ts --platform linux
npm run test:e2e:mirror -- --full
```

The mirror CLI pushes only the current branch to `Bohdanus/ph` and runs its exact SHA;
it does not update the source repository. Inspect `docs/E2E-MIRROR.md` for current
options and artifact handling. A source change still needs source-repository CI.
Never use `playwright show-report`, `playwright show-trace`, headed mode, or a browser
tool. If production code changes, also run the relevant unit tests and
`npm run build`; follow the stronger project gates for cross-module changes.

Before landing, obtain the required fresh read-only review for the final candidate
tree. Review whether the defect is actually fixed, whether assertions remain
meaningful, whether any skips, retries, thresholds, timeouts, or baselines changed,
and whether changes escaped the assigned paths. If review or validation changes the
tree, rerun the affected checks and review that final composition.

## 6. Record And Land

When resolved, remove only the matching verified problem entry from its proper home;
the repository index in `docs/README.md` describes which document owns each defect.
Do not turn `HANDOFF.md`, `TEST-FLAKES.md`, or `e2e/OPEN_PROBLEMS.md` into a change
log. For unresolved work, record the exact run/SHA, artifacts, verified facts,
remaining uncertainty, and next diagnostic step in the correct problem document.

Land through the current task lifecycle in `docs/ORCHESTRATION.md` after syncing the
latest `main` into the task branch, reviewing and validating that exact tree, and
preparing the pinned two-parent landing with the required `Branch:` and `Chat:`
trailers. Do not merge a stale branch directly in the shared `main` worktree. Use
`.skills/worktree-merge-harvest.md` only when the task is specifically harvesting an
existing free worktree, not as a substitute for the normal task landing procedure.

## Source Of Truth

- Repository state and current task queue: `docs/E2E-HARDENING-PLAN.md`,
  `HANDOFF.md`, `e2e/OPEN_PROBLEMS.md`, and `TEST-FLAKES.md`.
- Runner matrix, artifacts, retry/failure behavior, and time budgets:
  `.github/workflows/ci.yml` and `playwright.config.ts`.
- Fixtures, headless restrictions, local commands, and assertions: `e2e/README.md`,
  `docs/TESTING.md`, and `AGENTS.md`.
- Mirror behavior and baseline promotion: `docs/E2E-MIRROR.md` and
  `.github/workflows/capture-linux-baselines.yml`.
- Provider limits, model names, concurrency, and agent permissions: `MODELS.md` and
  `AGENTS.md`; never preserve a provider/model list in this skill.
