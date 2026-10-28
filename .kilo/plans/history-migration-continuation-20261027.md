# Continue durable history from current main

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

## Restart checkpoint: preserve this work first

Status: **Slice 1's bounded unit contract is implemented and current-main sync validation
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

### First bounded objective: prove the gate-free append through the existing UI

The default blank-document path is still gated: `BlankImageStarter` calls `setBlankImage()`,
`createBlankLayer(..., true)` records a `NEW_LAYER_ACTION`, and `_addLayer()` replaces the document.
That `REPLACE_DOCUMENT` path does not call `publishDurableAppendPresentation()`; only committed
appends and store-owned reorder commits invoke that publisher. Ordinary paste and Background
conversion therefore begin with an active gated prefix. The existing E2E proves their legacy
fallback and exact pixels/exports.

A concrete alternate route is visible in source but has not been proven in a browser test:

- `HistoryTab.tsx` exposes an eye button to disable any history row.
- `useHistory.toggleDisabled()` refuses to disable the first `OPEN_DOCUMENT_ACTION`, but it does
  not apply that protection to the default first `NEW_LAYER_ACTION`.
- `replayHistory()` skips disabled entries, and `durablePresentationGateReason()` skips them too.

Therefore a user may be able to disable the initial blank row and then append a source-backed
layer whose prior active prefix passes the existing gate. This is an inference from code, not a
verified product flow. Test it before changing production gates:

1. In headless E2E, start from the real default blank document and disable its first History row
   through the visible History-tab control. Verify the row is disabled, the replayed empty/current
   document remains usable, and an external paste through the existing deterministic clipboard
   fixture reaches the real `COMMIT_DOCUMENT_EDIT` path.
2. Before undo/redo, assert the append becomes `current` and its presentation selector is `durable`.
   Compare the exact composite and layer pixels, then verify native-resolution PNG and PSD output.
   Undo and redo must retain exact pixels and the disabled root entry; this is the only evidence
   that the UI flow, source transaction and navigation all agree.
3. Keep the first-row `OPEN_DOCUMENT_ACTION` disable refusal covered. Preserve existing tests for
   stale replacement, incomplete coverage, finalization failure, tool sources, lease retirement,
   and legacy fallback. No tolerance, implicit rasterization, or broad generic image opt-in.
4. If this flow is valid and passes, document the result narrowly: the create exception is
   reachable after the user disables the default blank history row; ordinary new-document,
   paste and imported-raster flows remain gated unless separately proven. If disabling the root
   creates an invalid document or the append cannot publish safely, leave the gate unchanged and
   hand the baseline ownership decision to Sol. Do not claim the exception is unreachable in all
   UI states, and do not exempt the root entry by assumption.

This closes or blocks the existing `ph-12` slice; it does **not** finish durable history migration.
The known positive unit fixture uses a synthetic gate-free `OPEN_DOCUMENT_ACTION` baseline, and
the Sol audit did not test the History-tab disable route.

### Choose the next implementation slice only after the first objective

After the gate-reachability E2E, re-read the current plan's Slice 2A/2B acceptance tables and
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
  implementation is final. The operator's current instruction is Luna or stronger only; do not
  use free-model routes. Read `MODELS.md` before any model/provider selection, and honor its
  subtask and cost rules for Sol/Terra. Reviewers report; the coordinator verifies findings.
- Do not call the migration complete until Slice 2A and every needed Slice 2B source family have
  explicit parity/ownership gates; Slice 3 performs atomic durable-first navigation with exact
  labels and tool hydration; and Slice 4 measures replay cost, cancellation and safe baseline
  acceptance. The `HistoryItem[]` authority can be removed only in that reviewed change. Otherwise
  record the exact completed slice and leave the broader migration `unproven` with the next
  dependency named.
- Commit only reviewed, high-confidence changes with the native `Chat:` trailer. Landing to main
  remains a separate pinned procedure and is blocked until the owner clears the current
  `repo:state` operation and the exact latest-main/parent/tree checks pass.

Implemented files:

- `src/contexts/StoreContext.tsx`: only a current image/blank `NEW_LAYER_ACTION` may
  compose in the background, and only if the preceding active cursor prefix passes main's
  existing ownership and frame gates. The new entry keeps legacy navigation fallback.
  The actual app boot path starts with a blank `NEW_LAYER_ACTION`, which main's gate marks
  `ownership-unproven`; imported raster baselines are gated too. The History-tab disable route is
  a source-derived candidate, not yet E2E-proven. Do not relax the cursor gate to make it reachable.
  Transaction ordering, freshness, renderer compatibility and whole-document coverage
  gates remain intact. Tool-source creates, later source-backed edits, merge, replacement
  and frame commits stay gated.
- `src/contexts/__tests__/StoreContext.source-backed-presentation.test.tsx`: eight
  tests cover image/blank success, ownership-before-composition, borrowed input lifetime,
  exactly-once lease disposal, stale document replacement, incomplete materialization,
  tool-source refusal, prior-prefix refusal and finalization failure without a duplicate
  logical append.
- `src/hooks/__tests__/useApp.document-reset.test.tsx`: the outgoing-document fixture now
  asserts the current main contract for its active source-backed prefix: navigation reports
  `ownership-unproven` and retains the legacy layer presentation.
- `e2e/source-backed-history.spec.ts`: actual paste and Background conversion on the app's
  default blank document. Paste uses a deterministic page-local clipboard reader, preserving
  the host clipboard. The oracle specifies an opaque white 800x600 document and a centered
  32x24 red/blue source independently; it checks exact legacy pixels, ownership-gated undo/redo,
  exact PSD composite and layer pixels, and exact native-resolution PNG pixels. These flows
  do not claim durable presentation: the initial blank `NEW_LAYER_ACTION` already gates the
  active prefix, so append status stays unpublished and navigation falls back to legacy.
- `src/contexts/__tests__/useLayer.lifecycle.test.tsx`: immutable import now forbids
  copying the original input, while permitting separate background render outputs;
  it also requires runtime and editable-source bitmap identity to remain the input.
- `docs/HISTORY-MIGRATION-NEXT.md`, `docs/HISTORY-MIGRATION.md`,
  `docs/ARCHITECTURE.md`, and `HANDOFF.md`: describe the bounded new eligibility and
  preserve the remaining gates. The restart guide's obsolete landing blocker is removed.
- `docs/README.md` indexes this newly tracked plan, as required by the documentation gate.

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

Current reachability finding — 2026-10-28: `App.tsx` creates the default blank document via
`setBlankImage()`, and `useLayer.ts` records that document's initial baseline as a
`NEW_LAYER_ACTION` with a blank source. Main's `durablePresentationGateReason()` treats every
active `NEW_LAYER_ACTION` as `ownership-unproven`. Consequently both actual paste and
Background conversion start from an already-gated prefix. The narrow append exception is
unit-tested against a gate-free `OPEN_DOCUMENT_ACTION` blank baseline, but that baseline has
not yet been demonstrated through the product UI. Keep the implementation bounded; do not
broaden the active-prefix gate.

The boot path uses `REPLACE_DOCUMENT`, which builds the durable shadow and requests temporary
layer presentation but does not call `publishDurableAppendPresentation()`. That background
publisher is called for committed appends. Thus the initial blank source does not exercise the
positive append exception; later paste and Background commits encounter that source in their
prior active prefix and remain gated. The targeted browser spec confirms unpublished status and
legacy fallback while checking exact visible and exported pixels.

The focused Sol audit reached the same boundary for ordinary active startup and raster-import
paths; it did not investigate a disabled startup entry. A fresh source read now shows a candidate
alternate path: `HistoryTab.tsx` exposes a disable button for each row, `useHistory.toggleDisabled()`
protects only an opening `OPEN_DOCUMENT_ACTION`, and both `replayHistory()` and the presentation
gate skip disabled entries. This makes disabling the first blank `NEW_LAYER_ACTION` a plausible
way to create a gate-free prefix, but no real UI/E2E proof exists yet and the resulting empty
document must be checked for correctness. Do not call the exception unreachable across all UI
states, and do not call this candidate reachable until the planned headless E2E passes.

Sync-tree evidence after the main merge: the four focused StoreContext/presentation suites pass
96 tests; the document-reset suite passes 15 tests after its stale durable-cache expectation was
aligned with main's ownership fallback; the full unit suite passes 399 files, 11,489 tests, and
215 established expected failures. `npm run tsc`, `npm run build`, and `npm run lint:check`
pass. The targeted headless `e2e/source-backed-history.spec.ts` passes its two fallback and
pixel/export cases. A focused paid Sol audit and two separately prompted read-only reviews via
`kilo/poolside/laguna-s-2.1:free` report no blocking code defect; the second review explicitly
confirms that `REPLACE_DOCUMENT` never calls the durable append publisher and the gate-free unit
fixture does not prove normal UI reachability. Both Kilo calls completed with `finish_reason=stop`,
`cost=0`, and no OpenRouter requests. No further model review is planned; broader authority and
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

Use the **Next-run execution plan** above as the live handoff. It supersedes the earlier inventory
command list: the last inventory is stale against the now-45-worktree registry, and the next run
must first prove or reject the History-tab disabled-root path. Do not widen the gate or begin
Slice 3/4 before those dependencies are resolved.

For subsequent edits, stage only owned paths. This ignored plan needs `git add -f`.
Commits require `Chat: 01a17f24-9224-7aa0-a412-3afafa09f797` and normal
lint-staged/type/build gates. Run focused tests after fixes; a new composition needs
its own applicable gates. Never run inventory concurrently with full unit worktree
integration tests or with commits that change the roster's recorded HEADs.

Coordination: swarm issue **`ph-12`**, owned by this task branch, holds the production
StoreContext path, new tests, lifecycle test and migration docs. Refresh/check live
claims before continuing. Its earlier automatic "merged into main" release happened
before the first task commit and was not landing evidence; the claim was reacquired.
The frame task owns `materialization.ts` and its affine
E2E file; this slice does not edit them or `e2e/OPEN_PROBLEMS.md`.

Provider state refreshed 2026-10-28: two required current-candidate reviews resolved to
`kilo/poolside/laguna-s-2.1:free`, each with zero reported cost; the last live OpenRouter
snapshot was `817/1000` used with `183` remaining at 18:16:48Z, and no OpenRouter call was made.
No Groq key or Free-plan opt-in is present. The operator has since instructed: do not use free
models for further reviews; use Luna or stronger. The completed free calls predate that instruction.

## Goal and baseline

Move toward one durable logical replay authority through independently proven slices.
Preserve editable source arguments, exact history labels, atomic whole-document publication,
selection baselines, explicit rasterization consent, and desktop/tablet behavior.

Owner: Codex session `01a17f24-9224-7aa0-a412-3afafa09f797`, branch
`docs/history-migration-plan-20261027`, worktree
`/Users/bkalynovskyi/ph/.kilo/worktrees/history-migration-plan-20261027`.

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

For each implementation slice: focused unit tests, headless production-seam/pixel E2E,
`npm run tsc`, `npm run build`, lint/format checks, and two fresh independent read-only
reviews for migration changes. Use verified free routes without private transcripts,
credentials, or paid fallback. Broad E2E uses the mirror workflow.

Land each slice through the pinned merge procedure after syncing current main into the
task branch. Recheck `repo:state`, checkout mappings, both parents, tree and chat trailer;
never merge into dirty main. If a gate fails, keep the affected surface on its complete
legacy path and record an explicit blocked/unproven handoff with the next action.

## Remaining status

Broader migration: **unproven**. Slices 2A through 4 require the evidence above. Slice 1
passed validation and two independent reviews on the pre-sync candidate, but its commits
are not ancestors of current main. The current-main merge composition needs fresh tests and
two fresh independent reviews before its sync commit. Swarm issue `ph-12` is open and claimed
by this branch; no landing or release is recorded. Keep Slices 2A through 4 unproven until
their listed evidence is complete.
