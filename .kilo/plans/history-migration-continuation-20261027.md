# Continue durable history from current main

## Latest checkpoint — 2026-10-29 (Shape Tool E2E hardened; broad gate red; landing gates unresolved)

- The raster/tablet blank-source proof remains landed on actual local `main` at
  `730339e5983d42f52fe102d83d8bfd286137a6c5`. The task branch synced the latest committed actual
  `refs/heads/main` pin `1b0b55a80da7da17022deea87f8248abdcbc92d4` in merge
  `331103961e3f58eeae3cd43cccaf2be8d355cc90` (first parent
  `a9b8060a80d7fb54a1a87966596d81ccacc690c6`, second parent
  `1b0b55a80da7da17022deea87f8248abdcbc92d4`), with the native `Chat:` trailer. That actual main
  worktree was clean when synced. The most recent `repo:state` check found an in-progress merge in
  that actual main worktree (`MERGE_HEAD`, target `be4c35579896dd10e90024e449dec03c30750cf1`). Do
  not inspect or resolve that operation here; its owner must finish it. Landing and any further main
  sync remain gated until a fresh state check confirms it is clear. Never use the root `main-sync`
  checkout as the baseline.
- `ph-12` is resolved. `ph-14` remains the active characterization-only task. Its claim and all
  eight owned path locks have been re-established on this branch; check them again before edits or
  landing. Do not take the independently owned frame-parity or import/replacement work.
- `ShapeToolArea` and `useLayer.createLayerFromTool` source inspection shows a shape create is a
  `NEW_LAYER_ACTION` with a tool source. Planner and StoreContext tests separately prove a valid
  shape source converts to a current typed vector entry while the ownership gate leaves presentation
  unpublished and on legacy paint; valid text and pencil sources remain gated too. The desktop E2E
  uses the real Shape Tool from the disabled opening row, observes a new `shape` history row, and
  checks unpublished/legacy presentation, a full independent rectangle pixel oracle for canvas and
  PNG/PSD composite/layer pixels, undo/redo, and `ownership-unproven` redo fallback. It does not
  inspect the UI-created `HistoryItem` payload or directly join that browser action to the typed
  vector unit assertion. Keep those evidence claims separate. This is characterization only; no
  production eligibility or logical-authority code changed.
- The final Shape Tool test uses a 4px stroke on integer document coordinates, reports exact pixel
  mismatch bounds and samples, requires byte-exact document/PNG/PSD composite pixels and a byte-exact
  PSD layer crop, and allows at most one extra transparent allocation pixel at each edge because
  pointer-coordinate roundoff can widen `shapeGeometryBounds`. Luna's fresh read-only review found
  no actionable issue. The focused file passed locally (5/5) and on the Linux mirror. Its first
  focused Windows mirror run was marked flaky because the earlier pasted-raster Undo click timed out
  once and passed on retry; a repeated Windows run passed (5/5). The full mirror's per-platform
  result artifacts also show all five `source-backed-history.spec.ts` cases passing on Linux,
  macOS, and Windows.
- The broad mirror run `40880825184` at exact candidate `ba9dc09a341d7fa3be8e93b86f50afa49c7fe001`
  failed. Dispatch validation, audit, E2E unit, CI checks (lint, type-check, tests, and build), and
  the skip baseline passed; all six browser shards failed on other suites. Failures include crop
  resize/rotation and frame-parity cases in `e2e/crop-history.spec.ts`; the three Small Caps cases
  in `e2e/text-tool.spec.ts`; and vector, background-conversion, and live-Brush durable-presentation
  expectations in `e2e/undo-redo.spec.ts`. Those files are outside this task's eight held paths.
  Preserve their current ownership boundaries; do not change them from this branch. Artifacts are
  under `test-results/remote-e2e/40880825184-1-3c843e2081564aa49931452da0c7212f/`.
  The last board check showed `ph-10` (crop-history audit) and `ph-13` (Small Caps parity) open and
  unclaimed; `e2e/undo-redo.spec.ts` had no open issue reference or reservation. Treat those as
  routing leads only and recheck ownership before any work. This broad failure blocks the `ph-14`
  landing.
- Before the main sync, candidate validation passed: 38 focused unit tests across the append planner and StoreContext
  suites; all five `e2e/source-backed-history.spec.ts` browser cases; `npm run test:e2e:unit` (21
  files, 1,536 passed, 13 established expected failures); full unit suite (400 files, 11,524
  passed, 215 established expected failures); `npm run tsc`; `npm run build`; and
  `npm run lint:check` (64 existing warnings, zero errors). The first full-suite attempt hit the
  existing `e2e-run` test's ephemeral free-port race; its isolated rerun and the complete retry
  both passed. Final independent reviews of the test diff (Sol) and documentation diff (Luna) found
  no actionable issues after the reported findings were corrected; these reviews preceded the
  main sync and do not satisfy the fresh-review gate on the current tree. Earlier free-pool review
  requests that returned provider limits, empty or truncated completions, or a missing OpenCode CLI
  were not review evidence. Candidate commit `4678e34ae9c6c45d87f27d46b16a18d472a3390b` has tree
  `8d21351a85b360f2862b75b135d3481ab1a2c722`; blocked-landing handoff commit
  `1c9c563fae4fed40da551213694a0b21fbba97d4` follows it; the main-sync merge is above.
- An earlier landing preflight stopped before touching `main` because
  `.skills/free-model-chat-sweep.md` and `MODELS.md` were staged there. Their owner landed them in
  `c9234285`, now included in `8ec99d6`; at that preflight, main was clean (`main` was ahead 53 and
  behind 1 versus `origin/main`). The required inventory script reported that it writes ignored
  `WORKTREES.json` into the main checkout; Git confirmed that file is ignored and `git status`
  remained clean. Avoid rerunning inventory unnecessarily. No merge into `main` has started for
  `ph-14`.
- `HistoryItem[]` and `replayHistory()` remain logical authority. The default active root, imported
  raster baselines, source replacement/import, merge, frame-changing commits, broader source
  families, durable-first navigation, and replay-budget/cancellation behavior remain unproven. Do
  not widen production gates. The current Shape Tool characterization is not landed. The current
  code-specific focused checks pass, while the broad mirror is red and the last observed actual-main
  state had an unrelated in-progress merge; both gates must clear before landing. Afterward, repeat the
  clean-main/HEAD and `repo:state` checks, rerun the broad gate on the exact candidate, and prepare
  the pinned landing only when all gates pass. After landing, resolve `ph-14`, reassess live
  ownership, and choose the next implementation from this plan; keep the default root, vector
  publication, import/replacement ownership, frame parity, authority cutover, and replay-budget
  gates closed until their proofs are complete.

## Previous checkpoint — 2026-10-29 (History-panel raster and blank-source proof)

- Slice 1 landed on the actual local `main` as `f723394b47872bc579913af763d1ea32a56f1d1b`.
  Its first parent is the reviewed main pin `84c1c9200f7a8c14f88fca1b4b465d0fa9430785`, its
  second parent is candidate `c9b52cd39e5b3aa59b4b2961f6e7dbf12021fb86`, and the landed tree is
  `2402ee0d958ba23b1aa0cf7fa242cf087058d7c8`. The required `Branch` and native `Chat` trailers
  were verified; `main` is clean and `npm run repo:state` is clear.
- The raster reachability proof was merged to the actual local `main` as `f43d7e52b3dc4a4150e89eece6ee20e09e9ac7d9`.
  Its parents are `f723394b47872bc579913af763d1ea32a56f1d1b` and
  `7235da5075a6aec8f5bb67fab08184506231c0a7`; the landed tree is
  `be7e96aa6d9a3df15c58d832b742a0a8c8fb9246`. Its `Branch` and native `Chat` trailers were
  verified. The continuation branch
  `/Users/bkalynovskyi/ph/.kilo/worktrees/history-disabled-blank-root-e2e-20261029`,
  `task/history-disabled-blank-root-e2e-20261029`, starts at that main pin and holds the `ph-12`
  E2E/docs paths. Refresh the claim and verify held paths before each edit or landing.
- The History-panel reachability E2E now passes from the real startup blank document. It disables
  the first `new layer` row through the visible eye control, checks the current row and exact empty
  transparent pixels, pastes the deterministic raster through the clipboard/UI path, and requires
  `durable` presentation at that append cursor. It compares exact canvas pixels, PSD composite and
  layer pixels/bounds, and PNG pixels. Undo returns to the exact empty canvas and keeps the root
  disabled; redo restores the exact raster pixels while the root remains disabled. Redo uses the
  complete legacy fallback with `ownership-unproven`; this proves one bounded append route, not
  broad navigation eligibility. The first `OPEN_DOCUMENT_ACTION` disable refusal remains covered
  by `useHistory.test.tsx`.
- A second source family is now covered by tablet E2E candidate `fff5660c85eac12766a6930c8011a190c7324186`
  (parent `f43d7e52b3dc4a4150e89eece6ee20e09e9ac7d9`, tree
  `b5a02caa07150d7ba60039bf88ef7e5c4e989e67`). From a 744×1133,
  touch-enabled, 2× display, it disables the default blank row and creates a transparent layer
  through the mobile Layers drawer. The test requires a successful durable paint at cursor 1, checks
  exact empty canvas pixels, PSD composite and blank-layer pixels/bounds, and native 800×600 PNG
  pixels, then verifies exact undo/redo rendering and that the root stays disabled. Redo remains on
  the legacy fallback. This does not change publication eligibility.
- Current validation is `npm run test:e2e -- --verbose e2e/source-backed-history.spec.ts` (4 passed),
  `npm run test:e2e:unit` (21 files, 1,536 passed, 13 expected failures), `npm run tsc`,
  `npm run build`, and `npm run lint:check` (64 existing warnings, no errors). The independent
  Luna 6 read-only review found no actionable findings. Free review routes were attempted first but
  returned timeouts, empty responses, rate limits, or no CLI; those results are not review evidence.
  Actual local `main` advanced to `ce1aedec0ddc619ea92414444377f1b243bc29b9`; this branch now
  contains it through sync merge `9f84f7eaa8942e2c340d340771fde6f0b509ff13` (parents
  `187d782072328c4c17ef3cfb5da6b6066ea5aac5` and
  `ce1aedec0ddc619ea92414444377f1b243bc29b9`). The earlier in-progress merge is complete and
  `repo:state` is clear. After the sync, the focused E2E passed (4 tests), the E2E helper suite
  passed (21 files, 1,536 passed, 13 expected failures), `npm run tsc` and `npm run build` passed,
  and `npm run lint:check` passed with 64 existing warnings and no errors. Before landing, rerun
  `repo:state` and confirm the actual main pin is still `ce1aedec`; sync and rerun these gates if it
  moved. The earlier raster candidate's validation and reviews are recorded in merge `f43d7e52`.
- The production gate was not changed. `HistoryItem[]` and `replayHistory()` remain logical
  authority. Slices 2A and 2B are still independent and unproven. At resume, inspect live ownership:
  the existing frame-parity task retains Slice 2A until explicit handoff, and the separate
  import/replacement candidate is not reusable without its owner's handoff and current-main review.
  Select one source family only after proving the producer, exact history shape, owned assets, and a
  missing acceptance path; do not harvest another active worktree.
- Sol found that status publication alone could let the test sample correct legacy pixels before
  the durable repaint. The candidate now exposes DEV-only paint source/cursor markers after
  `drawLayersToCanvas` succeeds; pending and failed draws clear the durable claim. The E2E requires
  a successful durable paint at cursor 1 before comparing output and a successful legacy paint at
  cursor 1 after redo. Sol's final read-only review confirmed that fix. A free Kilo final review
  also ran at reported cost zero; its locator, synchronous draw, and failure-path concerns were
  checked against the test and renderer and were not actionable.
- The latest user instruction authorizes extensive free compute. `MODELS.md` identifies the verified
  zero-cost runner and live catalog as the route; use them for bounded reviews. Codex `spawn_agent`
  does not expose provider routing, so do not describe an unverified subagent route as free.

## Prelanding checkpoint — 2026-10-29

This records readiness immediately before the merge above. The 2026-10-28 sync and inventory
entries below are historical evidence and do not describe today's branch or repository operation
state.

- The actual `refs/heads/main` worktree is
  `/Users/bkalynovskyi/ph/.kilo/worktrees/main-clean-20261028` at
  `84c1c9200f7a8c14f88fca1b4b465d0fa9430785`. It was clean when checked, and
  `npm run repo:state` reported no worktree operation in progress.
- `task/history-migration-continue-20261029` was created from that exact main pin. The 11-file
  Slice 1 candidate from `docs/history-migration-plan-20261027` (`52d5093e`) is prepared as a
  no-commit merge in
  `/Users/bkalynovskyi/ph/.kilo/worktrees/history-migration-continue-20261029`; it has **not**
  been landed at this checkpoint. Recheck staged and unstaged state before continuing.
- `ph-12` is claimed by `task/history-migration-continue-20261029` with a 240-minute lease. The
  task holds `StoreContext.tsx`, the source-backed presentation unit and E2E tests, the plan, and
  `docs/HISTORY-MIGRATION-NEXT.md`. Recheck the live lease and path locks before edits or landing.
- The candidate's source-backed unit/lifecycle/reset tests passed (90 tests total), and
  `e2e/source-backed-history.spec.ts` passed. Terra found a test gap where an image create could
  be translated to a blank durable source without failing the mocked-compositor unit test. The
  test now requires image→raster and blank→blank, checks registered image dimensions, borrowed
  ownership and exact source identity, and checks blank color/opacity/size. Its 8 tests passed;
  Terra re-reviewed and closed that finding. Sol's read-only StoreContext review found no
  actionable issue. The mocked-compositor test still is not pixel-parity evidence.
- This prelanding checkpoint is historical; the later History-panel reachability proof and its
  validation are recorded above.

## Current-main sync and active decision record — 2026-10-28

At the time of this sync, the actual local `refs/heads/main` was checked out at
`/Users/bkalynovskyi/ph/.kilo/worktrees/main-landing-selection-20261028`, not the root
`main-sync` checkout. The reviewed main pin for the sync is
`3ccccba083eab71df75971bcb4037d7df1fb9f13`. A fresh worktree-list check on 2026-10-28
now places `refs/heads/main` at
`/Users/bkalynovskyi/ph/.kilo/worktrees/main-clean-20261028`, still at that same SHA. The
migration branch is
`docs/history-migration-plan-20261027` in
`/Users/bkalynovskyi/ph/.kilo/worktrees/history-migration-plan-20261027`.

The main-into-branch merge was committed as `976a201e7009f78d89caf9112d56af730438324b`,
with parents `d6968c47e1ae5ba6a85bc4cd9bb2e0adad9b0176` and
`3ccccba083eab71df75971bcb4037d7df1fb9f13`. The plan checkpoint is `98f2fb5f2b55fb85d83a280861a891a08691a822`.
`git cherry` found the implementation and checkpoint commits `eeed3af4` and `d6968c47` are
unique to this branch. `git range-diff` showed the 40 main commits and two branch commits have no
corresponding patches, so this was a real sync merge, not a replay of equivalent commits.

Conflict resolution ledger:

- `src/contexts/StoreContext.tsx`: keep main's cursor-prefix gate for navigation and all
  later appends. Preserve a narrow exception for the current image/blank `NEW_LAYER_ACTION`
  background composition only when the prior active prefix passes that existing ownership
  and frame gate. The newly created cursor remains legacy-gated for navigation; this does
  not authorize another create or ordinary edit to skip a source-backed event.
- `HANDOFF.md`, `docs/HISTORY-MIGRATION-NEXT.md`, and `docs/HISTORY-MIGRATION.md`: keep
  current main's newer frame matrix and its exact remaining mixed-source fractional
  composite mismatch. Add the bounded create behavior and its fallback rule from this plan.
  Do not retain the older one-raster frame status as current evidence.

The `2026-10-28T17:41Z` inventory snapshot was generated before the sync and is stale. The latest
post-commit inventory refresh wrote the canonical `WORKTREES.json` in `main-clean-20261028` and
reported 45 worktrees, one ready to land, and seven to dispose. `npm run branches:orphan` reports
13 refs with no worktree; it disposed none. These are snapshots and must be refreshed after
tomorrow's tests/commits stop changing the roster. `npm run repo:state` still exits nonzero for an unrelated `AUTO_MERGE` in
`/Users/bkalynovskyi/ph/.kilo/worktrees/dispose-worktree-main-ref-20261028`, branch
`fix/dispose-worktree-main-ref-20261028`, HEAD `d34305f4fca0996664029cd2003e912f4d844e4d`.
Do not inspect or resolve that operation from this task; it blocks landing until its owner clears
it, but it does not erase the branch-local migration handoff.

Fresh local ownership snapshot (recheck it at resume; these are leads, not permission to harvest):

- `ph-12` is still claimed by this branch for the source-backed create slice, but its lease had
  178 minutes remaining at the check. The next agent must inspect `show ph-12`, renew/reclaim it,
  and run `swarm check` before edits.
- `history-migration-reimplementation-20261028` is at `17d476fa`, 47 commits behind current
  main, and has an untracked `HANDOFF-SALVAGE-20261028.md` for a different blocked SALVAGE PLANS
  task. It is not the continuation branch or migration source of truth.
- `source-backed-ownership-20261028` is at `48fc2c85`, 21 commits behind current main, with an
  untracked quarantine file. Do not merge or reuse it without a fresh owner handoff.
- `source-backed-import-replacement-hardening-20261028` is clean at `95785f9a`, seven commits
  ahead of current main and missing one main commit. Treat it as a separate candidate; recheck its
  owner, worktree, tests and merge base before selecting import/replacement work.
- `frame-fractional-composite-root-cause-20261028` is 14 commits ahead of current main. The older
  `history-frame-control-raster-delta-20261027` worktree has uncommitted changes and is 140 main
  commits behind. Do not edit, cherry-pick, or harvest either frame investigation here.
- The swarm board showed `ph-12` as the only claimed issue; its three currently ready issues are
  unrelated E2E work. Board state and these branch counts can change before tomorrow.

The migration issue `ph-12` is reclaimed by this branch. Files held: `StoreContext.tsx`,
the source-backed presentation unit and E2E specs, the document-reset regression test, the
history migration/handoff docs, and this plan. Earlier validation and review evidence below
applies to the pre-sync candidate only.

## Historical restart checkpoint — 2026-10-28

Status at that checkpoint: **Slice 1's bounded unit contract is implemented and current-main sync validation
is complete; the default startup path remains gated, while a History-panel route is a
source-derived but untested reachability candidate; the sync is committed in this branch
and not landed onto main; broader migration remains unproven**.
Implementation checkpoint: `eeed3af4b613d7a14e2821016038e7ee05508769`. This commit and
the prior handoff commit are not ancestors of current main.
This is the durable handoff if the coordinating session loses quota. Resume in the
absolute task worktree below, never in the root `main-sync` checkout. Do not recreate
the changes or harvest the separate active frame task.

## Next-run execution plan — prepared 2026-10-28

The committed data is sufficient to resume this branch without reconstructing the design, but it
is not sufficient to claim the history migration is finished. `HistoryItem[]` and
`replayHistory()` remain the production logical authority; durable replay is a shadow/presentation
path with explicit fallback. Frame parity, source ownership for several producers, and the
authority/performance slices remain open. The next run should close or conclusively disprove one
product-reachable source-backed create path, then select the next independently owned slice. Do
not attempt the authority cutover as a continuation shortcut.

### Re-entry and ownership gates

1. Run `git worktree list --porcelain` first. Resolve the live `refs/heads/main` worktree and SHA
   from that output; do not trust a prior path or the root `main-sync` checkout. At the last check,
   main was `3ccccba083eab71df75971bcb4037d7df1fb9f13` in `main-clean-20261028`, while this branch
   was clean at `98f2fb5f2b55fb85d83a280861a891a08691a822` and already contained main as a parent.
2. Verify `pwd`, this worktree's top-level, branch, HEAD, git/common-dir, and status before editing.
   Run `npm run repo:state`, `npm run swarm -- status`, `npm run swarm -- show ph-12`, and
   `npm run swarm -- check` for every planned path. The `ph-12` lease will have expired by
   tomorrow; only continue after the live claim is reacquired and no other writer holds the paths.
3. `repo:state` currently reports the unrelated `AUTO_MERGE` above. Do not enter or repair that
   worktree. Local branch-only investigation can proceed in the owned task checkout; do not land,
   push, dispose worktrees, or declare the repository globally ready while the operation remains.
4. Treat the fresh worktree/branch inventory above as a snapshot, not a queue. In particular, do
   not take changes from the stale reimplementation handoff or the source/frame worktrees without
   their owners' explicit handoff and a current-main diff review. Run `node scripts/worktree-inventory.mjs`
   only after tests and commits stop changing the roster; never add `--quiet`.

### First bounded objective — complete: prove the gate-free append through the existing UI

The default blank-document path is still gated: `BlankImageStarter` calls `setBlankImage()`,
`createBlankLayer(..., true)` records a `NEW_LAYER_ACTION`, and `_addLayer()` replaces the document.
That `REPLACE_DOCUMENT` path does not call `publishDurableAppendPresentation()`; only committed
appends and store-owned reorder commits invoke that publisher. Ordinary paste and Background
conversion therefore begin with an active gated prefix. The existing E2E proves their legacy
fallback and exact pixels/exports.

A tested alternate route now proves that the existing gate can be satisfied through visible UI:

- `HistoryTab.tsx` exposes an eye button to disable any history row.
- `useHistory.toggleDisabled()` refuses to disable the first `OPEN_DOCUMENT_ACTION`, but it does
  not apply that protection to the default first `NEW_LAYER_ACTION`.
- `replayHistory()` skips disabled entries, and `durablePresentationGateReason()` skips them too.

Disabling the initial blank `NEW_LAYER_ACTION` makes the replayed active prefix empty, so a
subsequent supported create can pass the existing gate. This is now verified by two UI routes:

1. The landed raster E2E starts at the real default blank document, disables its first History row,
   pastes a deterministic raster through the clipboard/UI path, and verifies the durable append,
   exact canvas/PSD/PNG pixels, undo/redo, and disabled root row.
2. The tablet E2E candidate follows the same root-disable path, then creates a transparent blank
   through the mobile Layers drawer. It requires a durable paint at the append cursor, exact canvas
   and export pixels, the PSD blank-layer bounds and pixels, and exact undo/redo while the root stays
   disabled.
3. Keep the first-row `OPEN_DOCUMENT_ACTION` disable refusal covered. Preserve the existing tests
   for stale replacement, incomplete coverage, finalization failure, tool sources, lease retirement,
   and legacy fallback. Redo remains a complete `ownership-unproven` fallback. No tolerance,
   implicit rasterization, or broad generic image opt-in.

Together the routes establish one narrow product condition: supported source-backed create can
publish a durable append after a user disables the default blank History row. The default active
root, imported-raster baselines, later source-backed edits and frame-changing commits remain gated
unless separately proven. This closes the `ph-12` reachability slice only; it does **not** finish
durable history migration or change production eligibility.

### Choose the next implementation slice only after the first objective

After the blank-source E2E has passed review and landed, re-read the current plan's Slice 2A/2B acceptance tables and
inspect live ownership. Slice 2A frame parity and Slice 2B source-family ownership are independent;
neither can be declared complete from the other. The current source-backed import/replacement
branch is a separate seven-commit candidate with one local-main commit missing, so it is not ready
to cherry-pick or merge without owner handoff, rebase/merge-base review, tests and two read-only
reviews. The fractional frame investigation remains separately owned. Choose one family only when
there is a named missing behavior and its exact test/producer path; eligible candidates listed in
Slice 2B are editable vector/text creation, typed replacement, merge/import replacement, and
whole-document replacement. Do not duplicate an existing adapter or worktree's implementation.

For any selected family, establish before editing:

- The real producer and exact `HistoryItem`/durable entry shape; preserve operation ordering,
  labels, sparse order, selection and active-layer identity.
- Asset owner/generation and borrowed/owned bitmap lifetime through append, navigation, disabled
  rows, append-after-undo, document replacement and close.
- Whole-document renderer coverage and parity at every relevant cursor: exact composite, per-layer
  bounds/alpha/pixels, mounted runtime projection, PNG and PSD adapters. Unsupported layers force
  whole-document fallback.
- Stale completion, missing asset, refusal, finalization failure, preview interleaving and failed
  final draw all retain one consistent legacy state without a duplicate append or partial publish.

Keep Slice 3 (durable-first logical undo/redo and history-panel navigation) and the bedrock
ownership exception as Sol-level architecture gates. Slice 4 requires measurements from the real
production replay path. Do not retire `HistoryItem[]` readers or advertise a single authority until
all supported surface families, fallback policy, performance/cancellation and final-draw rollback
are proven together.

### Validation, review and finish criteria

- Use the focused suites already named in this plan plus
  `npm run test:e2e -- e2e/source-backed-history.spec.ts`; run `npm run test:e2e:unit` whenever
  E2E files change.
  Then run `npm run test -- --silent`, `npm run tsc`, `npm run build`, and `npm run lint:check`
  on the exact candidate. Follow `docs/E2E-MIRROR.md` for a broad mirrored E2E run; never open a
  browser window.
- Migration/persistence/cross-module behavior needs two independent read-only reviews after the
  implementation is final. Follow current `MODELS.md` and the user's latest instruction to use
  verified free compute heavily. Verify that each route is free and produces a complete, reviewable
  response; timeout, empty, truncated, rate-limited, or unverified outputs are not review evidence.
  Do not silently switch to paid compute. Reviewers report; the coordinator verifies findings.
- Do not call the migration complete until Slice 2A and every needed Slice 2B source family have
  explicit parity/ownership gates; Slice 3 performs atomic durable-first navigation with exact
  labels and tool hydration; and Slice 4 measures replay cost, cancellation and safe baseline
  acceptance. The `HistoryItem[]` authority can be removed only in that reviewed change. Otherwise
  record the exact completed slice and leave the broader migration `unproven` with the next
  dependency named.
- Commit only reviewed, high-confidence changes with the native `Chat:` trailer. Landing to main
  remains a separate pinned procedure and is blocked until the owner clears the current
  `repo:state` operation and the exact latest-main/parent/tree checks pass.

Current implementation boundary:

- `src/contexts/StoreContext.tsx` keeps background publication limited to current image/blank
  `NEW_LAYER_ACTION` entries whose preceding active cursor prefix passes the ownership and frame
  gates. The created cursor keeps legacy navigation fallback. The default active blank root and
  imported-raster baselines remain gated. Do not relax this production predicate.
- `src/contexts/__tests__/history-append.create.test.ts` pins Shape Tool source conversion to a
  current typed vector entry, with exact arguments, source position and size, cloned/frozen args,
  and no durable asset lease.
- `src/contexts/__tests__/StoreContext.source-backed-presentation.test.tsx` pins that vector,
  text, and pencil creates stay unpublished and do not call the compositor; the vector conversion
  remains current. Existing image/blank success, ownership-before-composition, lease, stale,
  coverage and finalization gates remain covered.
- `e2e/source-backed-history.spec.ts` exercises the user-disabled-root route for raster paste,
  tablet blank creation, and a Shape Tool rectangle. The vector test requires legacy paint, exact
  canvas/PNG/PSD composite and layer pixels, undo/redo pixels, and legacy `ownership-unproven`
  fallback. It makes no claim that PSD preserves editable vector semantics.
- `docs/ARCHITECTURE.md`, `HANDOFF.md`, `docs/HISTORY-MIGRATION.md`,
  `docs/HISTORY-MIGRATION-NEXT.md`, and this plan describe the current production boundary and
  keep remaining migration gates explicit.

Verified evidence so far:

- The five focused presentation/append/preview/export suites passed **66 tests**.
- The lifecycle, installed compiler-guard, and new publication suites passed **94 tests**
  after the full-suite findings below were addressed.
- New headless E2E passed in run `2026-10-27T21-03-51-323Z-7467`; existing
  preview/Background-conversion E2E passed in `2026-10-27T21-05-10-229Z-39253`.
- `npm run tsc`, `npm run build`, and `npm run lint:check` passed. The repository
  lint count is 64 warnings, zero errors. Explicit ESLint on new files caught a promise
  executor returning `toBlob()`; the executor now has a block body and its focused check passed.
- The pre-sync full unit suite passed: **399 files, 11423 tests passed, 219 established
  expected failures**, no failures; duration 155 seconds. The documentation-index follow-up
  also passed all 10 tests after this plan was registered in `docs/README.md`. These counts
  do not validate the current-main merge composition.
- Validation pitfalls are resolved: a fresh `npm ci --ignore-scripts` checkout needs
  `node scripts/install-tsc-guard.mjs`, and import identity tests must allow independent
  render output allocation. No compiler guard, pixel tolerance, expected-failure list,
  console gate or theme gate was weakened.
- Two independent read-only completion reviews through verified-free
  `kilo/poolside/laguna-s-2.1:free` completed with `finish_reason=stop`, zero reported
  cost and `NO_BLOCKING_FINDINGS`: ownership/publication and eligibility/browser proof.
  A follow-up of the lifecycle assertion also found no blocking issue; its speculative
  suggestion to copy an editable raster is contrary to the existing immutable-input contract.
  These were completion reviews of the old candidate, not tool-using agents; fresh review
  of the current-main composition is still required.

Resolved reachability boundary: the default active blank `NEW_LAYER_ACTION` still makes ordinary
creates ownership-unproven, and `REPLACE_DOCUMENT` does not exercise the committed-append
publisher. The disabled-root path is now proven through the visible History panel for deterministic
raster paste and tablet blank creation, with exact renderer and export pixels. A Shape Tool rectangle
can also be created on that path, but converts to a current typed vector entry that intentionally
stays unpublished and legacy-painted. The E2E verifies this refusal and exact legacy pixels through
undo/redo. The gate remains limited to image/blank; there is no test or production path that promotes
tool-source creates. Default active roots, imported-raster starts, and other source families remain
gated until independently proven.

Historical sync-tree evidence from 2026-10-28 (superseded by the Latest checkpoint above): the
four focused StoreContext/presentation suites passed 96 tests; the document-reset suite passed 15;
the full unit suite passed 399 files, 11,489 tests, and 215 established expected failures. These
counts and the then-current two-case browser run are not evidence for the vector characterization.
The current task's exact validation is recorded in the latest checkpoint. Broader authority and
product-flow proof remain open.
After this plan update, the citation suite passed 24 checks and `npm run lint:check` passed with
64 existing warnings, zero errors, and clean Prettier formatting.
The validated main-into-branch merge is commit `976a201e7009f78d89caf9112d56af730438324b`,
with parents `d6968c47e1ae5ba6a85bc4cd9bb2e0adad9b0176` and
`3ccccba083eab71df75971bcb4037d7df1fb9f13`. It is not a landing onto main.

The five silent-loss sweeps are complete on the staged merge: the marker scan is clean across
50 staged paths; heading counts are HANDOFF 46/46/46/46 and TEST-FLAKES 14/14/14/14
(base/branch/main/index); `e2e/OPEN_PROBLEMS.md` severity headings are 14/14/12/12, with main
and the index matching after main removed the resolved 37-degree control and disabled-option
findings; duplicate-key review found no overlapping map, registry, switch, barrel, or object-key
additions across the four files changed on both sides (`HANDOFF.md`, both history migration docs,
and `StoreContext.tsx`); citation tests pass 24 checks; and semantic re-anchoring confirms the
source gate, append caller, startup producer, navigation behavior, and fallback E2E expectations.

Current next steps:

The **Latest checkpoint** at the top is the live status; older dated inventories, claims and
provider snapshots below are historical evidence. The disabled-root UI path is already proven for
raster paste and tablet blank creation. Do not repeat that discovery task or describe it as
unproven. The vector test is characterization only and does not open the production gate.

For the current `ph-14` candidate, the live claim and eight path locks are held by this branch.
The focused Shape Tool suite passes locally and on each platform; the broad mirror at `ba9dc09a`
fails on crop-history, Small Caps, and durable-presentation cases outside this task's locks. Do
not stage or edit those paths without their owners' handoff. The full broad gate must be green on
the exact candidate before landing. A current read-only Luna review of the Shape Tool test found no
actionable issue. Continue to follow the current operator instruction not to run Sol or Terra
reviewers; obtain fresh allowed read-only reviews for any new non-trivial changes.

The most recent `repo:state` check reported an in-progress merge in the actual local `main`
worktree. Do not inspect or resolve it here, and do not start a landing. Once its owner completes
it, refresh `git worktree list --porcelain`, confirm the actual `refs/heads/main` checkout and clean status,
run `npm run repo:state`, and sync that exact committed main pin into this branch with a no-commit
merge for inspection. Review the merge, commit it with the native `Chat:` trailer, and rerun all
gates the sync invalidates. Only after the full broad mirror is green should the pinned local-main
landing procedure begin. Recheck live issue/file locks, checkout mappings, both parents, tree,
native chat ID, and current inventory immediately before landing; never use the root `main-sync`
checkout. After landing, resolve `ph-14`, recheck ownership, and select the next bounded source
family from this plan. Any product-behavior or gate-related edit after review invalidates the
relevant review and gate evidence.

After this candidate lands, resolve `ph-14` and recheck current ownership before choosing another
bounded slice. The frame-parity and import/replacement investigations are independent and remain in
their existing worktrees; do not harvest them without an explicit owner handoff and fresh review.
Prefer an independently owned source family with a concrete missing producer/test path, and leave
vector publication, frame-changing commits, active-root/import ownership, authority cutover and
replay-budget/cancellation for a separately proven gate. Continue to use verified free compute
heavily per current `MODELS.md`; timeouts, rate limits, empty or truncated responses are not review
evidence. Do not use paid inference without explicit authorization for the specific review.

## Goal and baseline

Move toward one durable logical replay authority through independently proven slices.
Preserve editable source arguments, exact history labels, atomic whole-document publication,
selection baselines, explicit rasterization consent, and desktop/tablet behavior.

Owner: Codex session `01a17f24-9224-7aa0-a412-3afafa09f797`, branch
`task/history-disabled-blank-root-e2e-20261029`, worktree
`/Users/bkalynovskyi/ph/.kilo/worktrees/history-disabled-blank-root-e2e-20261029`.

Baseline at the start of this sync was actual `refs/heads/main` at
`3ccccba083eab71df75971bcb4037d7df1fb9f13`, checked out in
`main-landing-selection-20261028`. The workspace root is `main-sync` and is not the
baseline. `repo:state` reports an unrelated open operation in
`dispose-worktree-main-ref-20261028`; check it without resolving or editing it before
any later landing.

Current source confirms that `HistoryItem[]` and `replayHistory()` remain logical
authority. Durable navigation and eligible append/reorder stage presentation;
raster/PSD export use their guarded durable adapter. `durablePresentationMismatch()`
admits only raster, blank, and vector sources without retained operations and with
matching bounds. A current durable conversion alone does not prove presentation.

Current main contains the broader frame-parity matrix, a pure-affine compositor change,
source-backed cursor gating and imported-bitmap lifecycle work. Exact composite parity in
the listed cases does not clear the separate mixed-source fractional composite mismatch at
canvas pixel `(5, 26)` (legacy red/alpha `188/122`, durable `190/121`). The active
`frame-fractional-composite-root-cause-20261028` worktree owns that investigation; do not
edit or harvest it here. The active source-backed import/replacement worktree also remains
outside this task's write set.

## Slice 1: supported source-backed create presentation

Paths: `StoreContext.tsx`, `StoreContext.source-backed-presentation.test.tsx`,
`e2e/source-backed-history.spec.ts`, and the architecture/restart/handoff descriptions.
This slice is independent of the active frame-materialization work.

Implementation: allow image/blank `NEW_LAYER_ACTION` commits to request background
durable presentation after their asset transaction commits and reconciles. Preserve
the immediately visible legacy selector during composition. Keep tool-source creates,
source replacements, merge, and frame-changing commits on their existing gates.
The whole-document renderer compatibility check remains mandatory; a supported new
layer does not make unsupported pre-existing layers eligible.

Current proof and remaining acceptance gap:

- Register image assets under the current document before composing; retain borrowed
  legacy source ownership and independent disposable materialization leases.
- Reject stale work after document replacement; release abandoned leases exactly once.
- Reject incomplete materialization for the whole publication while retaining the
  committed legacy layer, timeline, and input asset.
- Do not compose after asset finalization failure or for tool-source creates.
- Actual paste and Background conversion are exercised headlessly. They prove exact legacy
  undo/redo pixels, native-resolution PNG pixels, and PSD composite plus layer pixels while
  asserting `unpublished` status and `ownership-unproven` legacy fallback. They do not prove
  durable publication because the default blank baseline is already gated.
- Before claiming this slice as a product migration, identify a supported product flow whose
  prior active prefix is proven gate-free, or resolve baseline ownership under the authority
  plan; then exercise that flow's durable publication and navigation with exact pixels. Do not
  weaken the existing prefix gate to manufacture reachability.
- Preserve existing renderer preview tests and raster/PSD adapter tests.

Handoff: this is presentation progress only. Logical undo/redo remains legacy-owned.
Record the final commit and gate evidence before releasing the slice.

## Slice 2A: integrate and finish frame materialization proof

Owner: the existing frame-parity task until it explicitly hands off. Dependencies:
review its final candidate against live main; do not layer a second fix onto active work.

Paths: `materialization.ts`, `durable-compositor.ts`, presentation evaluator, frame
and affine E2E fixtures, and `durableExportRecords()`/PSD consumers as needed.

Close these independently:

1. Final composite: exact bytes for the frame-only control and retained-affine controls.
2. Tight per-layer raster: exact dimensions, enclosing bounds, alpha, and placement.
   No tolerance and no full-document buffer for each layer.
3. Runtime projection and raster/PSD export: actual production adapters must preserve
   those same pixels and metadata, including non-zero and fractional frame origins.
4. A bounded matrix: positive/negative and quarter/non-quarter angles; retained affine
   followed by frame transforms; repeated frame-only/rotated transitions; raster, blank
   opacity, supported vector/paint tools, styled and rotated point/paragraph text;
   clipping, visibility, opacity, blend modes, and fractional bounds.

Keep a fixture-to-source-to-cursor coverage table. Every supported case must pass at
each relevant cursor and differ from controls that omit its operation. Each unsupported
case must prove whole-document fallback. Browser differentials compare this app's
renderers; they are not an independent Photoshop pixel oracle.

Handoff: only a separate reviewed publication change may admit a proven frame subset.
Passing composite pixels alone does not change `durablePresentationMismatch()`.

## Slice 2B: remaining source-backed surfaces

Independent of Slice 2A; neither imposes an order on the other.

Paths: source-backed planners in `history-append.ts`, `StoreContext.tsx`,
`useLayer.ts`, asset registry/presentation ownership, source-edit hydration, export.

Take one family at a time: editable vector/text creation, typed source replacement,
merge/import replacement, and whole-document replacement. Establish the lifecycle
contract before changing a presentation gate. Whole-document replacement already has
its own document-scope teardown; it must not be treated as an ordinary layer append.

Proof: immutable raster registration or snapshotting; exact owner/generation and
reachable assets through append, navigation, disabled entries, branch truncation and
document close; independent source arguments and history labels; sparse legacy order
and names; active layer/selection/frame preservation; stale/refused work and final-draw
failure; preview interleaving; raster/PSD export through production adapters. Retain
unsupported-source refusal until an adapter and its evidence exist.

Handoff: admit only each proven family. Do not use automatic rasterization to bypass
unsupported editable sources. Multi-layer Background conversion remains a separate
atomic operation requirement, not a reason to weaken this gate.

## Slice 3: durable logical navigation for eligible documents

Dependencies: explicit coverage of every surface and operation reachable in the
eligible document class, including Slices 2A/2B where applicable. An eligibility
decision may keep other documents on a complete, explicit compatibility path.

Paths: `useHistory.ts`, `StoreContext.tsx`, durable replay/timeline and panel projection,
`useCurrentTool.tsx`, renderer/export adapters. Reconcile the older
`durable-replay-authority.md` by current symbols; its unimplemented checklist is not
evidence that an already-landed adapter is missing.

Implement a durable-first navigation transaction: derive logical layers, active layer,
selection, frame and cursor from durable replay; materialize and stage presentation;
publish one matching identity only after successful final drawing. Legacy replay must
not run first as an implicit second writer for eligible documents. Unsupported or
unavailable documents use one explicit whole-document fallback decision.

Proof: undo, redo, history-panel navigation, disabled-entry toggles, append after undo,
empty timelines, baseline-only/no-op/duplicate entries, document switching, and failed
publication all agree on logical state and pixels. Keep exact labels/provenance and
options-bar hydration; never overwrite an active draft. Inject stale completion, missing
assets, partial conversion, unavailable canvas filters, and final-draw refusal.

Handoff: remove the normal legacy logical reader only with the contract that replaces
it. Preserve fallback while supported product documents can still require it.

## Slice 4: replay budget and retirement

Instrument actual production replay/materialization work, with cooperative cancellation
and yields. Do not resurrect the retired coordinator/checkpoint modules just to satisfy
an old plan. Add a configurable budget and an explicit acceptance path for a raster
baseline only after measuring the real path.

Proof: decline/cancel/failure preserve the document and timeline; acceptance stages and
publishes a safe baseline before old assets retire; empty-history and subsequent undo
cannot blank the document; text/vector sources are never rasterized automatically.

Retire redundant legacy writers/readers only after the corresponding durable behavior
and unsupported-document policy have landed. Final acceptance requires one logical
authority across navigation, commits, rendering, export, panel state and tool hydration.

## Research, validation, and landing

Adobe primary-source checks on 2026-10-27:

- Sourced: [Rotate a layer](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/transform-manipulate-layers/rotate-a-layer.html)
  affects the chosen layer; [Rotate or flip entire images](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/rotate-or-flip-entire-images.html)
  affects every layer. These support separate layer/frame controls, not a prescribed resampling algorithm.
- Sourced: [History panel settings](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html)
  describes selecting earlier states. Exact app labels, replay budgeting, ownership,
  linear branching, and rasterization consent remain repository/operator contracts.

Source-checked history algorithm research on 2026-10-29 used two successful zero-cost
`kilo/poolside/laguna-s-2.1:free` completions, then direct inspection of upstream source. These are
implementation analogies, not Photoshop requirements:

- [miniPaint `Base_state_class`](https://github.com/viliusle/miniPaint/blob/master/src/js/core/base-state.js)
  keeps a linear action array and cursor. A new action after undo removes and frees the redo tail;
  it caps the stack at 50 items, estimates action memory/database cost, and prunes undo before redo
  in its cleanup routine. [Its `Bundle_action`](https://github.com/viliusle/miniPaint/blob/master/src/js/actions/bundle.js)
  rolls back already-run children in reverse order when a later child throws. The project describes
  action grouping in its [Undo/Redo system](https://github.com/viliusle/miniPaint/wiki/Undo-Redo-system).
- GIMP's [`gimpimage-undo.c`](https://github.com/GNOME/gimp/blob/master/app/core/gimpimage-undo.c)
  supports nested group scopes with a depth counter; only the outermost start clears redo and
  creates the compound item. It discards redo on a new push, and compresses matching command
  type/class only when the image is dirty and redo is empty. Its budget trims oldest entries when
  the configured byte limit or 1024-level cap is exceeded, while preserving the configured minimum.
  Undo/redo moves the popped entry between stacks and reverses child order for grouped entries;
  see also [`gimpundostack.c`](https://github.com/GNOME/gimp/blob/master/app/core/gimpundostack.c).
- Krita separates its [`KisUndoStore`](https://github.com/KDE/krita/blob/master/libs/command/kis_undo_store.h)
  storage interface from command-submission adapters; the store belongs to the image. Its separate
  [`KisMementoManager`](https://github.com/KDE/krita/blob/master/libs/image/tiles3/kis_memento_manager.cc)
  records tile revisions. Each `getMemento()` clears cancelled redo revisions, commits current
  changes and starts a named memento; rollback restores parent tile records in reverse with
  registration blocked, rollforward restores records forward and recommits, and history purge drops
  revisions older than the chosen memento. Do not conflate this tile-memento algorithm with
  `KisUndoStore` command grouping.

Once `ph-14` lands and the next owned family is selected, use these only as prompts for repository-
specific tests: append after undo invalidates redo resources once; failed grouped work restores state
in reverse without leaving a partial logical entry or published state; replay/rollback does not
accidentally append a new logical item; bounded cleanup preserves cursor and retained-source
ownership. Do not implement a
generic transaction, cleanup budget, or new source family based on analogies alone.

For each implementation slice: focused unit tests, headless production-seam/pixel E2E,
`npm run tsc`, `npm run build`, lint/format checks, and two fresh independent read-only
reviews for migration changes. Use verified free routes without private transcripts,
credentials, or paid fallback. Broad E2E uses the mirror workflow.

Land each slice through the pinned merge procedure after syncing current main into the
task branch. Recheck `repo:state`, checkout mappings, both parents, tree and chat trailer;
never merge into dirty main. If a gate fails, keep the affected surface on its complete
legacy path and record an explicit blocked/unproven handoff with the next action.

## Remaining status

Broader migration: **unproven**. The bounded raster/tablet blank-source proof is landed on actual
local `main` at `730339e5983d42f52fe102d83d8bfd286137a6c5`. `ph-12` is resolved; `ph-14` remains
claimed and unlanded. The full mirror tested code candidate
`ba9dc09a341d7fa3be8e93b86f50afa49c7fe001`, which includes committed main through
`1b0b55a80da7da17022deea87f8248abdcbc92d4` via sync merge
`331103961e3f58eeae3cd43cccaf2be8d355cc90`. Its Shape Tool characterization passes focused local,
Linux, Windows, and full-mirror per-platform checks without changing production eligibility. The
full broad mirror fails on owned-by-others crop-history, Small Caps, and durable-presentation
expectations. The last observed state of the actual local main worktree was an unrelated
in-progress merge. Do not land or widen production gates until both blockers are cleared. When
main is clear, sync its latest committed pin, rerun the required exact-candidate gates, then use
the pinned landing procedure.
After landing, reassess frame and import/replacement ownership before selecting the next slice.
Keep vector publication, Slices 2A through 4, and all other unproven source families gated until
their listed evidence is complete.
