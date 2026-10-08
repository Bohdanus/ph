# E2E hardening — the verified queue

**Its one job is the execution order and the ownership of the e2e hardening campaign, plus the
set of claims that were refuted and must never be scheduled again.** It is not a defect list: an
open defect belongs to [`../e2e/OPEN_PROBLEMS.md`](../e2e/OPEN_PROBLEMS.md),
[`../TEST-FLAKES.md`](../TEST-FLAKES.md) or [`../HANDOFF.md`](../HANDOFF.md), and a rule belongs to
[`TESTING.md`](TESTING.md), [`../AGENTS.md`](../AGENTS.md) or [`ORCHESTRATION.md`](ORCHESTRATION.md).
This document names those and adds the one thing none of them can hold: which file each piece of
work owns, and what must not be started until what.

Every figure below was re-derived at the commit named in the header, by re-running the command
printed beside it. Two rounds of review found that the sentences **newly composed to interpret**
a count were where the errors were, while the counts themselves were usually reliable. So a number
without a command is absent from this document rather than approximately present.

**How to run a row:** [`ORCHESTRATION.md`](ORCHESTRATION.md) for worktrees and delegation,
[`../AGENTS.md`](../AGENTS.md) for the citation rule and the subagent caps,
[`TESTING.md`](TESTING.md) for the gates and for the rule that a pin is a tripwire,
[`CODE-REVIEW.md`](CODE-REVIEW.md) for review. Nothing here restates them.

## Evidence standard

A claim here is not a claim until a command produces it, and **the command is printed next to it**.
Four rules follow from two rounds of review finding the same failure in different clothes.

- **A fence that looks like command output must BE command output.** A block showing three lines
  with an elision, while the command emits nineteen, is a claim about a command that the reader
  cannot check. State the count.
- **`grep -rEo` does not transliterate into `rg`.** In ripgrep `-r` means `--replace`, so the
  substitution silently changes the measurement rather than reproducing it. Where an entry
  publishes a `grep` command, run the `grep`.
- **A drift correction is measured at the anchor, and a re-measurement at HEAD.** Quoting one
  figure and calling it "not the old one" is only meaningful if both numbers exist.
- **An inherited figure is a hypothesis.** Every number below was produced by a command in this
  campaign. Where a figure could not be reproduced by any command, it is gone rather than
  approximated — including figures this document's own predecessor carried.

## Withdrawn — do not schedule these

Each of these was investigated and refuted. They are recorded because a refuted claim that
disappears reads like work nobody did, and the next reader re-derives it.

| withdrawn claim                                                                                                 | why it is withdrawn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `finally` in the pixel-wait loop replaces the in-flight timeout error with whatever the scroll-restore throws | **Structurally impossible.** The deadline `throw` is a brace-depth **sibling below** the `finally`, not inside it, so the `finally` settles before the deadline is ever read. One argument refutes it independently of any test. Corroborated by a unit test that asserts both that the error surfaces and that the scroll was restored, and by the six pins, whose `restore` branch cannot throw. The six pins assert **no retry sleep**, which is orthogonal to `restore()` — so deleting the `try` would break three tests this never listed, and the proposed change removes none of them |
| A cached canvas box addresses a different pixel after a tool switch, so the box moves                           | **Premise refuted, not merely unproven.** The options bar mounts in the toolbar grid row as the tool's component inside a fixed-height row carrying `[grid-area:toolbar]`, and that row's height cannot vary with the tool. `SidebarRight.tsx` contains no options component at all. A panel taller than that row paints over the workspace rather than scrolling, and painting is not layout. The queue entry asserting this was **deleted**, because its premise, its conclusion and its published measurement were all inconsistent with the code                                          |
| The queue cites `sidebar-flyout.spec.ts` by line number                                                         | The queue names that file once, with no line number. A non-finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| "The pixelmatch diff buffer should be returned and attached"                                                    | The buffer was **deleted on purpose**, with the reasoning recorded beside it, and the return value now carries a channel-delta field so a channel shift is visible to a caller                                                                                                                                                                                                                                                                                                                                                                                                                |
| Four of five layout-pinned tolerances are still pinned                                                          | Four remain **by design** as tripwires, and the other conversions landed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Nine orphaned committed baselines                                                                               | **10.** Seventeen tracked, seven read through the single call site, seventeen minus seven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A `comparePixels` field selects which formats are compared                                                      | No such field exists. What survives is docblock history. The real type is `ExportVerification`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| An artifact name that traverses out of the output directory is a documentation concern                          | It **wrote and attached a file outside the directory** any cleanup reaches. Fixed: the name must be a single path component, rejected rather than rewritten                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A deleted theme pin is silent — nothing fails                                                                   | **Refuted by measurement.** Removing the payload fails four of five tests in one spec, loudly, with the pixel-wait timeout. What was missing was a fast named tripwire and coverage of the silent half, not any tripwire at all                                                                                                                                                                                                                                                                                                                                                               |
| `origin/main..main` is a meaningful staleness figure                                                            | It is a number about the remote and moves under the reader's feet. It should never have been quoted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Settled — do not redo

Verified present at the anchor. Each is a mechanism that held; re-implementing any of them is
wasted work.

- **The console-error allowlist is scoped by URL.** A rule carrying a `urlPattern` is judged on the
  URL pathname; without one it is judged on text alone. The favicon exemption and the rejection of
  an application-script 404 are both covered by named cases in
  `e2e/helpers/__tests__/console-police.unit.test.ts`. **One line survives:** `pageerror` entries
  still carry no location, unlike the console path.
- **`forbidOnly` is unconditional.** It was `!!process.env.CI`, which made a committed `test.only`
  a silent scope reduction on every local run — the suite collects one test, prints it green, and
  the operator reads green as coverage. A guard reads the config with `CI` deleted **and** set,
  because one reading cannot discriminate: the old expression is already true under CI.
- **A rejecting CDP `detach()` no longer replaces the capture error.** The detach failure is held,
  the capture error is thrown first, and the detach error rides as `cause`.
- **The size-mismatch path, the poll counter and the coverage universe** — see the rows below; the
  coverage universe remains in flight.

## Open, and the order it must happen in

Three constraints govern everything below. They are not advisory; each one has a specific failure.

1. **The queue is fixed first.** Every other task sizes its work from
   [`../e2e/OPEN_PROBLEMS.md`](../e2e/OPEN_PROBLEMS.md). A queue that states a falsehood sends its
   reader to the wrong file, and the reader is a subagent with no way to tell.
2. **Gesture and sample are reconciled before any coordinate work.** One spec declares private line
   constants that disagree with the shared ones by 100 units on the end point. Until that is
   reconciled, a later row copying a convention from it produces a test that passes while pointing
   100 units from where it claims — and every later row copies its convention from an already
   converted file.
3. **The coordinate tail goes last**, because it copies conventions the earlier rows establish. And
   a coverage **threshold** goes last of all, because totals move with every concurrent helper edit
   and a sibling branch then turns the gate red for no reason.

**One interaction to know about, because it merges green and silently nullifies a fix.** A Playwright
`globalTimeout` at or above the CI job's own `timeout-minutes` is killed by the runner before any
upload step runs, and a job killed for exceeding its budget does not run its remaining steps even
when they are gated to always run. The result is a timeout that destroys exactly the evidence it was
added to preserve. The two changes must land together, with the timeout strictly below the job
budget and enough headroom for the upload.

## The rows

One owner per file. Grouping by defect class guarantees two agents claim the same spec, and one
spec appears in three of these classes. Order is priority, not dependency. `easy` and `hard` mark
whether an agent can finish a row unaided.

| #   | file                                                                                                                                                                            | the work                                                                                                                                                                                                                                                                                     | route | state      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------- |
| 1   | `../e2e/OPEN_PROBLEMS.md`                                                                                                                                                       | Four corrections and two deletions: a summary contradicting its own entry, a field that does not exist, and two entries whose premises the code refutes                                                                                                                                      | easy  | **landed** |
| 2   | `e2e/helpers/cdp-helpers.ts` + its unit test                                                                                                                                    | Cover the required-output-directory guard, which no test reached; reject an artifact name that is not a single path component. Two pins encoded the unsafe behaviour and are removed with it                                                                                                 | easy  | **landed** |
| 3   | a new unit test beside the theme fixture                                                                                                                                        | Tripwire the pinned-theme payload the dark-pixel oracle depends on, asserting the value rather than the predicate's behaviour                                                                                                                                                                | easy  | **landed** |
| 4   | `e2e/text-tool.spec.ts`, `e2e/viewport-drawing.spec.ts`, `e2e/layers-panel.spec.ts`, `e2e/color.spec.ts`                                                                        | Correct four comments that misstate why the canvas box survives a tool switch. The measurements are real and stay; the stated reasons are false                                                                                                                                              | easy  | **landed** |
| 5   | `../e2e/OPEN_PROBLEMS.md`, `../e2e/README.md`, `../.skills/photoshop-tool-creation.md`                                                                                          | A queue entry stale in five separate ways, including two published commands whose stated results no command produces; and a deleted field still named in three places                                                                                                                        | easy  | **landed** |
| 6   | `e2e/helpers/image-comparison.ts`, `e2e/export/visual-regression.spec.ts`, `e2e/helpers/canvas-helpers.ts` + their unit tests                                                   | Report both capture sizes on a size mismatch, instead of reporting every pixel different and no sizes; count the pixel-wait polls and put the count in the timeout                                                                                                                           | easy  | **landed** |
| 7   | `e2e/erase-fill-eyedropper.spec.ts`                                                                                                                                             | Reconcile the private line constants against the shared ones, then its sampling sites                                                                                                                                                                                                        | hard  | **landed** |
| 8   | `playwright.config.ts`, `../.github/workflows/ci.yml`                                                                                                                           | Make a green run mean the tests passed, keep the evidence when a run is superseded or times out, and stop a missing report reading as a green upload                                                                                                                                         | hard  | **landed** |
| 9   | a new unit test beside the helpers, `vitest.e2e.config.ts`                                                                                                                      | Gate every e2e module on reachability from a unit test. A module with no test is **absent** from the coverage report rather than reported as zero, so nothing fails today. The universe is helpers **and** fixtures — a scan of helpers alone silently passes one of the two offenders       | hard  | in flight  |
| 10  | `e2e/file-roundtrip.spec.ts`, `e2e/export/visual-regression.spec.ts`, `e2e/sponge-tool.spec.ts`, `e2e/error-boundary.spec.ts`                                                   | Five negative counts with no positive anywhere in either tree: they assert an absence nothing could produce, so they pass forever. Anchor each, or report honestly that it cannot be anchored                                                                                                | hard  | in flight  |
| 11  | `e2e/check-dpr.spec.ts`                                                                                                                                                         | Replace the literal CSS-position tolerance with the derivation row 14 relocates. **Blocked on row 14**                                                                                                                                                                                       | easy  | queued     |
| 12  | `e2e/viewport-drawing.spec.ts`                                                                                                                                                  | Relocate the tolerance derivation so it is reachable, and keep the operator's skip and its reason verbatim. **The relocated control must not depend on the skipped assertion's outcome being stable** — build it on geometry, not on a pixel comparison whose stability is the open question | hard  | queued     |
| 13  | `e2e/responsive-shell.spec.ts`, `e2e/panel-workspace.spec.ts`                                                                                                                   | The surviving absolute layout literals, and a less-than-or-equal that cannot distinguish one from two                                                                                                                                                                                        | easy  | queued     |
| 14  | `e2e/history-panel.spec.ts`                                                                                                                                                     | A negative count satisfied by a **hidden** row. Count then visibility, never count alone — `e2e/accessibility.spec.ts` already models the right shape                                                                                                                                        | easy  | queued     |
| 15  | `e2e/selection-marching-ants.spec.ts`                                                                                                                                           | The dash-phase check reduces five bands to a set size and keeps none of them; name the constant it keeps                                                                                                                                                                                     | easy  | queued     |
| 16  | `e2e/single-row-column-marquee.spec.ts`                                                                                                                                         | The hint pair, which already has its positive on the adjacent line                                                                                                                                                                                                                           | easy  | queued     |
| 17  | `e2e/transform.spec.ts`, `e2e/selection-gestures.spec.ts`, `e2e/filter-tools.spec.ts`                                                                                           | Box-relative literals converted to the fraction or document-space form each file already uses                                                                                                                                                                                                | easy  | queued     |
| 18  | `e2e/keyboard-shortcuts.spec.ts`                                                                                                                                                | A structural selector where the component publishes a test id. **Not** the dashed-border site, which is anchored                                                                                                                                                                             | easy  | queued     |
| 19  | `e2e/paint-tool-pixels.spec.ts`, `e2e/pen-types.spec.ts`                                                                                                                        | Capture-pixel reads standing in for CSS constants                                                                                                                                                                                                                                            | mixed | queued     |
| 20  | `e2e/mobile-shell.spec.ts`, `e2e/document-dialogs.spec.ts`, `e2e/selection-tools.spec.ts`, `e2e/text-tool.spec.ts`, and the coordinate tail in the specs those rows do not name | Document-space conversion, the document-size read, and a negative window that can expire before the input is processed — a **false pass**, which is worse than a failure                                                                                                                     | hard  | queued     |

**Globs are banned in that table.** An earlier draft used `toolbar-*` and `sidebar-*`, which silently
re-owned three other rows.

## Two facts about the coordinate surface, because they change how rows 11-20 are judged

- **The helper applies plain box arithmetic with no contain scale**, so every coordinate handed to it
  is a canvas-box offset rather than a document point. Its doc comment says so. Anything asserting
  in document space while passing box offsets is asserting nothing.
- **One spec's box-relative literals should be converted to a form copied from a spec that already
  has one.** A verification pass found the file this document's predecessor named as the model has
  no such form of its own; the two files that do are different from the ones it listed. Check before
  copying a convention.

## Not scheduled here, and why

- **Anything in [`OVERRIDES.md`](OVERRIDES.md).** It is operator-written, an agent never edits it,
  and an agent never asks for an entry. Record the finding and stop.
- **Un-skipping the viewport-drawing spec.** An operator decision; its remaining verification is a
  trace, not a code change. See [`../TEST-FLAKES.md`](../TEST-FLAKES.md) §12.
- **Re-recording any committed baseline or snapshot.** Forbidden, and it is why any change to what
  is served must be additive. A pixel expectation that moves is a **finding to report**, not a
  re-record.
- **Pinning Chrome in CI.** A pin that does not match the recording version turns green red for a
  reason nothing can diagnose.
- **A second browser project, or sharding.** A second project trades a coverage gain for three new
  failure modes; sharding puts concurrent runners on one shared results directory that Playwright
  deletes at the start of every run.
- **A zoom task.** The software is absent.
- **The coverage threshold half of row 9.** Deliberately sequenced last; see constraint 3.
