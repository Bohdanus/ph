# ADR 0001: Sequence multi-document and rendering refactors

- Status: Proposed
- Date: 2026-11-27
- Baseline inspected: local `main` at `f8c2ebb44d9cdd53a09be6c31028538a6e8c9e19`
- Scope: preparation for multi-document support and future GPU filters while history migration is active

## Decision

Do not introduce a GPU backend, a second rendering authority, a global raster/residency manager, or a broad store rewrite during the current history migration. Preserve the existing shared presentation evaluator and the legacy logical history authority until the durable-history cutover has an explicit contract and its remaining gates are closed.

Treat multi-document support as a separate lifecycle design problem. Before adding tabs or simultaneous documents, define a `DocumentSession` boundary that owns history/cursor, frame, selection, dirty state, active layer, pending work, previews, view state, and document asset leases. The first implementation should preserve one active document and current replacement behavior; it should not add `selectedLayerIds` as a proxy for document isolation.

Revisit a render-backend seam only after a concrete second backend exists or a current caller needs it. A future seam must preserve current Canvas 2D allocation dimensions, filter refusal, bitmap ownership, stage-and-restore publication, and failure telemetry. Canvas 2D remains the reference until a measurable parity policy is approved separately for display, each layer, and export.

## Context and verified findings

The proposal was evaluated against the repository at the baseline above. The observations below are source-backed; broader proposal statements are not accepted merely because they appeared in the proposal.

1. **History authority is still staged.** `HistoryItem[]` plus `replayHistory()` remains the logical compatibility/navigation authority. Durable replay, materialization, and `durableRenderProjection` already publish user-visible results for gated subsets of navigation and append/reorder. Export has its own guarded projection. Therefore “durable is only an unused projection” is too strong, while “full authority cutover is incomplete” is accurate. See `HANDOFF.md` §1, `src/contexts/useHistory.ts`, and `src/contexts/StoreContext.tsx`.
2. **The evaluator is already shared.** `src/contexts/presentation-evaluator.ts` owns affine composition, vector-argument scaling, filter evaluation, and draw evaluation used by legacy rendering and durable materialization/composition. A second evaluator would add drift; the claimed duplicated affine/scaling work is stale.
3. **Parity evidence is fixture-specific.** Existing tests establish exact pixels for named fixtures, not every source, transform, blend, export, and platform combination. The reported 42-byte multiply/raster difference is a diagnostic from a refused adapter path; it does not establish a current production defect or a justified tolerance. Keep exact assertions where they are achievable and document any exception with its own measured oracle.
4. **No GPU backend or worker engine is present.** Runtime rendering is Canvas 2D, with `OffscreenCanvas` used in some paths. Asynchronous bitmap APIs do not establish worker execution. Export already has an independent full-resolution path. A sixth texture-size limit, LRU texture cache, context-loss recovery, or worker job protocol would be new product infrastructure, not a refactor of an existing backend.
5. **Budgets and asset ownership are scoped, not global.** Processor staging limits and import/export limits exist in different paths; asset leases/generations exist, but there is no unified memory budget/residency manager. Do not merge numeric ceilings until allocations and ownership are inventoried and a policy is chosen.
6. **Filters are not one generic registry today.** Tool processor metadata, retained layer operations, durable `apply-filter` history entries, and Canvas filter construction have separate responsibilities. Add a unified registry only with a concrete filter capability contract; keep inference outputs baked with provenance and never rerun inference during replay if that feature is introduced.
7. **Multi-document state is not isolated.** The app has one active document/layer. Replacement resets history, tool/preview/selection state and disposes outgoing assets. `selectedLayerIds` is absent and canvas selection is a different model. View state and import revision also include module-level state. An array of current store snapshots would not provide independent session lifecycle or stale-async isolation.
8. **The asserted live collisions/open operations were not established.** A board check found the cited renderer/evaluator paths free at that point. Repository-wide worktree diagnostics reported unrelated operation markers; those do not prove a current code collision or authorize repairing another worktree.

## Consequences

- History migration remains the immediate dependency; no parallel GPU or history authority is introduced.
- Multi-document planning must specify ownership and disposal before UI/session switching is implemented.
- Current Canvas 2D behavior and exact fixture assertions remain protected.
- Future backend and filter work will need separate parity, export, memory, cancellation, and replay contracts.
- This ADR does not approve an authority cutover, a pixel tolerance, new raster ceilings, or an AI inference feature.

## Research directions before implementation

1. **History contract:** list every user-visible consumer of legacy replay and durable projection; define authority for cursor movement, append/reorder, frame changes, previews, tool hydration, export, undo/redo, and failure rollback. Identify gates still required for each surface.
2. **Session boundary:** trace document creation/replacement/disposal, module-level view/import state, async import publication, pending operations, and asset lease release. Propose a single-document `DocumentSession` extraction with unchanged behavior and tests for replacement, stale completion, selection/history reset, and disposal.
3. **Rendering seam:** inventory surface creation/context acquisition and transactional publication callers. Only propose extraction where semantics are identical; otherwise keep distinct adapters. State what a render plan would contain without putting GPU state in durable history.
4. **Parity and export:** enumerate pixel comparisons by composite/per-layer/export, identify proven exact cases and gaps, and specify how a future approximate backend would be admitted without weakening current gates.
5. **Memory policy:** measure current raster allocations and simultaneous document/export peaks before choosing a global budget, tiling/proxy scheme, cache eviction rule, or context-loss policy.
6. **Filter lifecycle:** map existing processor/retained/durable filter representations. Specify versioning, deterministic replay, PSD bake behavior, and non-rerun AI provenance only when a concrete filter is scheduled.

## Reconsider this decision when

- The durable-history owner has published a current cutover contract and all required independent parity/admission gates pass; or
- a concrete multi-document feature is scheduled and its session lifecycle is specified; or
- a real second render backend is approved with a written parity/export/memory contract.
