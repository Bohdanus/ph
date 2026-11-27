# Opus review prompt: multi-document and rendering refactors

You are reviewing an architecture decision for a Photoshop-like browser editor. Give an independent, evidence-led recommendation from the complete context below. **You do not need to read the repository.** Do not invent implementation details. If you believe a source claim is decisive and needs verification, you may inspect at most these three files, and no others:

1. `HANDOFF.md` §1
2. `src/contexts/StoreContext.tsx`
3. `src/hooks/useApp.ts`

Do not inspect reports, ignored diagnosis files, other docs, generated inventory, or worktree state. Do not edit code. Do not propose a rewrite. Return: (a) what to do now, (b) what to defer, (c) the smallest safe first refactor, (d) specific research/evidence needed before GPU or multi-document implementation, and (e) any corrections to this decision. Keep the answer concise and distinguish facts from assumptions.

## Context

The current baseline is local `main` at `f8c2ebb44d9cdd53a09be6c31028538a6e8c9e19` (2026-11-27). The editor uses Canvas 2D and CPU tool processors. There is no production WebGL/WebGPU backend or worker execution. `OffscreenCanvas` and async bitmap APIs exist but do not imply workers. Export already has a separate full-resolution rendering path.

History migration is active and incomplete. Legacy `HistoryItem[]` plus `replayHistory()` remains the logical compatibility/navigation authority. Durable replay/materialization publishes user-visible results for gated subsets of navigation and append/reorder; export has a separate guarded projection. The durable path is not wholly unused, and it is not a full authority cutover.

`presentation-evaluator.ts` is already shared by legacy rendering and durable materialization/composition. It owns affine composition, vector argument scaling, filter evaluation, and draw evaluation. Do not assume those calculations are duplicated or fork this evaluator without evidence.

Exact pixel equality is proven only for particular fixtures, not every source, transform, blend, platform, or export. A reported 42-byte multiply/raster difference was a diagnostic from a refused adapter path; its cause is unknown and it is not proof of a current production defect. Keep exact assertions where they are achievable. No tolerance is authorized by this context.

The repository has processor staging limits, import/export limits, and per-document asset leases/generations. There is no unified raster budget, GPU texture cache, LRU eviction policy, or context-loss handling. Numeric ceilings differ by operation and should not be unified without measuring actual allocations and defining a policy.

Filter concepts are split among tool processor metadata, retained layer operations, durable `apply-filter` entries, and Canvas filter construction. A generic `FilterRegistry` is not an established abstraction. If AI inference is later added, outputs should be baked with provenance and replay must not rerun inference; that is a future requirement, not current infrastructure.

The app currently has one active document and one active layer. `selectedLayerIds` is absent; canvas selection is separate. Replacing a document resets history/tool/preview/selection state and disposes outgoing assets. View state and import revision include module-level state. Thus multi-document support needs an explicit session lifecycle for history/cursor, frame, selection, dirty state, active layer, pending async work, previews, view state, and asset leases. Adding a list of store snapshots or `selectedLayerIds` alone does not establish isolation.

The proposal claimed simultaneous file collisions and three open Git operations. Current evidence did not establish those claims: the cited renderer/evaluator files were reported free by a board check, while unrelated worktree operation markers existed elsewhere. Treat both claims as unverified unless your permitted source review finds direct evidence.

## Decision under review

Defer a GPU backend, second rendering authority, global memory/residency manager, generic filter registry, and broad store rewrite. Preserve the shared presentation evaluator and legacy logical history authority until the durable cutover contract and its independent gates are explicit. Treat a `DocumentSession` boundary as prerequisite research for multi-document work, preserving the current single-document behavior first. Revisit a render-backend seam only when a concrete second backend or caller justifies one; it must preserve current allocation, fallback, filter-refusal, bitmap ownership, stage-and-restore publication, and failure-reporting semantics. Canvas 2D remains the reference; no pixel tolerance is approved.

## Questions

1. Is that sequencing sound given the active history migration?
2. Is a single-document `DocumentSession` extraction the right first refactor, or is even that premature? Name its smallest safe boundary.
3. What evidence should be required before multi-document switching, GPU filters, or approximate parity is admitted?
4. Which claims above are weak or need correction? Do not turn unverified proposal claims into facts.
