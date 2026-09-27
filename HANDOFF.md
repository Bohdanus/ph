# HANDOFF

Open problems in the history/presentation work. Every item below was re-verified against the
working tree on 2026-09-27; claims that did not survive verification were dropped rather than
softened. Re-read line numbers before editing — this file is a snapshot, not a live view.

**Scope:** the durable-replay migration and the presentation/append boundary. Tool features and
visual fidelity are out of scope unless a defect is caused by this work.

---

## 0. Branch state — read before the problem list

`main` is `eb2160e`, **10 commits ahead of `origin/main`, unpushed.** `git status` is clean apart
from this file.

**`fix/unit-tests` is `b027de3` (+ `5da9f82`), 2 commits ahead of `main`, unmerged.** It is 10
files, +802/−111, of which 5 are production: `StoreContext.tsx` (74), `layer-presentation.ts` (79),
`history-adapter.ts` (63), `history-append.ts` (23), `layer-utils.ts` (function removed).

Merge it first. It closes the following items in this file, all of which are open on `main` today:

| Item in this file                                                               | Fixed by `b027de3` | How                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **18** refused publication dropped with `console.debug`                         | yes                | `console.error` with a message that names the invariant violation                                                                                                                                                                                                  |
| **17** duplicate durable entry id has no second line of defence                 | yes                | `publishedEntryIds: Set<string>` in `history-adapter.ts`; the offending entry is _skipped_ and the diagnostic is `error`, not `warning`                                                                                                                            |
| **16** invalid document frame converts with no diagnostic                       | yes                | the `SET_DOCUMENT_FRAME_ACTION` branch gained an `else` that pushes a `warning` / `invalid-history-entry` diagnostic                                                                                                                                               |
| **7** presentation bitmaps never released on layer delete                       | yes                | new `retireDepartedLayers(before, after)` in `StoreContext.tsx`, driven off the layer set-difference, never off `deletedLayers`; runs on both the commit and the replay path, and retires the _current_ layer's bitmap so a borrowed raster is never double-closed |
| **21** (old 4) `saveLayerCanvas` is dead in production                          | yes                | the function is deleted, along with the `materializePresentationBitmap` import that `tsconfig.app.json:27` (`noUnusedLocals`) would otherwise reject                                                                                                               |
| **22** (old 5) the comment justifying the discarded append diagnostics is false | yes                | `useLayer.ts:563-567` rewritten to state the current single-writer contract and cross-reference `history-append.ts` for the "reporting never blocks the append" invariant                                                                                          |

**After merging, delete items 7, 16, 17, 18, 21, 22 from this file and re-derive the rest.** Do not
work them from this document.

Item 22 has a second instance that `b027de3` also fixes, and that this file never listed:
`src/contexts/history-append.ts:19-25` carries the same false claim —

> _"Phase 1 status: plan only. The durable entry is derived at the append point but is not published.
> `StoreContext` still converts the whole timeline into the diagnostic shadow, so publishing the
> planned entry here would create a second writer for a single append."_

`de91a83` (09-27 10:12) invalidated it; `StoreContext.tsx:647-666` publishes the planned entry
through `decideDurableAppend`.

---

## 1. P0 — the durable replay path has no production caller

**Problem.** Four of the five modules the migration was built around are imported by nothing outside
`src/contexts/__tests__/`:

| module                               | non-test importing files              |
| ------------------------------------ | ------------------------------------- |
| `src/contexts/materialization.ts`    | **0**                                 |
| `src/contexts/replay-coordinator.ts` | **0**                                 |
| `src/contexts/replay-checkpoints.ts` | **0**                                 |
| `src/contexts/durable-replay.ts`     | 1 — `materialization.ts`, itself dead |

Production still runs legacy `HistoryItem[]` → `replayHistory` (`useHistory.ts:90`) → runtime
`Layer` → `layer-renderer.ts:60-141` → canvas. `durableDocument`, `durableStatus` and
`durableDiagnostics` are computed at `StoreContext.tsx:686-786` and read by nothing outside that
file. `StoreContext.durable-boundary.test.tsx:602-633` actively pins the absence — it asserts that
`replayCoordinator`, `presentationMaterialization` and `getReplayRevisionToken` are _not_ in the
store. The suite is green and is enforcing the absence of the feature.

**Why it matters.** Every correctness property the durable model was built to provide — validated
conversion, diagnosable failure, deterministic asset ownership — currently protects no
user-visible behaviour. The migration's deliverable is unwired.

**Trap for whoever wires it.** Two independent affine/filter composers exist.
`materialization.ts:102-138` duplicates `getLayerAffineTransform` and `scaleVectorArgs` from
`affine-transform.ts`, violating the "never independently approximate in different files" rule.
`materializeLayer` / `materializeDocument` have zero callers, so the first wiring attempt is the
first time that code executes against real state.

**Also wrong at the boundary.** The runtime path feeds an _untransformed_ bitmap to a pixel
processor (`useLayer.ts:516-536`); the durable path materializes the retained presentation first
(`materialization.ts:263-269`). Wiring the durable path without reconciling these changes pixel-tool
results.

**Fix.** Pick one rendering authority and make the other a projection. Minimum viable: route the
render path through `materializeLayer` for a single layer type, keep `layer-renderer.ts` for the
rest, and delete the duplicated composer. Do not attempt all five consumers at once.

**Files.** `src/contexts/materialization.ts`, `src/contexts/layer-renderer.ts`,
`src/contexts/StoreContext.tsx`

---

## 2. P0 — the single-writer append path is defeated by `durableStatus` staleness

**Problem.** `de91a83` is the only real single-writer slice: `applyDocumentCrop` hands its planned
durable entry to `COMMIT_DOCUMENT_EDIT`, and the store publishes it instead of reconverting the
timeline — _but only when the durable document still describes exactly the timeline the plan was
made against._

That precondition is almost never true in real use, because of a three-link chain:

1. `StoreContext.tsx:654` — `base: currentState.durableStatus === 'current' ? currentState.durableDocument : null`
2. The reducer sets `durableStatus: 'stale'` for roughly twenty action types, including
   `SET_ACTIVE_LAYER` (`:327`), `SET_TOOL_NAME` (`:314`), `SET_TOOL_DIRTY` (`:316`),
   `SET_COLOR` (`:451`), `SET_BACKGROUND_COLOR` (`:453`), and every selection action
   (`SET_SELECTIONS` `:457` through `CLEAR_SELECTIONS` `:509`, including `ADD_SELECTION`,
   `COMMIT_SELECTION`, `UPDATE_SELECTION`, `MOVE_SELECTION`, `SET_ACTIVE_SELECTION`,
   `START_SELECTION_DRAFT`, `CANCEL_SELECTION_DRAFT`, `SET_SELECTION_CLIPBOARD`,
   `MARK_SELECTION_COPIED`).
3. `history-append.ts:221` — `if (!base) return { outcome: 'preconditions', reason: 'the durable document is unavailable' }`, which falls back to full reconversion **silently**.

`durableStatus` only returns to `'current'` via a successful conversion (`:456`, from
`converted.status`) or an explicit `SET_DURABLE_STATUS`. So:

> **Two consecutive crops publish. A crop after any layer click, tool switch, colour change, or
> selection action silently reconverts the entire timeline.**

Nothing surfaces the difference. `durable-append-mismatch` is only emitted on the `mismatch`
outcome; `preconditions` is by design a silent fallback, and the boundary's own diagnostics are
discarded at the only call site (`useLayer.ts:568-576`).

The tests miss it because they exercise the published path through `UPDATE_LAYERS`, which has no
production caller (item 14).

**Fix.** Do **not** weaken the gate — it is what makes publishing safe. Decouple the two concerns
that one status field is conflating: a _selection_ is not a reason to invalidate the _durable
document_. Either narrow what sets `stale` to actions that actually change durable state, or split
the status into document-validity and append-readiness. Then add a test that publishes after an
intervening `SET_ACTIVE_LAYER`.

**Files.** `src/contexts/StoreContext.tsx`, `src/contexts/history-append.ts`,
`src/contexts/useLayer.ts`, `src/contexts/__tests__/StoreContext.durable-append.test.tsx`

---

## 3. P0 — interleaved affine and filter operations are grouped by type

**Problem.** `materialization.ts`'s product rule groups operations by kind rather than applying them
in timeline order, so a filter applied between two affines is hoisted. Raster processors are now
genuine segment boundaries (`materialization.ts:257-284`), so this is **half-fixed**:
_inter-intra-segment_ interleaving is still grouped.

`materialization.ordering.test.ts:415` is `it.fails('applies interleaved affine and filter
operations in original order, not grouped by type')`. The pin is a tripwire — it fails the moment
the defect is fixed.

Both the durable-replay handoff and the consolidated handoff gate Phase 3 on this. It is also a
correctness bug in the shared pipeline, so it blocks item 1 as well as the phase gate.

**Fix.** Make `renderRetainedSegment` a fold over the operation list in order, keeping the
raster-processor boundary but not reordering within a segment. Remove the `it.fails` in the same
change.

**Files.** `src/contexts/materialization.ts`,
`src/contexts/__tests__/materialization.ordering.test.ts`

---

## 4. P0 — one error diagnostic voids the entire durable shadow

**Problem.** `convertLegacyHistorySafely` (`history-adapter.ts:561`) checks
`converted.diagnostics.some((d) => d.severity === 'error')` at `:573` and, if any one entry
produced an error, rolls back the asset transaction and returns `status: 'unavailable'` with
`document: null`.

Fail-closed is the right instinct, but this is fail-closed far too coarsely to be usable: a single
unsupported pen or curve history entry discards a correctly-computed document _and_ a correct
cursor map for the whole timeline. The cursor map in particular is the part that is hard to
recompute, and it is thrown away for a problem local to one entry.

**Fix.** Partition diagnostics. Entries that convert cleanly should produce a document with those
entries omitted and a per-entry `error` diagnostic naming the `historyId`; only a failure that makes
the document structurally invalid (frame mismatch, branch/cursor inconsistency, thrown conversion)
should return `unavailable`. `b027de3` already establishes the vocabulary for this — it skips the
offending entry rather than failing the conversion — so the pattern exists; apply it to the
severity check too.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/StoreContext.tsx`

---

## 5. P0 — no error boundary exists anywhere

**Problem.** Zero occurrences of `componentDidCatch` or any `ErrorBoundary` component in `src/`.
A throw inside the store dispatcher, a tool processor, or a canvas context failure takes the whole
editor down with a blank screen and no recovery.

This is the one Phase 0 item that is entirely undone, and it is the control that would have
contained the `2f051a0`-class regressions (68 files, +4767/−2218 in one commit, including a
subagent that modified `StoreContext.tsx` against an explicit "tests only" instruction).

**Fix.** Add a top-level `ErrorBoundary` around the canvas/editor subtree, plus one around the
sidebar. Surface the durable diagnostic codes (`unsupported-history-feature`,
`durable-append-mismatch`, `conversion-failed`) in the boundary's fallback UI so the fail-closed
paths become observable instead of silent.

**Files.** `src/App.tsx`, `src/components/**` (new boundary component)

---

## 6. P0 — `StoreContext` has two implementations of every commit transition

**Problem.** The dispatcher fast-paths bypasses the reducer and hand-builds
`latestStateRef.current`, because the reducer must stay a pure transition. But the hand-built copy
omits `hasUnsavedChanges: true`, which the reducer sets in four branches
(`StoreContext.tsx:342`, `:353`, `:406`, `:429`).

Two writers for the same state transition will disagree. This one disagrees today, with no
symptom, because nothing reads the flag on those paths. It is the same class of bug as
`PUBLISH_DURABLE_REPLAY` (added `323d664`, deleted `2f051a0`): a second, parallel state path that
looks correct in isolation.

`UPDATE_LAYERS` (item 14) is the same shape: a public action with a hand-written reducer branch
and zero production callers.

**Fix.** Extract the shared post-commit projection into one function that both the reducer and the
dispatcher call, so the flag cannot be forgotten. If that is not feasible, assert the equivalence
in a test that dispatches through the hook and compares against the reducer result.

**Files.** `src/contexts/StoreContext.tsx`

---

## 7. Presentation bitmaps are never released when a layer is deleted

> **Fixed on `fix/unit-tests` (`b027de3`).** Listed here because it is open on `main`; delete this
> item after the merge. Full analysis preserved in §0.

**Problem.** `DocumentPresentationScope` (`src/contexts/layer-presentation.ts:133`) keeps every
bitmap it publishes in `published: Map<documentId, Set<BitmapSource>>`. `retire()` has exactly one
call site — `src/contexts/StoreContext.tsx:622` — and fires only for the bitmap a promotion
_replaces_. Layer removal (`src/contexts/useLayer.ts:380-411` → `COMMIT_DOCUMENT_EDIT` →
`src/contexts/StoreContext.tsx:638-707`) never calls it; the `deletedLayers` record it keeps
(`src/contexts/useLayer.ts:385`) nulls both caches, so the store drops the only other reference and
the scope's `Set` becomes the sole owner. Nothing ever closes it.

The retention is unbounded per document. A stranded bitmap can never be reclaimed by a later
promotion, because `superseded` is built from the _current_ layer's bitmap
(`src/contexts/StoreContext.tsx:607`) and a promotion naming a deleted layer is refused at `:605`
(whose bitmap is then closed at `:610`). N add → promote → delete cycles on one document strand N
full-raster `ImageBitmap`s — a 4000×3000 RGBA bitmap is roughly 48 MB.

This is a net regression against `origin/main`, where `saveLayerCanvas` assigned `layer.bitmap` in
place with no registry, so a removed layer's bitmap simply became unreachable and was
GC-reclaimed.

**Fix.** Retire on layer removal, driven off the layer set-difference rather than off
`deletedLayers`, and assert `close()` is called for a deleted layer's published bitmap.

**Files.** `src/contexts/layer-presentation.ts`, `src/contexts/StoreContext.tsx`,
`src/contexts/useLayer.ts`

---

## 8. The save/merge path bypasses the presentation scope entirely

**Problem.** `useLayer.ts:593` calls `createImageBitmap(canvasRef.current)` bare — no scope
tracking, no lease, no `retire()` candidate. Every save and every flatten therefore creates a
bitmap that the scope never learns about, so the scope's completeness guarantee (item 7) does not
cover them even once item 7 is fixed.

This also falsifies handoff 08 §4.6's claim that "nothing else assumes the global exists."

Related: `psd-utils.ts` has no `lease`, `release` or `dispose` call at all, so PSD export holds
materialization leases for the duration of the export and never returns them.

**Fix.** Route both through the same registration path the promotion path uses, so every published
bitmap has an owner. Add the lease release to `savePsd`'s teardown.

**Files.** `src/contexts/useLayer.ts`, `src/contexts/psd-utils.ts`,
`src/contexts/layer-presentation.ts`

---

## 9. Durable diagnostics and status have no reader in the UI

**Problem.** `durableDiagnostics` and `durableStatus` appear in `src/**/*.tsx` only inside
`StoreContext.durable-boundary.test.tsx`. No component reads them, and there is no feature-flag
mechanism anywhere in `src/`.

So handoff 08's claim that the shadow is "the only durable signal the UI reports" is unsupported:
an `error`-severity `durable-append-mismatch`, an `unsupported-history-feature`, or a
`conversion-failed` is computed, stored, and never shown. Every fail-closed path in the migration
is silent to the user.

**Fix.** Surface diagnostics in a dev-only status strip, or at minimum in the error boundary from
item 5. Without a reader, the diagnostic contract is untestable in practice.

**Files.** `src/contexts/StoreContext.tsx`, a component under `src/components/**`

---

## 10. `ReplayRevisionToken` cannot be invalidated by a frame change

**Problem.** `ReplayRevisionToken` (`replay-coordinator.ts:1-10`) carries `documentId`,
`documentRevision`, `durableRevision`, `branchRevision`, `cursor`, `baselineAssetGeneration`,
`operationSetRevision`, `sourceGeneration`. There is no `frameRevision`, so a document-frame change
cannot invalidate a token. `DurableLayerSnapshot` likewise has no `frame` field, which contradicts
the consolidated handoff's own drift note.

`isCurrent` was already hardened to fail closed (it no longer trusts a self-check), so the guard
works — it is the token's _inputs_ that are incomplete. An in-flight durable replay can complete
against a document whose frame has since changed.

Latent only while nothing schedules replays (item 1), but it is a required input for item 1.

**Fix.** Add `frameRevision` to the token and `frame` to `DurableLayerSnapshot`, and bump
`documentRevision` on every frame change so the existing comparison covers it.

**Files.** `src/contexts/replay-coordinator.ts`, `src/contexts/history-model.ts`

---

## 11. `materialization.ts` does not apply `blendMode`

**Problem.** `materialization.ts:155` sets `ctx.globalAlpha = source.opacity`, but there is no
`blendMode` / `globalCompositeOperation` anywhere in `materialization.ts` or `durable-replay.ts`.
Only the legacy renderer applies it (`layer-renderer.ts:96`).

So the moment `materialization.ts` becomes the render path (item 1), every layer with a non-normal
blend mode renders incorrectly. The durable snapshot carries the field; the pipeline drops it.

**Fix.** Apply `snapshot.blendMode` in `materialization.ts` alongside the existing `globalAlpha`,
and add a test that a multiply-blended layer materializes differently from a normal one.

**Files.** `src/contexts/materialization.ts`, `src/contexts/history-model.ts`

---

## 12. `rasterize-layer` has no writer anywhere

**Problem.** The operation kind is declared (`history-model.ts:107`), matched in the clone path
(`:166`, `:250`) and in replay (`durable-replay.ts:122`), and exercised by four test files — but no
production code ever constructs one. `grep -rn "rasterize-layer" src` returns only the model, the
replay reducer, and tests.

A declared-and-tested operation with no producer is either a missing feature or dead design. It
also inflates the apparent completeness of the durable model.

**Fix.** Decide: if rasterize-on-commit is wanted, implement the writer through the append boundary
(`history-append.ts` currently returns `unsupported-history-feature` for it). If not, delete the
kind and its four test blocks.

**Files.** `src/contexts/history-model.ts`, `src/contexts/durable-replay.ts`,
`src/contexts/history-append.ts`

---

## 13. `UPDATE_LAYERS` is an unguarded escape hatch with zero callers

**Problem.** `UPDATE_LAYERS` is in the public `Action` union (`StoreContext.tsx:144`) with a
hand-written reducer branch (`:344-354`) that sets `hasUnsavedChanges: true` and
`durableStatus: 'stale'`. It has **no production caller**, and it has no
`layersDifferOnlyByPresentation` guard — which is exactly the guard that was added for
`PUBLISH_RUNTIME_PRESENTATION` at `layer-presentation.ts:96-112`.

So the store exposes two ways to set layers, one guarded and one not, and the unguarded one is
test-only. It is also what the append tests use to reach the published path, which is why item 2
went unnoticed.

**Fix.** Delete `UPDATE_LAYERS`. If a test needs to move layers, dispatch
`COMMIT_DOCUMENT_EDIT` with the same shape production uses — that also fixes the test fidelity in
item 2.

**Files.** `src/contexts/StoreContext.tsx`, `src/contexts/__tests__/**`

---

## 14. `addHistoryEntry` is a second writer surface on the public context

**Problem.** `useHistory.ts:51` defines `addHistoryEntry` and `:166` returns it on the hook's
context value. No production code consumes it — the only callers are
`src/contexts/__tests__/useHistory.test.tsx:304` and `:322`.

It is dead in production but live as an _interface_: any component can append a `HistoryItem`
through a path that does not go through `COMMIT_DOCUMENT_EDIT`, so it bypasses the append boundary,
the durable publication, and the `hasUnsavedChanges`/dispatcher equivalence of item 6.

**Fix.** Remove it from the returned context object. If a second writer is genuinely needed, route
it through `COMMIT_DOCUMENT_EDIT` so it participates in the single-writer contract.

**Files.** `src/contexts/useHistory.ts`, `src/contexts/__tests__/useHistory.test.tsx`

---

## 15. 12 of the 13 live history writers still reconvert the whole timeline

**Problem.** The Phase 1 boundary (`history-append.ts`) is wired for exactly one action,
`set-document-frame`. `planHistoryAppend` returns an `unsupported-history-feature` diagnostic for
every other action, and every non-frame `COMMIT_DOCUMENT_EDIT` therefore calls
`buildDurableDocument` on the whole timeline (`StoreContext.tsx:667-678`).

Derived writer inventory on `main`:

- 14 history-appending dispatch sites, 13 with production callers
- 1 boundary-ready (`applyDocumentCrop`)
- 15 converted by adapter only (real durable operations, full reconversion per append)
- 2 legacy-only (`addHistoryEntry`, `APPLY_HISTORY_REPLAY`)
- 6 writers the plan's inventory omits: `SET_ACTIVE_LAYER`, `COMMIT_SELECTION`, `CLEAR_SELECTIONS`,
  `UPDATE_SELECTION`, `MARK_SELECTION_COPIED`, `SET_DURABLE_STATUS`

The next slices are already named in the readiness docs: `set-layer-properties` and
`reorder-layers`.

**Fix.** Convert one writer at a time, smallest first (`set-layer-properties`). Keep the
`published` / `preconditions` / `mismatch` three-way decision — do not collapse it to a boolean.

**Files.** `src/contexts/history-append.ts`, `src/contexts/StoreContext.tsx`

---

## 16. An invalid document frame converts with no diagnostic

> **Fixed on `fix/unit-tests` (`b027de3`).** Open on `main`; delete after the merge. See §0.

**Problem.** `deriveSetDocumentFrameEntry` (`history-adapter.ts:271`) returns `null` when
`!isValidDocumentFrame(args?.nextFrame)`. In `legacyHistoryToDurable` the frame branch
(`:501-506`) cannot throw, and `diagnostics.push` exists only in the `catch`, so no entry is
pushed and no diagnostic is recorded. `convertLegacyHistorySafely` then commits and returns
`status: 'current'` — the shadow asserts a faithful conversion while silently omitting a
document-frame change.

On the append path the omission is also undiagnosed: a null planned entry yields
`outcome: 'preconditions'` (`history-append.ts:220`), not `'mismatch'`, so no
`durable-append-mismatch` is appended either. The boundary does warn (`history-append.ts:96-98`)
but `useLayer.ts:568-576` discards it.

Two clarifications that bound the severity, both verified: the tightening is **correct**
(`history-replay.ts:96-102` has always used the identical predicate; `durable-replay.ts:129-131`
has no validation at all, so the change removes a shadow/legacy divergence rather than creating
one), and the repeated cursor index is **not** a defect (`-1` is a defined baseline sentinel).

Not reachable from production: the only writer, `applyDocumentCrop`, rejects `width/height <= 0`
(`useLayer.ts:558`) and `!isValidDocumentFrame` (`:561`) before dispatching. There is no history
persistence and document load creates a single `OPEN_DOCUMENT_ACTION` (`useApp.ts:113-119`). This
is a latent robustness gap, not a live bug. Coverage is thin: `branches.test.ts:312` covers only a
_missing_ `nextFrame`.

**Fix.** Push a `warning` diagnostic when a `SET_DOCUMENT_FRAME_ACTION` entry yields no durable
operation, so the shadow reports the omission instead of claiming `current`.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/__tests__/branches.test.ts`

---

## 17. Duplicate durable entry id has no second line of defence

> **Fixed on `fix/unit-tests` (`b027de3`).** Open on `main`; delete after the merge. See §0.

**Problem.** `planHistoryAppend` (`history-append.ts:131`) runs `translate()` before
`validateTimeline()`, so an `error`-severity duplicate-id diagnostic coexists with a non-null
`durableEntry`. That is intentional. The gap is downstream: `decideDurableAppend` never re-checks
uniqueness. `validatePlannedDurableEntry:192` compares `planned.id` to `entry.id` (planned-versus-
legacy agreement, **not** timeline uniqueness); `next.entries[next.entries.length - 1] !== entry`
(`:238`) is a reference check on the same object. The conversion loop has no uniqueness check,
`freezeDurableDocument` only clones and freezes, and `history-timeline.ts:31-32` appends
unconditionally.

So a duplicate id on the published path yields a durable document with two same-id entries, and
since the id is a lookup key (`history-adapter.ts:637`, `history-timeline.ts:24`) a later toggle
hits the wrong entry. The invariant rests entirely on a diagnostic that is computed and discarded.

The cursor branch is largely redundant: `decideDurableAppend:229` requires
`prior.cursor === prior.entries.length - 1`, so any out-of-range cursor already falls back.

Both branches are unreachable from production — `planHistoryAppend` is called with no `id`, so
`createHistoryItem` mints a fresh `uuidv4()` (`history-utils.ts:81`), and every production
`REPLACE_DOCUMENT` supplies a non-empty history.

**Fix.** Return `durableEntry: null` when `validateTimeline` produces an `error`-severity
diagnostic, so the store takes the reconversion fallback. Adjust
`history-append.test.ts:171-174`, which currently pins the opposite.

**Files.** `src/contexts/history-append.ts`, `src/contexts/__tests__/history-append.test.ts`

---

## 18. A refused runtime presentation publication is dropped with `console.debug`

> **Fixed on `fix/unit-tests` (`b027de3`).** Open on `main`; delete after the merge. See §0.

**Problem.** `PUBLISH_RUNTIME_PRESENTATION` replaced `UPDATE_LAYERS` as the carrier for the
`hasPreviewLayers && !pendingToolEdits.length` branch (`useLayer.ts:355`). The dispatcher runs
`layersDifferOnlyByPresentation` (`StoreContext.tsx:625-634`, guard at
`layer-presentation.ts:96-112`) and on failure discards the payload entirely with
`console.debug('Ignored a runtime presentation publication that also changes durable layer state')`
at `StoreContext.tsx:630`.

Today the guard always passes, so this is not a live bug — the failure direction is the problem.
The old `UPDATE_LAYERS` applied whatever payload it was given and set `hasUnsavedChanges: true` plus
`durableStatus: 'stale'`. The new code silently loses it: no error, no unsaved flag, no durable
update, no history. Any future change that lets a logical change reach this branch discards a user
edit invisibly, which is strictly worse than the over-conservative flag it replaced.

The hook-level path is unasserted. `useLayer.commit.test.tsx:152-172` exercises exactly this branch
and asserts only `previewLayers`, `tmpCanvas`, `bitmap` and `history`; `hasUnsavedChanges` appears
zero times in that file. The flag is asserted one level down at the reducer
(`StoreContext.presentation.test.ts:108,268`), but those dispatch the action directly, so they prove
the reducer does not set the flag rather than guarding the hook path that reaches it.

**Fix.** Raise the refusal to `console.error` (it is an invariant violation, not an identity
no-op), and add two hook-level tests: one asserting `hasUnsavedChanges` is preserved across a
presentation-only commit, one asserting a logical payload is refused rather than applied.

**Files.** `src/contexts/StoreContext.tsx`, `src/contexts/__tests__/useLayer.commit.test.tsx`

---

## 19. `saveLayerCanvas` is dead in production

> **Fixed on `fix/unit-tests` (`b027de3`).** Open on `main`; delete after the merge. See §0.

**Problem.** `saveLayerCanvas` (`layer-utils.ts:115`) has no non-test caller. `coverage/lcov.info`
recorded `FNDA:6,saveLayerCanvas` — all six invocations from
`layer-utils.test.ts` and `useHistory.test.tsx:509`.

Severity is low and the coverage impact is negligible (1 function, 2 lines, 1 branch; global function
coverage 98.99% → 98.99%). Two corrections to the obvious framing:

- The `layer-utils.test.ts` tests are not vacuous — they drive the live
  `materializePresentationBitmap` (`layer-presentation.ts:53-63`) through a three-statement
  wrapper. The less-covered module is the live one: `layer-presentation.ts` sits at 90.66%
  statements / 84.44% branch while the dead wrapper's file is at 100%.
- `useHistory.test.tsx:502-515` is a genuine stale leftover: it uses `saveLayerCanvas` to drive a
  superseded-canvas race, but `createImageBitmap` is globally mocked (`src/test/setup.ts:85-106`)
  so the resolved bitmap is discarded, and its assertions at `:513-514` are true by construction
  for any non-mutating implementation — they also held under the old mutating implementation.

**Fix.** Delete `saveLayerCanvas` and its six call sites, plus the now-unused
`import { materializePresentationBitmap }` at `layer-utils.ts:8` (`tsconfig.app.json:27` sets
`noUnusedLocals`, so `npm run tsc` fails without it). Delete the stale `useHistory.test.tsx:502-515`
block rather than porting it.

**Files.** `src/contexts/layer-utils.ts`, `src/contexts/__tests__/layer-utils.test.ts`,
`src/contexts/__tests__/useHistory.test.tsx`

---

## 20. No durable-path test materializes a `rectangle`, `ellipse` or `line` vector source

**Problem.** `history-adapter.ts:185` maps all six of `shape`, `rectangle`, `ellipse`, `triangle`,
`polygon`, `line` to `kind: 'vector'`, and `materialization.ts:161` then throws
`Source tool ${toolName} is not a deterministic creator` for any of them whose registry entry lacks
`creator: true`. The registry now flags all six (`toolProcessors.ts:216-220`), but the only durable
test that pushes a vector source through `materializeLayer` uses `toolName: 'shape'`
(`materialization.assets.test.ts:406-425`) — so the `rectangle`/`ellipse`/`line` entries were never
exercised end to end, and nothing in `src/contexts/__tests__` would have caught them missing the
flag. `history-adapter.tool-conversion.test.ts:76-80` pins only the adapter half.

Nothing in production reaches this code: `materializeLayer` and `materializeDocument` have no
non-test importer (item 1), so the throw is latent.

**Fix.** In `materialization.assets.test.ts`, extend the existing vector-source case into an
`it.each` over `['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line']` with the matching
`args` per tool, asserting `materializeLayer` resolves and yields a bitmap for every one. That
converts the registry flag into a contract the durable path checks instead of a declaration in
`toolProcessors.test.ts`. Belongs with the migration work, not with a registry edit.

**Files.** `src/contexts/__tests__/materialization.assets.test.ts`

---

## Known defects that are PINNED — do not "fix" them casually

An `it.fails(...)` is a tripwire: it passes today and **fails the moment the defect is fixed**, so a
fix must remove the pin in the same change. There are 40. The migration-relevant ones:

| Location                                          | What it pins                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `materialization.ordering.test.ts:415`            | interleaved affine/filter grouping (item 3)                                                                                                                                                                                                                                                                                                                                                            |
| `StoreContext.durable-boundary.test.tsx:441`      | `REPLACE_DOCUMENT` retains the prior frame crop                                                                                                                                                                                                                                                                                                                                                        |
| `StoreContext.durable-boundary.test.tsx:602-633`  | the durable cutover is **absent** (item 1)                                                                                                                                                                                                                                                                                                                                                             |
| `useSelectionClipboard.layerViaCopy.test.tsx:203` | canvas→document position translation. **Its diagnosis is stale**: it blames a `documentToCanvasPos` call at `useSelectionClipboard.ts:100` that now calls `canvasToDocumentPos` (correct). The expectation matches neither the correct value nor the described bug. The polygon `points` array is still never frame-converted — a real unfixed clipboard bug under the plan's own coordinate contract. |
| `text.test.ts:258`                                | replaying text from a durable vector source without re-rasterizing                                                                                                                                                                                                                                                                                                                                     |

E2E known failures, 2–4 of 97 on the default headless run (`e2e/OPEN_PROBLEMS.md`):

| tests                                                     | count | mode                               |
| --------------------------------------------------------- | ----- | ---------------------------------- |
| `e2e/helpers/cdp-helpers.spec.ts:220, 239`                | 2     | headless only                      |
| `e2e/helpers/cdp-helpers.spec.ts:113, 129, 146, 163, 195` | 5     | **headed only**                    |
| `e2e/sidebar-keyboard.spec.ts:77, 89`                     | 0–2   | intermittent; 4 of 5 runs headless |

**`AGENTS.md` forbids every headed Playwright invocation** — `--headed`, `--ui`, `--debug`,
`show-report`, `show-trace`, `codegen`, `PLAYWRIGHT_ALLOW_HEADED=1`,
`test.use({headless: false})`. A headed run fails 5 of 97 against headless's 2–4, on a disjoint set,
and the operator's own mouse and keyboard reach the page as real input. Do not flip the mode to
make a failure go away.

---

## Worktree hygiene

`git worktree list` shows 15 worktrees. Seven are parked at `f11f7e7` (09-24 22:40) and are dead
weight: `fix-history-adapter-safety-tests`, `fix-layerstab-tests`, `fix-replay-coordinator-tests`,
`fix-useapp-psd-tests`, `fix-usehistory-tests`, `fix-userect-tests`, and `polished-ironclad`
(detached at `50bb2b8`).

`photoshop-fidelity`, `ps-shape-geometry`, `ps-ux-chrome` and `history-migration-08` are all 0
commits ahead of `main` and safe to delete.

Two hold unmerged work: `ps-transform-geometry` (`a3f9050`, 1 ahead — unifies raster CTM order and
warps trapezoids through a homography; review it before deleting, it is adjacent to the migration's
raster-boundary work) and `ps-integration` (`a0f66c4`, 3 ahead).

`main` is 10 ahead of `origin/main` and nothing is pushed.

---

## 21. A shape layer's declared extent is fractional while its bitmap is integral

Outside this file's stated scope (tool geometry, not migration-caused), recorded here because it is
in the same commit path as the rounded-rectangle quadrant fix and is a real, unfixed defect.

**Problem.** `shapeGeometryBounds` (`src/tools/shape.ts:107-118`) returns a fractional box whenever
the drag is fractional, which is every drag at a non-100% zoom. Nothing rounds it before the layer
canvas is allocated: `ShapeToolArea.tsx:141` passes `pos` straight through, `useLayer.ts:242` only
adds the frame offset (`canvasToDocumentPos` does not touch `width`/`height` —
`document-frame.ts:44-46`), and `layer-utils.ts:204-213` hands `pos` to the tool processor, which
allocates `new OffscreenCanvas(size.width, size.height)` (`shape.ts:223`). The constructor yields an
integer bitmap, but the layer keeps the fractional `pos`.

So a drag from `(10.4, 20.6)` to `(50.2, 80.9)` with `lineWidth` 2 produces a layer declaring
`{ width: 43.8, height: 64.3 }` around a 44×64 (or 43×64) bitmap. The declared extent and the raster
disagree by up to a pixel, so the right or bottom edge — including half the stroke the bounds
deliberately padded for — is clipped or rescaled by that fraction on composite. `document-frame.ts:11-12`
`Math.ceil`s the _frame_, which makes this reachable for any non-integer frame too.

`src/tools/__tests__/shape.test.ts:258-274` currently asserts the fractional box as current
behaviour ("The box is the raw padded extent, so it stays fractional too"), so it documents the
mismatch instead of catching it. That test is a declaration, not a pin: no `it.fails`, so it will
keep passing after a fix and should be re-derived rather than deleted.

**Fix.** Decide the rounding policy once and apply it at both ends. Cheapest correct option: have
`shapeGeometryBounds` return an integral box (round the origin down, the extent up, so no stroke is
clipped) — `Math.floor(x)`, `Math.ceil(x + width)` — which also makes the box a valid `OffscreenCanvas`
size and keeps `ShapeToolArea`'s rebase exact. Alternatively round inside the `shape` processor and
write the rounded `pos` back onto the layer, so the declared extent and the bitmap agree by
construction. Do not round in only one place: the bug is precisely that the two ends disagree.

**Files.** `src/tools/shape.ts`, `src/tools/__tests__/shape.test.ts`,
`src/components/Main/ShapeToolArea.tsx`, `src/contexts/layer-utils.ts`

## 22. `Main.tsx`'s `canvasCtxRef` is never assigned, so the smoothing effect cannot run

**Problem.** `Main.tsx:47` declares `const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null)`.
It is read at `Main.tsx:98-101` (an `if (canvasCtxRef.current)` block that sets
`imageSmoothingEnabled`/`imageSmoothingQuality`) and passed to the tool areas at `Main.tsx:208`.
Nothing ever assigns it, so `.current` is permanently `null` and `:98-101` is unreachable.

Verified unreachability, not merely absence of references:

- `grep -rn 'canvasCtxRef' src e2e` returns 38 hits across 16 files. The **only** `.current =`
  assignment to a context ref anywhere in `Main.tsx` is `toolCtxRef.current =` at `Main.tsx:87` —
  a different ref, the tool overlay.
- No `canvasCtxRef.current =` exists in any file, including tests.
- The prop is never even destructured: in each of the five receiving components the identifier
  appears exactly once, on the prop-type line. No receiver binds it, so no receiver can assign it.
- `Main.tsx` does not destructure the store's own `canvasCtxRef` out of `useStore()` (see
  `Main.tsx:25-39`), so this local ref is not shadowing an already-populated one.

**Fix.** Delete the ref at `Main.tsx:47`, the inert effect at `Main.tsx:98-101`, and the prop at
`Main.tsx:208` — **but all five receivers must change in the same change**, because three declare it
required and the removal otherwise fails `npm run tsc`:

- `CropToolArea.tsx:11` `canvasCtxRef: RefObject<...>` (required)
- `MoveToolArea.tsx:21` `canvasCtxRef: RefObject<...>` (required)
- `TextToolArea.tsx:11` `canvasCtxRef: RefObject<...>` (required)
- `DummyToolArea.tsx:7` and `RectangularSelectionToolArea.tsx:15` (optional)

Measured, not assumed: removing only the `Main.tsx:208` attribute produces
`src/components/Main/Main.tsx(206,10): error TS2741: Property 'canvasCtxRef' is missing in type
'{ className: string; overlayCtxRef: RefObject<CanvasRenderingContext2D | null>; }' but required in
type 'cropToolAreaProps'.` The four test files that pass the prop must drop it too:
`__tests__/CropToolArea.test.tsx` (12 sites), `__tests__/TextToolArea.test.tsx` (4),
`__tests__/MoveToolArea.test.tsx` (2), `__tests__/DummyToolArea.test.tsx` (1). `DummyToolArea.tsx:6`
carries the comment "keep these so Main can pass the same props as for real tool areas", so the whole
prop pair was a uniform-signature shim that no tool area ever used.

**Files.** `src/components/Main/Main.tsx`, `CropToolArea.tsx`, `MoveToolArea.tsx`, `TextToolArea.tsx`,
`DummyToolArea.tsx`, `RectangularSelectionToolArea.tsx`, and their four `__tests__` files.

---

## 23. `Main.toolAreas.test.tsx` names image smoothing that no code performs

**Problem.** `src/components/Main/__tests__/Main.toolAreas.test.tsx:186` is titled
`'sizes both overlays to the document and enables smoothing on the main canvas'`, but it contains no
smoothing assertion at all — only a size triple. Its first element asserts the main canvas is
`[300, 150]`, which is jsdom's default `HTMLCanvasElement` size: `Main.tsx` resizes only
`toolOverlayRef` (`:84-85`) and `rectOverlayRef` (`:92-93`), so no production code ever sets the main
canvas dimensions. The smoothing half of the title describes the unreachable block in §23.

**Fix.** Retitle to state what the test actually covers (overlay sizing against `totalSize`) and drop
the main canvas from the expected triple, or keep the triple and name it as the jsdom default. Then
delete this entry — the retitle is only correct once §23 is done, because until then the smoothing
effect still exists in the source even if it cannot run.

**Files.** `src/components/Main/__tests__/Main.toolAreas.test.tsx:186-195`.

---

## 24. `StoreContext`'s own `canvasCtxRef` is never assigned either

**Problem.** A second, unrelated `canvasCtxRef` lives in the store: declared in the context type at
`StoreContext.tsx:52`, seeded at `:221`, created at `:569`, and published at `:847`. It is
`React.RefObject<CanvasRenderingContext2D | null | undefined>`. No file assigns `.current` — the
`grep -rn 'canvasCtxRef'` sweep over `src` and `e2e` finds no assignment, and the only two non-declaration
readers are test fixtures (`src/__tests__/fixtures/store.ts:18,56`,
`src/hooks/__tests__/useApp.psd.test.ts:15`) that set it to `null`. Two tests assert only that the ref
identity is stable across a dispatch (`StoreContext.reducer.test.tsx:824`,
`StoreContext.test.tsx:228`), which holds for a ref nothing writes.

**Fix.** Delete the field from `StoreState` (`StoreContext.tsx:52`), the seed at `:221`, the
`useRef` at `:569`, the publish at `:847`, and the four fixture/test references. Distinct from §23:
this one is a store-context member, not the `Main.tsx` local, and removing it changes the public
context shape.

**Files.** `src/contexts/StoreContext.tsx`, `src/__tests__/fixtures/store.ts`,
`src/hooks/__tests__/useApp.psd.test.ts`, `src/contexts/__tests__/StoreContext.test.tsx`,
`src/contexts/__tests__/StoreContext.reducer.test.tsx`.

---

## 25. `DrawToolArea` repaints synchronously on every pointer move

**Problem.** `DrawToolArea` accumulates a point and calls `flushDrawingFrame()` — a `clearRect` plus
`drawLine` over the whole accumulated path — on **every** `pointermove`, with no frame coalescing.
Its sibling `ShapeToolArea.tsx:106` batches the same work through
`requestAnimationFrame`, and `useDrag.ts:50`/`useRect.ts:373` batch as well, so a pointer event that
carries several `pointermove` messages per display frame repaints several times for one visible frame.
`drawLine` re-strokes the full point list each time, so cost grows with stroke length as well as with
event rate. A `frameRequested` ref and a `cancelAnimationFrame` guard were present and removed as
inert on `cleanup/app-dead-code`; they never scheduled anything, so removing them changed no
behaviour. The synchronous path is what remains.

**Fix.** Batch the repaint: keep a `frameRequested` ref, and in `handlePointerMove` return early when
a frame is already pending, scheduling `flushDrawingFrame` via `requestAnimationFrame` instead of
calling it directly. `handlePointerUp` must cancel any pending frame **and null the ref** before
committing, or the last preview is dropped (this is exactly the defect §27 records in
`ShapeToolArea`). Add a test that fires N `pointermove` events in one `act()` and asserts the
overlay was stroked once.

**Files.** `src/components/Main/DrawToolArea.tsx`, `src/components/Main/__tests__/DrawToolArea.test.tsx`.

---

## 26. `ShapeToolArea` cancels a pending frame without nulling the ref, freezing the next drag

**Problem.** Two defects in the pointerup path, both confirmed by reading the file:

1. `ShapeToolArea.tsx:125-128` calls `cancelAnimationFrame(frameRequested.current)` but never resets
   `frameRequested.current = null`, and the `flushDrawingFrame()` on the next line is commented out.
   `handlePointerMove` short-circuits on `if (frameRequested.current !== null) return;` at
   `:104`, and `handlePointerDown` (`:69-82`) does not reset it either. So after the **first** shape
   drag the ref stays non-null for the lifetime of the component and every later drag's preview is
   silently dropped: the overlay shows nothing until pointerup. Compare `useDrag.ts:73-76` and
   `useRect.ts:399-400`, which cancel **and** null.
2. `ShapeToolArea.tsx:117-120` recomputes the committed geometry inside `if (!movedBySpace)` from
   `anchorRef.current` and the pointerup point using `event.shiftKey` — the Shift state at
   **release**, not the one in effect during the preview. Releasing Shift before the mouse commits a
   different shape than the one drawn: a Shift-constrained square previews and commits an
   unconstrained rectangle. The pointermove handler at `:94-97` already stored the correct
   `startRef`/`endRef`; this branch overwrites them.

**Fix.** In `handlePointerUp`, call `flushDrawingFrame()` in place of the commented line and null
`frameRequested.current` after cancelling, so the overlay is flushed and the ref is reusable. Drop
the `if (!movedBySpace)` recompute at `:117-123` and commit `startRef`/`endRef` as previewed — or, if
a final-point correction is genuinely wanted, pass the shift state captured at pointerdown via a ref
instead of reading `event.shiftKey`. Add a test that drags with Shift held, releases Shift, then
releases the pointer, and asserts the committed args match the previewed square.

**Files.** `src/components/Main/ShapeToolArea.tsx`, `src/components/Main/__tests__/ShapeToolArea.test.tsx`.

---

## 27. `flattenRequired` is declared outside `useLayer`, so its dead branch cannot be deleted alone

**Problem.** `useLayer.ts:271` is a branch that flattens every layer via `mergeAllLayers()`
before applying a tool. It is reachable only when `processor.flattenRequired` is truthy, and that flag
is declared at `toolProcessors.ts:50` and **set by no production processor**: `grep -rn
'flattenRequired' src e2e` returns four hits — the declaration, the read at `useLayer.ts:271`, and two
test sites that spread it onto `brush` at
`src/contexts/__tests__/useLayer.creation.test.tsx:383` and `:433`. Every one of the 25 entries in
`toolProcessors` sets only `commit`, `replay`, `creator?` and `imageProcessor`. A branch only a test
can reach is a branch nothing verifies: the two tests drive it by mutating the `toolProcessors`
record at runtime and restoring it in a `finally`.

The `imageProcessor` call inside the branch was unguarded while its siblings at `useLayer.ts:479-484`
and `:488-502` wrap in `try { … } catch (error) { console.error(error); return; }`. That asymmetry is
now fixed on `cleanup/app-dead-code`; the branch itself is kept because deleting it would orphan the
field declaration, which lives in `toolProcessors.ts` — outside the file grant for that work.

**Fix.** Delete the field from `toolProcessors.ts:50`, the branch from `useLayer.ts:271-297`, and the
two injection sites plus their `describe` block in `useLayer.creation.test.tsx:381-460`. Alternatively,
if whole-document tools are genuinely planned, keep the field and set it on the processors that need
it — but then the branch needs a real caller, not a test-only flag.

**Files.** `src/tools/toolProcessors.ts:50`, `src/contexts/useLayer.ts:271-297`,
`src/contexts/__tests__/useLayer.creation.test.tsx:383,433`.

---

## 28. `tempUpdateLayer`'s live raster path calls `imageProcessor` with no try/catch

**Problem.** `useLayer.ts:532-533` calls
`processor.imageProcessor({ bitmap, size: layer.pos })(toolArgs)` unguarded, in the path every
non-transform, non-layer-operation, non-geometry tool takes on each pointer move. A throw here escapes
`tempUpdateLayer` into the React event handler and leaves `previewLayersRef` half-written. The two
transform branches directly above it (`:479-484`, `:488-502`) are guarded, so the asymmetry is
local to this one call.

The six throw sites in `src/tools/transform.ts` (`:69, :97, :105, :107, :138, :154`) are **not**
reachable from here: `isTransformArgs` is `args.toolName === 'transform'` (`useLayer.ts:68-70`), and
the two guarded branches partition that tool name exhaustively — `trapezoid !== 0` returns at `:480`,
and `undefined`/`NaN` trapezoid values also take the `!== 0` branch, so every transform-args call
returns before `:532`. The `commit: 'unimplemented'` processors return `[null]` without throwing.

That leaves `shape.ts:211` (`throw new Error('Tool "…" does not provide shape arguments')` when
`!('figure' in args)`) as the only candidate reachable in principle, via the `shape` processor
registered for `shape`, `rectangle`, `ellipse`, `triangle`, `polygon` and `line`. **I could not
demonstrate a production-reachable throw**: `src/util/settings.ts:15` normalises with
`({ ...args, figure: normalizeFigure(args.figure) })`, which always materialises the `figure` key, so
the guard appears to hold for every tool-args path reachable from the UI. The `!('figure' in args)`
guard is a runtime shape assertion on a type the compiler already narrows, and it is the only thing
between a malformed args object and an unhandled throw on the live path.

**Fix.** Wrap `:532-533` in the same `try { … } catch (error) { console.error(error); return; }` used
at `:479-484` and `:488-502`, so a throwing processor degrades to a logged no-op instead of escaping
into the event handler. If the `figure` key can be proven absent by some path, fix that path instead
and add the case to the test that covers `tempUpdateLayer`'s raster preview.

**Files.** `src/contexts/useLayer.ts:532-533`, `src/tools/shape.ts:211`.
