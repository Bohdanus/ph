# Durable History Migration Audit — 2026-11-07

## Result

The migration has **not** drifted from its central architecture: legacy
`HistoryItem[]` and `replayHistory()` still own logical history, while durable replay supplies a
staged presentation with explicit fallback. The latest main merge does not perform an undo/redo
authority cutover or admit frame-changing commits.

The migration is not complete. This continuation replaces the prior frame and tight-raster
allowances with zero-difference assertions, as the operator-designated plan requires; those stricter
checks do not admit frame operations. The opacity/blend adapter proof remains open. Its 42/46
runtime/export/PNG differences were reproduced in a local-Chrome diagnostic that intentionally
invokes adapters the production admission gate refuses; they are not evidence of a current
product-output defect. The same diagnostic records separate PSD results and the refused-adapter
boundary. Keep retained operations on the legacy fallback until every affected surface has an exact
parity proof.

The latest main also contains important export fallbacks that close earlier concerns about hidden
PSD layers, replay/legacy layer-set coverage, metadata differences, and materialized bounds. Keep
those checks and regression tests as required gates.

## Audited revision and evidence boundary

The original source audit used the designated `refs/heads/main` worktree at
`659ca8ede3be5c4f05aa0d250d63d6f394964315`, tree `c40c91c261cd4d94c52587a92e6ec02c63335921`.
The merge's first parent is `b5df9dbc272e208dc04768259228e13abdad33fb`; its second parent is the
history-export candidate `e9debc96e8620c3494632aee74fad8753157b582`. Main later advanced to
`30e32ccf6efba0536525ac66a8e71e04a97889ab` through documentation-only audit updates; the history
implementation and export gate are unchanged from that baseline.

The audit traced the current export gate and its callers through `useFile.tsx`,
`durable-render-projection.ts`, `durable-compositor.ts`, `materialization.ts`, `export-canvas.ts`,
`psd-utils.ts`, and the export/projection tests. It also compared the tracked continuation plan with
the migration status docs and E2E assertions. No tests were rerun as part of this read-only code
audit. The validation counts in `HISTORY-MIGRATION-NEXT.md` are prior candidate evidence. The
candidate-to-landing delta was documentation-only, but this audit did not independently reproduce
those results.

## Open findings

### 1. The exact per-layer gate is fixed on the candidate branch

The operator-designated continuation plan says Slice 2A requires exact tight per-layer raster
dimensions, bounds, alpha, and placement, with **no tolerance**. At the original audit baseline,
`crop-history.spec.ts` allowed up to two alpha-boundary differences in frame and tight-raster
comparisons, and the status docs repeated that allowance. Commit `8c842c4fe` on the current
candidate replaces those budgets with exact zero assertions for the HTML and OffscreenCanvas frame
and tight-bitmap comparisons. This is a test-contract correction only; it does not change renderer
behavior or admit frame operations. Keep the assertions exact after landing and investigate any
future failure rather than adding a tolerance.

Relevant evidence: `.kilo/plans/history-migration-continuation-20261027.md` (Slice 2A), commit
`8c842c4fe`, and the corresponding assertion and status-doc updates in this candidate.

### 2. Refused adapter parity is diagnosed, but production admission remains unproven

The transformed-raster fixture uses opacity `0.58` and blend mode `multiply`. The current E2E
diagnostic covers raw materialized pixels, premultiplied tight pixels, bounds, bitmap dimensions,
opacity/blend metadata, direct durable composition, runtime projection, export canvas via
`durableExportRecords()`, decoded PNG, and PSD layer plus composite pixels. The direct materialization
and composite comparisons are exact. At both cursors, the production admission predicate refuses
the retained operations; the diagnostic verifies that refusal and reports adapter bytes that are
manually generated despite the refusal. They are not selected for product rendering or export.

On local Chrome, the refused adapter outputs differ by 42 channel bytes in runtime, export-canvas,
and decoded-PNG pixels at the affine cursor. The PSD composite and both layer rasters match there.
After the fractional frame, runtime, export-canvas, and decoded-PNG each differ by 46 bytes; the PSD
composite differs by 8 bytes, its background layer by 7, and its foreground layer by zero. These
results reproduce the diagnostic observations, but do not establish a product-output mismatch. The
root cause is unknown. `durable-compositor.ts` disables image smoothing on its composition path, so
filtering is not an established explanation. The fractional PSD background-layer difference needs
its own bounds and placement investigation.

Keep the gate closed and use the detailed isolation sequence in
`docs/HISTORY-MIGRATION-NEXT.md`: find the earliest differing intermediate surface with identical
frame, transform, clipping, layer order, backdrop, opacity and blend settings; capture pixel
coordinates, channel/alpha values, source and backdrop samples, and bounds; then vary opacity,
compositing mode, frame integrality, backdrop transparency, and direct-frame versus tight-bitmap
placement one at a time. For PSD, compare pre-encoding background rasters at equal integer bounds,
then decoded layer and composite output separately. Require zero differing bytes at runtime, PNG,
PSD layers, and PSD composite before a separate reviewed change considers admission. Preserve bitmap
lease and stale-completion fallback tests.

### 3. Cross-platform and broader source/frame parity remain open

The recorded validation is a local macOS/Chrome run. The current migration status explicitly says
that no Linux or Windows mirror was run. Browser differential tests compare this application's
renderers; they are not an independent Photoshop pixel oracle. Therefore the current results do not
establish cross-platform Canvas/OffscreenCanvas parity or Photoshop pixel parity.

The recovered fractional mixed-source fixture passes its exact assertions at the listed three
transitions in the tested browser environment. It does not explain the earlier `(5, 26)` observation,
prove other angles or source combinations, or close the broader frame matrix. Keep
`SET_DOCUMENT_FRAME_ACTION` out of durable publication until the complete accepted matrix has exact
per-layer and composite proof, with the plan's no-tolerance rule applied.

### 4. Source ownership and logical authority are still staged work

The verified image/blank create route requires the user to disable the default blank history row;
the default startup blank prefix and imported-raster baseline remain gated. Shape Tool creation is
characterized as a typed vector conversion but remains unpublished behind the ownership gate. Other
source-backed creates, imports/replacements, merge/replacement operations, and frame-changing
commits have not been promoted by these tests. Frame parity and source-backed ownership are
independent gates.

The later authority and performance slices are also unstarted: no durable-first undo/redo cutover,
no retirement of legacy `HistoryItem[]` readers, and no complete production replay cost, cancellation,
or safe-baseline acceptance study. Keep legacy replay authoritative until every supported producer
and presentation surface has explicit identity, coverage, freshness, ownership/lease, preview,
failure, rollback, and fallback evidence. Do not describe the migration as finished.

## Findings resolved in the latest main tree

These were real concerns during the follow-up branch and are now guarded in the landed tree. Keep
the corresponding regression tests; the implementation fixes were already present at `659ca8e` and
remain present at current main `30e32cc`.

- **Hidden PSD pixels:** the compositor materializes visible layers only. `useFile.tsx` now forces
  PSD export to use legacy records whenever durable replay contains a hidden layer. The test
  `keeps legacy PSD pixels for hidden layers absent from durable materialization` covers this path.
- **Replay/legacy layer-set coverage:** durable export admission requires an exact ID set, rejecting
  both missing replay layers and extra legacy layers. The regression test
  `keeps legacy export when the replay omits a legacy layer` covers PNG and PSD fallback for an
  extra legacy record. I found no separate test that makes durable replay contain an ID absent from
  the legacy record set; add that inverse case to keep both branches of the exact-set guard pinned.
- **Actual materialized bounds:** export first applies a conservative snapshot/metadata gate, then
  checks the bounds returned by composition against the legacy layer before selecting durable
  records. The regression test `keeps legacy export when materialized bounds differ from the legacy
layer` verifies fallback and release.
- **Metadata and retained operations:** unsupported source kinds, retained operations, and logical
  metadata mismatches remain outside the durable export gate. The adapter parity tests cover
  operation, opacity, and blend-mode refusal cases.
- **Freshness and resource cleanup:** after asynchronous composition, the handler rechecks durable
  status, cursor, document revision, and branch revision; refused/stale composites are released.
  Keep these checks when changing export admission.

The core rule behind these fixes is whole-document fallback: do not export a mixture of durable and
legacy layers when any layer lacks the exact proof required by that format.

## Documentation and handoff gaps

The Sol-authored continuation plan is tracked at
`.kilo/plans/history-migration-continuation-20261027.md`, but the current `Current continuation plan`
section in `docs/HISTORY-MIGRATION-NEXT.md` no longer links to it. This audit restores that link in
the restart guide. Keep the plan as the acceptance source; use the status guide and this audit as
current evidence, not as silent replacements for the plan.

The status guide retains the older validation record for implementation commit `04f95264` as dated
provenance. This follow-up records current main `30e32cc` and candidate commits `bd5f3d29f` and
`8c842c4fe`, distinguishing refused-adapter diagnostics from product-path evidence. Future
continuations should refresh the checkpoint when main advances while preserving older validation as
dated provenance rather than presenting it as a new run.

## Recommended order for the next migration run

1. Start from the latest actual `refs/heads/main` worktree, regenerate the ownership/repo-state
   checks, and review the current plan and linked status. Do not use a stale `main-sync` checkout or
   an older main pin.
2. Keep Slice 2A frame and tight-raster assertions at exact zero, with no tolerance, as required by
   the operator-designated plan. The current candidate corrects the prior two-pixel allowance; do
   not use that test-only correction to publish frame-changing commits.
3. Isolate the transformed-raster refused-adapter differences across runtime projection, PNG, and
   PSD as described above. Keep all retained operations on legacy fallback until every surface has
   exact parity and the admission proof passes.
4. Continue the broader fractional-frame/source matrix and source-backed import/replacement
   ownership as separate acceptance slices. Preserve the fixture-to-source-to-cursor coverage table
   and prove whole-document fallback for every unsupported case.
5. Only after those presentation/ownership gates close, plan a separate reviewed durable-first
   navigation/authority change and measure the real production replay path, cancellation, memory and
   final-draw rollback. Retire legacy authority only in that explicit architecture change.

## Validation status

Validation for the latest candidate is recorded in `docs/HISTORY-MIGRATION-NEXT.md`. Local Chrome
and typecheck/build/lint results are local-platform evidence only. No Linux/Windows mirror or
independent Photoshop oracle is recorded here. The original audit was source-only; the follow-up
diagnostic run reproduces the 42/46 adapter measurements while keeping their refused-adapter status
explicit.
