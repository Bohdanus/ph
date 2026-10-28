# Continue durable history from current main

## Current-main sync and active decision record — 2026-10-28

The actual local `refs/heads/main` is checked out at
`/Users/bkalynovskyi/ph/.kilo/worktrees/main-landing-selection-20261028`, not the root
`main-sync` checkout. The reviewed main pin for this sync is
`3ccccba083eab71df75971bcb4037d7df1fb9f13`. The migration branch is
`docs/history-migration-plan-20261027` in
`/Users/bkalynovskyi/ph/.kilo/worktrees/history-migration-plan-20261027`.

The main-into-branch merge is prepared in this task worktree with that exact `MERGE_HEAD`;
its four conflicts are resolved and staged here. `git cherry` found the implementation and checkpoint
commits `eeed3af4` and `d6968c47` are unique to this branch. `git range-diff` shows the
40 current-main commits and two branch commits have no corresponding patches, so this is
a real sync merge, not a replay of equivalent commits.

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

The inventory snapshot at `2026-10-28T17:41Z` was generated before this merge changed the
task checkout. It recorded main at `3ccccba`, 41 worktrees, no ready-to-land candidates,
and two live writer chats. `branches:orphan` reported 13 refs; no orphan or unrelated
worktree was changed. `repo:state` still reports an open `AUTO_MERGE`/`MERGE_HEAD` in
`dispose-worktree-main-ref-20261028`, whose working-tree status is clean. Do not inspect or
resolve its content on this task. The actual-main checkout also has the unrelated
untracked `HANDOFF-OPERATIONAL-20261028.md`; do not stage it. The fractional-frame
root-cause worktree and source-backed import/replacement worktree are still marked in use;
their files are outside this task's write set.

The migration issue `ph-12` is reclaimed by this branch. Files held: `StoreContext.tsx`,
the source-backed presentation unit and E2E specs, the document-reset regression test, the
history migration/handoff docs, and this plan. Earlier validation and review evidence below
applies to the pre-sync candidate only.

## Restart checkpoint: preserve this work first

Status: **Slice 1's bounded unit contract is implemented and current-main sync validation
is complete; its positive path is still unproven in normal UI flows; the merge commit is
committed into this branch as `976a201e7009f78d89caf9112d56af730438324b` and not landed
onto main; broader migration remains unproven**.
Implementation checkpoint: `eeed3af4b613d7a14e2821016038e7ee05508769`. This commit and
the prior handoff commit are not ancestors of current main.
This is the durable handoff if the coordinating session loses quota. Resume in the
absolute task worktree below, never in the root `main-sync` checkout. Do not recreate
the changes or harvest the separate active frame task.

Implemented files:

- `src/contexts/StoreContext.tsx`: only a current image/blank `NEW_LAYER_ACTION` may
  compose in the background, and only if the preceding active cursor prefix passes main's
  existing ownership and frame gates. The new entry keeps legacy navigation fallback.
  The actual app boot path starts with a blank `NEW_LAYER_ACTION`, which main's gate marks
  `ownership-unproven`; imported raster baselines are gated too. The exception therefore
  has no proven normal UI entry point yet. Do not relax the cursor gate to make it reachable.
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
not been shown reachable through the product UI. Keep the implementation bounded and mark
this product migration unproven until the history/ownership contract is deliberately resolved.

The boot path uses `REPLACE_DOCUMENT`, which builds the durable shadow and requests temporary
layer presentation but does not call `publishDurableAppendPresentation()`. That background
publisher is called for committed appends. Thus the initial blank source does not exercise the
positive append exception; later paste and Background commits encounter that source in their
prior active prefix and remain gated. The targeted browser spec confirms unpublished status and
legacy fallback while checking exact visible and exported pixels.

The focused Sol audit reached the same boundary: on ordinary active startup and raster-import
paths the positive exception is not reachable, and no fully proven narrow fix was identified.
Exempting only the initial blank bedrock remains a possible design question, but it requires
product-flow E2E plus cursor and asset-ownership proof under the authority plan. A disabled
startup entry was not investigated, so do not claim impossibility across every UI state.

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

1. The merge is committed with the expected parents and the task worktree is clean. Run
   `npm run repo:state`, regenerate inventory, then run `npm run branches:orphan`; inspect reports
   without resolving the unrelated active operation or disposing or modifying unrelated work.
2. Do not widen this create gate to force UI reachability. Continue with an unowned,
   independently provable source-backed family only after
   checking live ownership. The frame fractional-composite and import/replacement tasks
   remain with their active owners. Keep Slice 3 and Slice 4 unstarted until their explicit
   proof gates are met. Landing this branch onto main is a separate pinned procedure.

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
