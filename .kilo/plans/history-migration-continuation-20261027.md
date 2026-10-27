# Continue durable history from current main

## Restart checkpoint: preserve this work first

Status: **unproven implementation awaiting the documentation-index follow-up, final gates and landing**.
This is the durable handoff if the coordinating session loses quota. Resume in the
absolute task worktree below, never in the root `main-sync` checkout. Do not recreate
the changes or harvest the separate active frame task.

Implemented files:

- `src/contexts/StoreContext.tsx`: only image/blank `NEW_LAYER_ACTION` entries gain
  background durable presentation eligibility. Both the fast append and reconversion
  paths retain existing transaction, freshness, renderer compatibility and whole-document
  coverage gates. Tool-source creates, merge, source replacement and frame commits stay gated.
- `src/contexts/__tests__/StoreContext.source-backed-presentation.test.tsx`: six
  tests cover image/blank success, ownership-before-composition, borrowed input lifetime,
  exactly-once lease disposal, stale document replacement, incomplete materialization,
  tool-source refusal and finalization failure without a duplicate logical append.
- `e2e/source-backed-history.spec.ts`: actual paste and Background conversion. Paste
  uses a deterministic page-local clipboard reader, preserving the host clipboard.
  The oracle specifies an opaque white 800x600 document and a centered 32x24 red/blue
  source independently; it checks immediate durable publication, undo/redo pixel identity,
  exact PSD composite and layer pixels, and exact native-resolution PNG pixels.
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
- First full unit run: **11417 passed, 219 expected failures, six failures**.
  One was the old global no-bitmap-allocation assertion, now fixed as described above.
  Five were installation checks because `npm ci --ignore-scripts` had not installed
  the worktree-local compiler guard. `node scripts/install-tsc-guard.mjs` installed
  that existing guard; the targeted guard suite subsequently passed. No guard was weakened.
- The second full run passed **11422 tests**, with 219 established expected failures;
  its only failure was the documentation index not yet naming this newly staged plan.
  The index now links this plan. Verify `scripts/__tests__/docs-index.test.mjs` before
  claiming the complete final gate; production and lifecycle tests passed in that full run.
- Two independent read-only completion reviews through verified-free
  `kilo/poolside/laguna-s-2.1:free` completed with `finish_reason=stop`, zero reported
  cost and `NO_BLOCKING_FINDINGS`: ownership/publication and eligibility/browser proof.
  A follow-up of the lifecycle assertion also found no blocking issue; its speculative
  suggestion to copy an editable raster is contrary to the existing immutable-input contract.
  These were completion reviews of supplied code, not tool-using agents.

Open checks and next commands, in order:

1. Verify the documentation-index follow-up; any further full-suite rerun uses
   `node scripts/quiet-command.mjs npm run test -- --silent`. Do not run the inventory
   concurrently with the full suite: its worktree integration tests temporarily change
   the roster. Full runs took 112-130 seconds. Expected failures are established
   harness limitations, not permission to add new ones.
2. Regenerate the fresh repository inventory and orphan report after tests stop. The
   first inventory refused its snapshot because the roster changed while the full
   suite was running; that is not evidence of metadata corruption. The command writes
   `/tmp/ph-history-migration-inventory.txt` and `/tmp/ph-history-migration-orphans.txt`.
   Check its exit status. Inspect this task and main plus all reported operations/owners;
   leave unrelated live worktrees and orphan branches untouched.
3. Recheck formatting, lint, types/build and the E2E files after any substantive fix.
   Stage only the listed owned files. This plan is inside ignored `.kilo/plans/`, so it
   needs explicit `git add -f`; the other new tests use ordinary explicit `git add`.
   The current staged snapshot predates the latest lifecycle/ESLint/checkpoint edits;
   restage owned paths after inspecting staged and unstaged diffs.
4. Commit with native trailer `Chat: 01a17f24-9224-7aa0-a412-3afafa09f797`.
   Let the normal lint-staged/type/build gates run. Never bypass hooks or use stash.
5. Read live `main`; if it advanced, sync that exact SHA into this task branch with
   `--no-commit --no-ff`, resolve only here, and validate/review the resulting composition.
   If main is still the baseline ancestor, there is no new composition to resolve.
6. Follow `docs/ORCHESTRATION.md` and `.skills/worktree-merge-harvest.md`'s pinned
   landing procedure. Verify mappings before every Git mutation. Pin both parents,
   source branch, reviewed tree and native chat; require clean main and task checkouts.
   Prepare `git merge --no-commit --no-ff <reviewed-full-sha>` in the designated main
   worktree, then use `scripts/commit-reviewed-landing.mjs` with all `KILO_EXPECTED_*`
   pins. Do not resolve a main conflict or alter another session's files.
7. Record the final commit, passing evidence and remaining unproven migration slices
   here or in the swarm record, resolve/release this task's claims, and keep the
   checkpoint available. No worktree deletion or cleanup sweep is authorized by this task.

Coordination: swarm issue **`ph-12`**, owned by this task branch, holds the production
StoreContext path, new tests, lifecycle test and migration docs. Refresh/check live
claims before continuing. The frame task owns `materialization.ts` and its affine
E2E file; this slice does not edit them or `e2e/OPEN_PROBLEMS.md`.

Provider state: the long second-review attempt timed out three Kilo candidates and
received OpenRouter **429**; do not retry OpenRouter in this run. OpenCode CLI was
absent. A shorter, independent Kilo-only completion then succeeded with a 45-second
timeout and no paid fallback. Review output files are under `/tmp/ph-history-migration-*review*`;
the accepted findings are recorded above so their loss does not erase the handoff.

## Goal and baseline

Move toward one durable logical replay authority through independently proven slices.
Preserve editable source arguments, exact history labels, atomic whole-document publication,
selection baselines, explicit rasterization consent, and desktop/tablet behavior.

Owner: Codex session `01a17f24-9224-7aa0-a412-3afafa09f797`, branch
`docs/history-migration-plan-20261027`, worktree
`/Users/bkalynovskyi/ph/.kilo/worktrees/history-migration-plan-20261027`.

Baseline: actual `refs/heads/main` at `eaeb1734a03cccfd1e8886a326cc7ae9236409d3`,
checked out in `main-restored-20261024`. The workspace root is `main-sync` and is
not the baseline. `repo:state` reported no operations in progress. Recheck both facts
before each implementation slice and landing.

Current source confirms that `HistoryItem[]` and `replayHistory()` remain logical
authority. Durable navigation and eligible append/reorder stage presentation;
raster/PSD export use their guarded durable adapter. `durablePresentationMismatch()`
admits only raster, blank, and vector sources without retained operations and with
matching bounds. A current durable conversion alone does not prove presentation.

`7cf69dca` is outside this baseline. It changes final composite drawing, not tight
per-layer/export materialization. The separate `resolve-frame-control-raster-delta-20261027`
worktree has active uncommitted materialization and frame-parity work. Preserve that
owner's files and obtain a reviewed, pinned candidate before considering integration.
The previous review-closeout branch is already an ancestor of this main; its old
landing warning must not be reused as a current blocker.

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

Proof:

- Register image assets under the current document before composing; retain borrowed
  legacy source ownership and independent disposable materialization leases.
- Reject stale work after document replacement; release abandoned leases exactly once.
- Reject incomplete materialization for the whole publication while retaining the
  committed legacy layer, timeline, and input asset.
- Do not compose after asset finalization failure or for tool-source creates.
- Exercise actual paste and Background conversion, durable publication, exact undo/redo
  pixels, native-resolution PNG export, and PSD composite plus layer pixels.
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

Broader migration: **unproven**. Slices 2A through 4 require the evidence above; Slice 1
must have its final review and landing recorded before it is treated as released.
