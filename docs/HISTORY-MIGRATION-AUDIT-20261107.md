# Durable History Migration Audit — 2026-11-07

## Result

The migration has **not** drifted from its central architecture: legacy
`HistoryItem[]` and `replayHistory()` still own logical history, while durable replay supplies a
staged presentation with explicit fallback. The latest main merge does not perform an undo/redo
authority cutover or admit frame-changing commits.

The migration is not complete. Two gaps remain load-bearing for the next run:

1. The current per-layer parity allowance conflicts with the operator-designated plan's exact,
   no-tolerance acceptance rule.
2. The transformed-raster opacity/blend fixture has not yet pinned parity through runtime
   projection and the real PNG/PSD export adapters. Its reported 42/46 differing-channel counts are
   exploratory, not confirmed test results.

The latest main also contains important export fallbacks that close earlier concerns about hidden
PSD layers, replay/legacy layer-set coverage, metadata differences, and materialized bounds. Keep
those checks and regression tests as required gates.

## Audited revision and evidence boundary

This audit used the designated `refs/heads/main` worktree at
`659ca8ede3be5c4f05aa0d250d63d6f394964315`, tree `c40c91c261cd4d94c52587a92e6ec02c63335921`.
The merge's first parent is `b5df9dbc272e208dc04768259228e13abdad33fb`; its second parent is the
history-export candidate `e9debc96e8620c3494632aee74fad8753157b582`. Main was clean when inspected.

The audit traced the current export gate and its callers through `useFile.tsx`,
`durable-render-projection.ts`, `durable-compositor.ts`, `materialization.ts`, `export-canvas.ts`,
`psd-utils.ts`, and the export/projection tests. It also compared the tracked continuation plan with
the migration status docs and E2E assertions. No tests were rerun as part of this read-only code
audit. The validation counts in `HISTORY-MIGRATION-NEXT.md` are prior candidate evidence. The
candidate-to-landing delta was documentation-only, but this audit did not independently reproduce
those results.

## Open findings

### 1. Tight per-layer parity currently permits differences forbidden by the plan

The operator-designated continuation plan says Slice 2A requires exact tight per-layer raster
dimensions, bounds, alpha, and placement, with **no tolerance**. The current `crop-history.spec.ts`
instead permits up to two alpha-boundary pixel differences in both frame and tight-raster
comparisons. `HISTORY-MIGRATION.md` documents the same allowance. The tested composites remain
byte-identical, but that does not satisfy the plan's separate per-layer acceptance gate.

I found no `docs/OVERRIDES.md` entry that resolves this conflict. Under the stated rule that the
plan is the source of truth, treat the current allowance as an unresolved contract deviation. Do not
claim the affected Slice 2A per-layer gate is closed or use it to admit frame operations. The next
owner should require exact equality and investigate any differences. If the operator later chooses
to change that contract, update the canonical plan and status docs together and record the explicit
scope and rationale; do not treat a documented test tolerance as approval by itself.

Relevant evidence: `.kilo/plans/history-migration-continuation-20261027.md` (Slice 2A); the
`toBeLessThanOrEqual(2)` tight/frame assertions in `e2e/crop-history.spec.ts`; and the retained
affine/frame paragraphs in `docs/HISTORY-MIGRATION.md` and `docs/HISTORY-MIGRATION-NEXT.md`.

### 2. Opacity/blend parity through production presentation and export is unpinned

The transformed-raster fixture uses opacity `0.58` and blend mode `multiply`. The current E2E
evidence covers raw materialized pixels, premultiplied tight pixels, bounds, bitmap dimensions,
opacity/blend metadata, and the direct durable composite. The direct composite matches the legacy
composite for the fixture. However, the docs describe temporary diagnostics of 42 channel-byte
differences at the affine cursor and 46 after the fractional frame over an opaque backdrop in
runtime projection/export. Those counts are explicitly unverified: the committed fixture does not
assert `projectDurableRender()`, raster output through `renderExportCanvas()` and
`durableExportRecords()`, or the PSD layer and composite output for those same states.

The conservative gate currently refuses retained operations for runtime/export admission, so this
is an unresolved proof gap, not evidence that the current fallback displays a wrong result. Keep the
gate closed until the following single fixture proves the actual production surfaces:

1. Use the same `0.58`/`multiply` transformed raster at the affine cursor and after the fractional
   frame transition, with the same opaque backdrop in each comparison.
2. Compare legacy rendering, `projectDurableRender()`, PNG export using the real
   `durableExportRecords()` adapter, and PSD layer plus composite pixels. Compare raw source and
   materialized rasters, exact bounds/dimensions, alpha and premultiplication, logical metadata,
   then the composed pixels as distinct assertions.
3. Require exact bytes at every surface and cursor. Reproduce or correct the exploratory 42/46
   counts; do not use an isolated transparent multiply result as the output oracle.
4. Retain tests for composite release, per-layer lease release, and stale completion fallback. If a
   difference appears, localize it to materialization, retained-affine composition, runtime
   projection, or the standard export renderer before changing production behavior.

Only after this proof should a separate reviewed change consider admitting this retained-operation
subset to runtime or export. A passing direct compositor comparison alone is insufficient.

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
the corresponding regression tests; they are not open findings against `659ca8e`.

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

The status guide's validation and review record names candidate commit `04f95264` and its tree, and
the current-main drift section names the earlier `b5df9dbc` checkpoint. The landed merge is
`659ca8e`; this audit records that post-merge pin and distinguishes the unverified parity diagnostics
from test evidence. Future continuations should update the status/checkpoint when main advances,
while preserving older validation as dated provenance rather than presenting it as a new run.

## Recommended order for the next migration run

1. Start from the latest actual `refs/heads/main` worktree, regenerate the ownership/repo-state
   checks, and review the current plan and linked status. Do not use a stale `main-sync` checkout or
   an older main pin.
2. Resolve the exact-versus-two-pixel policy conflict in favor of the operator-designated plan.
   Tighten the per-layer assertion to exact equality and investigate failures; keep composites and
   per-layer checks separate. Do not publish frame-changing commits.
3. Complete the bounded transformed-raster opacity/blend proof across runtime projection, PNG, and
   PSD as described above. Keep all retained operations on legacy fallback until the proof passes.
4. Continue the broader fractional-frame/source matrix and source-backed import/replacement
   ownership as separate acceptance slices. Preserve the fixture-to-source-to-cursor coverage table
   and prove whole-document fallback for every unsupported case.
5. Only after those presentation/ownership gates close, plan a separate reviewed durable-first
   navigation/authority change and measure the real production replay path, cancellation, memory and
   final-draw rollback. Retire legacy authority only in that explicit architecture change.

## Validation status

The merged history-export candidate's status guide records focused export/projection tests, the E2E
unit suite, two focused Chrome E2Es, typecheck, build, lint, and `git diff --check` as passing on its
candidate. The recorded results are local-platform evidence. They include no Linux/Windows mirror
run and no independent Photoshop oracle. This audit was source-only and did not run or independently
reproduce those tests or the 42/46 diagnostics.
