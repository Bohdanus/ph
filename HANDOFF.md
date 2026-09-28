# HANDOFF

Open problems in the history/presentation work. Every item below was re-verified against the
working tree on 2026-09-27; claims that did not survive verification were dropped rather than
softened. Re-read line numbers before editing — this file is a snapshot, not a live view. Item
numbers are stable identifiers that other items cite, so they are not renumbered: the gaps are
entries that were fixed and deleted.

**Scope:** the durable-replay migration and the presentation/append boundary. Tool features and
visual fidelity are out of scope unless a defect is caused by this work.

---

## 0. Branch state — read before the problem list

Everything below was verified on `cleanup/integration` at `ec70662` — the merge of the `cleanup/*`
branches, 56 commits ahead of `origin/main` and 36 ahead of `main`. `main` is `8effced`, **21 commits
ahead of `origin/main`, unpushed**, and 1 commit behind this branch, so the claims below describe
`cleanup/integration` and not `main`. `git status` is clean apart from this file.

**`fix/unit-tests` is `b027de3` (+ `5da9f82`), 2 commits ahead of `main`, unmerged into this
branch.** Merge it first. It is 16 files, +1272/−189, of which 6 are production: `StoreContext.tsx`
(+54/−4), `history-adapter.ts` (+82/−1), `history-append.ts` (+35/−7), `layer-presentation.ts`
(+67/−12), `layer-utils.ts` (+1/−15) and `useLayer.ts` (+13/−4).

It closes the following items in this file, all of which are open here today:

| Item in this file                                               | Fixed by `b027de3` | How                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **18** refused publication dropped with `console.debug`         | yes                | `console.error` with a message that names the invariant violation                                                                                    |
| **17** duplicate durable entry id has no second line of defence | yes                | `publishedEntryIds: Set<string>` in `history-adapter.ts`; the offending entry is _skipped_ and the diagnostic is `error`, not `warning`              |
| **16** invalid document frame converts with no diagnostic       | yes                | the `SET_DOCUMENT_FRAME_ACTION` branch gained an `else` that pushes a `warning` / `invalid-history-entry` diagnostic                                 |
| **19** `saveLayerCanvas` is dead in production                  | yes                | the function is deleted, along with the `materializePresentationBitmap` import that `tsconfig.app.json:32` (`noUnusedLocals`) would otherwise reject |

**After merging, delete items 16, 17, 18 and 19 from this file and re-derive the rest.** Do not
work them from this document.

Two source comments still claim the planned durable entry is not published. That is false on this
branch: `StoreContext.tsx:731` publishes it through `decideDurableAppend`.

- `useLayer.ts:592-596` — "Document-frame changes are the first appends planned through the Phase 1
  boundary. The planned durable entry is not published yet: the store still rebuilds its
  diagnostic shadow from the legacy timeline…"
- `history-append.ts:29-33` — "Phase 1 status: plan only. The durable entry is derived at the append
  point but is not published. `StoreContext` still converts the whole timeline into the diagnostic
  shadow, so publishing the planned entry here would create a second writer for a single append."

**Fix.** Rewrite both to state the single-writer contract: the store publishes the planned entry when
`decideDurableAppend` accepts it against its current durable document, and reconverts the whole
timeline otherwise. Keep the "reporting never blocks the append" invariant — `history-append.ts:52-53`
— next to the second one, where it is the reason the boundary's own diagnostics are redundant.

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
processor (`useLayer.ts:526-533`); the durable path materializes the retained presentation first
(`materialization.ts:263-269`). Wiring the durable path without reconciling these changes pixel-tool
results.

**Fix.** Pick one rendering authority and make the other a projection. Minimum viable: route the
render path through `materializeLayer` for a single layer type, keep `layer-renderer.ts` for the
rest, and delete the duplicated composer. Do not attempt all five consumers at once.

**Files.** `src/contexts/materialization.ts`, `src/contexts/layer-renderer.ts`,
`src/contexts/StoreContext.tsx`

---

## 2. P0 — interleaved affine and filter operations are grouped by type

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

`UPDATE_LAYERS` (item 13) is the same shape: a public action with a hand-written reducer branch
and zero production callers.

**Fix.** Extract the shared post-commit projection into one function that both the reducer and the
dispatcher call, so the flag cannot be forgotten. If that is not feasible, assert the equivalence
in a test that dispatches through the hook and compares against the reducer result.

**Files.** `src/contexts/StoreContext.tsx`

---

## 7. The save/merge path bypasses the presentation scope entirely

**Problem.** `useLayer.ts:603` calls `createImageBitmap(canvasRef.current)` bare — no scope
tracking, no lease, no `retire()` candidate. Every save and every flatten therefore creates a
bitmap that the scope never learns about, so the scope's completeness guarantee does not cover them:
retirement on removal covers the bitmaps a document edit drops from the layer record, and a bare
`createImageBitmap` never enters that record.

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

**Problem.** `UPDATE_LAYERS` is in the public `Action` union (`StoreContext.tsx:178`) with a
hand-written reducer branch (`:392-402`) that sets `hasUnsavedChanges: true` and
`durableStatus: 'stale'`. It has **no production caller**, and it has no
`layersDifferOnlyByPresentation` guard — which is exactly the guard that was added for
`PUBLISH_RUNTIME_PRESENTATION` at `layer-presentation.ts:96-112`.

So the store exposes two ways to set layers, one guarded and one not, and the unguarded one is
test-only. It is also what the append tests use to reach the published path, which is how the
`durableStatus` staleness that defeated that path in ordinary use stayed invisible.

**Fix.** Delete `UPDATE_LAYERS`. If a test needs to move layers, dispatch
`COMMIT_DOCUMENT_EDIT` with the same shape production uses.

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

## 15. Only the crop and selection writers reach the append boundary; the rest reconvert the whole timeline

**Problem.** `translate` (`history-append.ts:121`) handles exactly two action kinds:
`SET_DOCUMENT_FRAME_ACTION` (`:122`) and `SELECTION_ACTION` (`:138`). Everything else returns
`unsupported-history-feature` (`:154-158`), so a `COMMIT_DOCUMENT_EDIT` with no planned entry
reconverts the whole timeline at `StoreContext.tsx:747-758`.

Derived writer inventory, from the `type: 'COMMIT_DOCUMENT_EDIT'` dispatch sites in non-test
source. Three sites hand the store a `durableEntry`:

- `useLayer.ts:597` — `applyDocumentCrop`, `set-document-frame`
- `useSelectionHistory.ts:158` — `clearSelections`, `set-selection`
- `useSelectionHistory.ts:240` — `commitSelection` (`'create'` / `'move'`), `set-selection`

Eleven further sites have production callers and carry no `durableEntry`, so each one
reconverts: `useLayer.ts:166, 293, 310, 374, 408, 432, 452, 638`, `useApp.ts:159` (the tool-switch
deselect, which builds its `SELECTION_ACTION` at `:165-174` without planning), and the two
`useSelectionHistory.ts:174, 256` plan-failure fallbacks. `useHistory.ts:52` (`addHistoryEntry`) is
the fifteenth site and has no production caller at all (item 14). `APPLY_HISTORY_REPLAY` and
`REPLACE_DOCUMENT` remain legacy-only.

The selection pair covers three gestures, not the whole selection surface: the polygon, freehand
and feathered magnetic lasso paths still write no selection history (item 30), so a selection they
create still reaches the timeline only as a later entry's `previousSelectionState`.

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
but `useLayer.ts:578-586` destructures only `entry` and `durableEntry` and discards the rest.

Two clarifications that bound the severity, both verified: the tightening is **correct**
(`history-replay.ts:96-102` has always used the identical predicate; `durable-replay.ts:129-131`
has no validation at all, so the change removes a shadow/legacy divergence rather than creating
one), and the repeated cursor index is **not** a defect (`-1` is a defined baseline sentinel).

Not reachable from production: the only writer, `applyDocumentCrop`, rejects `width/height <= 0`
(`useLayer.ts:568`) and `!isValidDocumentFrame` (`:571`) before dispatching. There is no history
persistence and document load creates a single `OPEN_DOCUMENT_ACTION` (`useApp.ts:113-119`). This
is a latent robustness gap, not a live bug. Coverage is thin: `history-adapter.branches.test.ts:312`
covers only a
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
`hasPreviewLayers && !pendingToolEdits.length` branch (`useLayer.ts:366`). The dispatcher runs
`layersDifferOnlyByPresentation` (`StoreContext.tsx:625-634`, guard at
`layer-presentation.ts:96-112`) and on failure discards the payload entirely with
`console.debug('Ignored a runtime presentation publication that also changes durable layer state')`
at `StoreContext.tsx:631`.

Today the guard always passes, so this is not a live bug — the failure direction is the problem.
The old `UPDATE_LAYERS` applied whatever payload it was given and set `hasUnsavedChanges: true` plus
`durableStatus: 'stale'`. The new code silently loses it: no error, no unsaved flag, no durable
update, no history. Any future change that lets a logical change reach this branch discards a user
edit invisibly, which is strictly worse than the over-conservative flag it replaced.

The hook-level path is unasserted. `useLayer.commit.test.tsx:152-172` exercises exactly this branch
and asserts only `previewLayers`, `tmpCanvas`, `bitmap` and `history`; `hasUnsavedChanges` appears
zero times in that file. The flag is asserted one level down at the reducer
(`StoreContext.presentation.test.tsx:108,268`), but those dispatch the action directly, so they prove
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
`import { materializePresentationBitmap }` at `layer-utils.ts:7` (`tsconfig.app.json:32` sets
`noUnusedLocals`, so `npm run tsc` fails without it). Delete the stale `useHistory.test.tsx:502-515`
block rather than porting it.

**Files.** `src/contexts/layer-utils.ts`, `src/contexts/__tests__/layer-utils.test.ts`,
`src/contexts/__tests__/useHistory.test.tsx`

---

## 20. No durable-path test materializes a `rectangle`, `ellipse` or `line` vector source

**Problem.** `history-adapter.ts:185` maps all six of `shape`, `rectangle`, `ellipse`, `triangle`,
`polygon`, `line` to `kind: 'vector'`, and `materialization.ts:161` then throws
`Source tool ${toolName} is not a deterministic creator` for any of them whose registry entry lacks
`creator: true`. The registry now flags all six (`toolProcessors.ts:124, 220-224`), but the only
durable test that _successfully_ pushes a vector source through `materializeLayer` uses
`toolName: 'shape'`
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
fix must remove the pin in the same change. There are 36, counted as `it.fails(...)` blocks:
`grep -rn 'it.fails(' src e2e` returns 36 and every one is in `src/`, and `npm run test` independently
reports the same 36 as `36 expected fail` out of 3,951 tests in 176 files. The migration-relevant
ones:

| Location                                          | What it pins                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `materialization.ordering.test.ts:415`            | interleaved affine/filter grouping (item 3)                                                                                                                                                                                                                                                                                                                                                            |
| `StoreContext.durable-boundary.test.tsx:441`      | `REPLACE_DOCUMENT` retains the prior frame crop                                                                                                                                                                                                                                                                                                                                                        |
| `StoreContext.durable-boundary.test.tsx:602-633`  | the durable cutover is **absent** (item 1)                                                                                                                                                                                                                                                                                                                                                             |
| `useSelectionClipboard.layerViaCopy.test.tsx:203` | canvas→document position translation. **Its diagnosis is stale**: it blames a `documentToCanvasPos` call at `useSelectionClipboard.ts:100` that now calls `canvasToDocumentPos` (correct). The expectation matches neither the correct value nor the described bug. The polygon `points` array is still never frame-converted — a real unfixed clipboard bug under the plan's own coordinate contract. |
| `text.test.ts:258`                                | replaying text from a durable vector source without re-rasterizing                                                                                                                                                                                                                                                                                                                                     |

The e2e suite pins nothing. `grep -rn 'it.fails(' e2e` returns 0, there is no `test.fixme` and no
`describe.skip`, and the only skips are the two `test.skip` declarations
(`e2e/export/photopea.spec.ts:6`, `e2e/sidebar-flyout.spec.ts:48`). So a failure on the default
headless run is a new defect rather than a known one; `e2e/OPEN_PROBLEMS.md` holds the latent
defects the suite does not trip. `AGENTS.md` forbids every headed Playwright invocation, so a headed
failure is not a gate and the mode must not be flipped to make one go away.

---

## Worktree hygiene

`git worktree remove` discards a worktree's working tree and index unconditionally, and a file that
is uncommitted or untracked exists in no commit and no ref. **"0 commits ahead of `main`" is not a
safety test.** A worktree whose work was never committed is 0 ahead _because_ nothing was committed
— which is exactly the state that loses it. A worktree is removable only when all three of these
hold:

1. **No unmerged commits** — `git rev-list --count main..HEAD` is 0 _and_
   `git merge-base --is-ancestor HEAD main` exits 0. For a branch, add
   `git branch --contains <tip>`: if the only ref holding the tip is the branch itself,
   `git branch -D` loses it where `git worktree remove` would not.
2. **A clean tree** — `git status --porcelain` is empty. Untracked files count: they are the largest
   share of what is lost and are invisible to `git log` by construction.
3. **No stash to apply** — check `git stash list`. All worktrees share one `refs/stash`
   (`48768ea6`, 3 entries; `stash@{0}` alone is 89 files, +14,168/−2,696, and `stash@{2}` holds a
   315-line `VECTOR_SHAPES_REFACTOR_PLAN.md` that is on no branch and no commit), so this is a
   repo-level check rather than a per-worktree one, and `git worktree remove` does not touch it.
   `git stash clear` is the one destructive command that does.

`git worktree remove` refuses a dirty or untracked worktree unless `--force` is passed, so an
unforced removal cannot lose anything. The exposure is exactly `--force`, or `rm -rf`.

Measured 2026-09-27 23:31Z, `git worktree list` returns **59** worktrees. That count is a checkout
fact, not a commit fact, and it moved twice during the session that wrote this section, so use the
three tests above — not the count, and not any enumeration. What they currently accept:

- `fix-usehistory-tests` (`f11f7e7`), `ps-transform-geometry` (`ee8b360`), `history-migration-08`
  (`92028a7`), `fix-unit-tests` (`b027de3`): clean, 0 ahead, and their HEADs are ancestors of
  `main`. `fix-unit-tests`' **worktree** passes; its **branch** does not —
  `git branch --contains b027de3` returns `fix/unit-tests` and nothing else, so `git branch -D
fix/unit-tests` loses 2 commits that `git worktree remove` keeps.
- `cleanup/*`: 27 branches, every one an ancestor of `cleanup/integration`, so those worktrees are
  removable once `cleanup/integration` has landed on `main`. The three `cleanup/residue-*` worktrees
  have already landed and are removable like the rest; an earlier revision of this section told the
  next session the opposite.
- The `50bb2b8` park — `history-architecture-sol`, `history-asset-lifecycle-review`,
  `history-cutover-readiness-review`, `history-operation-coverage-review`,
  `history-persistence-boundary-review`, `history-replay-presentation-review`,
  `history-selection-design`, `history-selection-writer-plan`, `history-tool-command-audit`, `noop`,
  plus the repo's one detached worktree. All are ancestors of `main`, so none holds a commit of its
  own. Ten of the eleven report exactly one untracked path, `.serena/`, which is a tool cache rather
  than work: a naive `git status --porcelain` emptiness test calls them dirty and test 2 then
  refuses them. Delete `.serena/` or judge it as noise, then re-run. The detached worktree's **name
  is not stable** — it has been `cheddar-slime` and `small-output` within one session — so find it
  with `git worktree list | grep '(detached HEAD)'` and check it is at `50bb2b8` rather than
  matching a name. `polished-ironclad`, named here in an earlier revision, does not exist: no
  directory, branch, ref or worktree entry.
- Branches holding unmerged commits that are neither ancestors of `main` nor of
  `cleanup/integration`: `fix/unit-tests` (`b027de3`, 2 ahead), `ps-integration` (`a0f66c4`, 2
  ahead), `layers` (`3610413`, 29 ahead, no worktree), and the `wip/*` set below. Deleting any of
  these with `git branch -D` loses work.
- The `8effced` worktrees: `main` plus the in-flight history/migration set
  (`history-append-readiness`, `history-presentation-lifecycle`, `history-selection-*` and
  siblings). All are 0 ahead, but several carry 2–11 uncommitted paths, so test 2 refuses them.
  They are live work, not park.

**The `wip/*` branches are preservation, not a review.** Nine worktrees that were previously
described here as "0 commits ahead of `main` and safe to delete" held 23 and 42 files of
uncommitted, untracked source on no ref. Each now sits on a `wip/*` branch with one
`wip(preservation)` commit and a clean working tree:

| worktree                           | preservation branch                                | files captured |
| ---------------------------------- | -------------------------------------------------- | -------------- |
| `ps-ux-chrome`                     | `wip/ps-ux-chrome` (`57aced8`)                     | 42             |
| `ps-integration`                   | `wip/ps-integration` (`eb832f3`)                   | 34             |
| `photoshop-fidelity`               | `wip/photoshop-fidelity` (`9394c99`)               | 23             |
| `fix-userect-tests`                | `wip/fix-userect-tests` (`6a625ed`)                | 10             |
| `fix-layerstab-tests`              | `wip/fix-layerstab-tests` (`4528e17`)              | 7              |
| `ps-shape-geometry`                | `wip/ps-shape-geometry` (`c43df1a`)                | 2              |
| `fix-history-adapter-safety-tests` | `wip/fix-history-adapter-safety-tests` (`0d88c91`) | 1              |
| `fix-replay-coordinator-tests`     | `wip/fix-replay-coordinator-tests` (`4ff7217`)     | 1              |
| `fix-useapp-psd-tests`             | `wip/fix-useapp-psd-tests` (`5108707`)             | 1              |

Do not land any of them as if captured equals reviewed. `wip/photoshop-fidelity` carries 12 modified
production files on the history/durable-replay path; `wip/ps-integration` carries an `e2e/` half
that reads `process.env.E2E_PORT` where all 19 `cleanup/*` branches use `PLAYWRIGHT_PORT`, so
merging it as written would break the other 19. Review before merging, and do not remove the
worktrees until each branch has been decided.

`main` is 21 ahead of `origin/main` and nothing is pushed, so no number above has been produced by
CI.

---

## 21. A shape layer's declared extent is fractional while its bitmap is integral

Outside this file's stated scope (tool geometry, not migration-caused), recorded here because it is a
real, unfixed defect in the same code path as the rounded-rectangle quadrant normalisation.

**Problem.** `shapeGeometryBounds` (`src/tools/shape.ts:107-118`) returns a fractional box whenever
the drag is fractional, which is every drag at a non-100% zoom. Nothing rounds it before the layer
canvas is allocated: `ShapeToolArea.tsx:141` passes `pos` straight through, `useLayer.ts:247` only
adds the frame offset (`canvasToDocumentPos` does not touch `width`/`height` —
`document-frame.ts:44-46`), and `layer-utils.ts:204-213` hands `pos` to the tool processor, which
allocates `new OffscreenCanvas(size.width, size.height)` (`shape.ts:223`). The constructor yields an
integer bitmap, but the layer keeps the fractional `pos`.

So a drag from `(10.4, 20.6)` to `(50.2, 80.9)` with `lineWidth` 2 produces a layer declaring
`{ width: 43.8, height: 64.3 }` around a 44×64 (or 43×64) bitmap. The declared extent and the raster
disagree by up to a pixel, so the right or bottom edge — including half the stroke the bounds
deliberately padded for — is clipped or rescaled by that fraction on composite. `document-frame.ts:11-12`
`Math.ceil`s the _frame_, which makes this reachable for any non-integer frame too.

`src/tools/__tests__/shape.test.ts:258-273` currently asserts the fractional box as current
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

---

## 22. `Main.tsx`'s `canvasCtxRef` is never assigned, so the smoothing effect cannot run

**Problem.** `Main.tsx:47` declares `const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null)`.
It is read at `Main.tsx:98-101` (an `if (canvasCtxRef.current)` block that sets
`imageSmoothingEnabled`/`imageSmoothingQuality`) and passed to the tool areas at `Main.tsx:208`.
Nothing ever assigns it, so `.current` is permanently `null` and `:98-101` is unreachable.

Verified unreachability, not merely absence of references:

- `grep -rn 'canvasCtxRef' src e2e` returns 38 hits across 15 files. The **only** `.current =`
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
canvas dimensions. The smoothing half of the title describes the unreachable block in §22.

**Fix.** Retitle to state what the test actually covers (overlay sizing against `totalSize`) and drop
the main canvas from the expected triple, or keep the triple and name it as the jsdom default. Then
delete this entry — the retitle is only correct once §22 is done, because until then the smoothing
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
`useRef` at `:569`, the publish at `:847`, and the four fixture/test references. Distinct from §22:
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
event rate. The file carries no `frameRequested` ref and no `cancelAnimationFrame` guard, so the
synchronous path is the only path.

**Fix.** Batch the repaint: **add** a `frameRequested` ref (the file carries none today), and in
`handlePointerMove` return early when a frame is already pending, scheduling `flushDrawingFrame` via
`requestAnimationFrame` instead of calling it directly. `handlePointerUp` must cancel any pending
frame **and null the ref** before committing, or the last preview is dropped (this is exactly the
defect §26 records in `ShapeToolArea`). Add a test that fires N `pointermove` events in one `act()`
and asserts the overlay was stroked once.

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
the `if (!movedBySpace)` recompute at `:116-123` and commit `startRef`/`endRef` as previewed — or, if
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
`src/contexts/__tests__/useLayer.creation.test.tsx:383` and `:433`. Every one of the 29 entries in
`toolProcessors` sets only `commit`, `replay`, `creator?` and `imageProcessor`. A branch only a test
can reach is a branch nothing verifies: the two tests drive it by mutating the `toolProcessors`
record at runtime and restoring it in a `finally`.

**Fix.** Delete the field from `toolProcessors.ts:50`, the branch from `useLayer.ts:271-297`, and the
two injection sites plus their `describe` block in `useLayer.creation.test.tsx:381-460`. Alternatively,
if whole-document tools are genuinely planned, keep the field and set it on the processors that need
it — but then the branch needs a real caller, not a test-only flag.

**Files.** `src/tools/toolProcessors.ts:50`, `src/contexts/useLayer.ts:271-297`,
`src/contexts/__tests__/useLayer.creation.test.tsx:383,433`.

---

## 28. `tempUpdateLayer`'s live raster path calls `imageProcessor` with no try/catch

**Problem.** `useLayer.ts:532-533` calls
`processor.imageProcessor({ bitmap, size: layer.pos })(toolArgs)` unguarded. `isTransformArgs` is
`args.toolName === 'transform'` (`useLayer.ts:68-70`), so this is the path every non-transform,
non-layer-operation, non-geometry tool takes on each pointer move. A throw here escapes
`tempUpdateLayer` into the React event handler and leaves `previewLayersRef` half-written. The two
transform branches directly above it (`:479-484`, `:488-502`) are guarded, so the asymmetry is
local to this one call.

The six throw sites in `src/tools/transform.ts` (`:69, :97, :105, :107, :138, :154`) are **not** all
out of reach from here. A trapezoid-only transform reaches `:532-533`, and a throw inside it escapes
into the React event handler: `useLayer.ts:478` opens the first branch, but its body is
`if (!isTrapezoidOnlyTransform(toolArgs)) return;` (`:480`), and `isTrapezoidOnlyTransform`
(`affine-transform.ts:216-227`) returns **true** for a finite non-zero `trapezoid` with no rotate,
mirror or skew and `resizeX`/`resizeY` at 100 — so the `try` block falls out at `:484` without
returning. `:487` is then skipped because `trapezoid !== 0`, and `processor.commit` for `transform`
is `'affine-operation'` (`toolProcessors.ts:106`), so neither `:505` nor `:516` returns either.
Control reaches the unguarded call. Inside `transform`, `trapezoid === 0` is false at `:152` and
`isTrapezoidOnlyTransform(args)` is true at `:153`, so the `throw` at `:154` is skipped and
`renderTrapezoid` runs, which throws at `transform.ts:97` (`Math.abs(trapezoid) >= 100`) or at
`:105`/`:107` when the homography is not invertible. The `commit: 'unimplemented'` processors return
`[null]` without throwing.

What bounds that is the UI, not the guard. `Transform.tsx:238-239` sets `min={-85}` / `max={85}` on
the only slider that writes `trapezoid`, so `transform.ts:97` is not slider-reachable. Every other
writer is untraced: stored tool args restored from `lastSavedSettings`, and any direct
`patchToolArgs`/`throttledOnChange` call. A `trapezoid` of `|100|` or more arriving by one of those
routes lands on the unguarded `:532-533`.

The other candidate is `shape.ts:219-221` (`throw new Error('Tool "…" does not provide shape
arguments')` when `!('figure' in args)`), reached through the `shape` processor registered for
`shape`, `rectangle`, `ellipse`, `triangle`, `polygon` and `line`. **I could not demonstrate a
production-reachable throw there**: `src/util/settings.ts:17-18` normalises with
`({ ...args, figure: normalizeFigure(args.figure) })`, which always materialises the `figure` key,
so the guard appears to hold for every tool-args path reachable from the UI. The `!('figure' in args)`
guard is a runtime shape assertion on a type the compiler already narrows, and it is the only thing
between a malformed args object and an unhandled throw on the live path.

**Fix.** Wrap `:532-533` in the same `try { … } catch (error) { console.error(error); return; }` used
at `:479-484` and `:488-502`, so a throwing processor degrades to a logged no-op instead of escaping
into the event handler. That covers the trapezoid path as well as `shape`, and it is the only fix
that does not depend on tracing every writer of `trapezoid`. If the `figure` key can be proven absent
by some path, fix that path instead and add the case to the test that covers `tempUpdateLayer`'s
raster preview.

**Files.** `src/contexts/useLayer.ts:532-533`, `src/tools/transform.ts:96-107`,
`src/tools/shape.ts:219-221`.

---

## 29. A `tsc` that type-checks nothing is auto-approved by an untracked, globally gitignored file

**Problem.** The root `tsconfig.json` is a solution stub: `"files": []` at `:9`, no `include`, and
only three `references` (`:10-14`). So `npx tsc` and `npx tsc --noEmit` at the repo root resolve zero
input files and always exit 0. Verified in the root checkout: `npx tsc --showConfig -p tsconfig.json`
prints `{"compilerOptions": {}}` and the three references, with no `files` array. The behaviour is by
design and `tsconfig.json:2-8` says so; the hazard is that it is indistinguishable from a pass.

Every file that actually runs a type-check uses the safe form — `package.json:13`
(`"tsc": "tsc -b"`), `.husky/pre-commit:2` (`npm run tsc`) and `.github/workflows/ci.yml:46`
(`run: npm run tsc`) — and tracked `kilo.jsonc` has no `tsc` entry that would deny the command. The
only tracked prose about the bare form warns against it (`tsconfig.json:3`, `AGENTS.md:103`,
`MIGRATION_NEXT_STEPS_SUNDAY.md:1060`), and `MIGRATION_NEXT_STEPS_SUNDAY.md:817-820` also still
carries a copy of this hazard. The one live hazard is
`/Users/bkalynovskyi/ph/.claude/settings.local.json:3`, whose `"allow": ["Bash(npx tsc:*)"]`
wildcard auto-approves exactly the bare form. The file exists in the operator's root checkout
(60 bytes, mtime 2026-09-26 16:57, so actively maintained, not a leftover).

It is invisible from the repository by construction: `git ls-files .claude` is empty, and
`git check-ignore -v .claude/settings.local.json` run in the root checkout resolves to
`/Users/bkalynovskyi/.config/git/ignore:1`, `**/.claude/settings.local.json`. So no worktree, no
`git status` and no `git ls-files` can see it, and a review that finds it absent from its own
worktree has not established that it is gone — it has established that the review was not looking in
the root checkout. That is the same trap `AGENTS.md` documents for `node_modules` and `:5173`.

**Fix.** Narrow or drop the `Bash(npx tsc:*)` wildcard in that file, and record the three facts in
`AGENTS.md` next to the existing `npx tsc --noEmit` warning at `:103`: (a) the bare form type-checks
zero files and always exits 0; (b) a `Bash(npx tsc:*)` allow-wildcard in `.claude/settings.local.json`
auto-approves exactly that command; (c) the file is untracked and globally gitignored, so its
absence from a worktree is not its absence from the machine. `AGENTS.md` is where the record belongs
— the auto-approved command never causes anyone to open a `tsconfig.json`, and `tsconfig.json:2-8`
cannot carry the reason it is invisible. `MIGRATION_NEXT_STEPS_SUNDAY.md:817-820` is a tracked copy
nobody reads before acting. Unproven either way: whether the installed build's permission matcher
actually honours the wildcard. Nothing in the repo exercises it.

**Files.** `/Users/bkalynovskyi/ph/.claude/settings.local.json` (untracked, outside the repository),
`AGENTS.md`, `tsconfig.json`, `package.json`

---

## 30. The polygon, freehand and feathered magnetic lasso gestures still write no selection history

**Problem.** `commitSelection` in `src/contexts/useSelectionHistory.ts:195` is the single writer for
selection-creation history, and only two gestures use it: `MagicWandToolArea.tsx:23, 93` and
`RectangularSelectionToolArea.tsx:27, 83`. The two remaining selection-creating paths still dispatch
the raw actions:

- `FeatherMagneticLassoToolArea.tsx:376` — `dispatch({ type: 'COMMIT_SELECTION', payload: selection })`
- `PolygonClickToolArea.tsx:204` — `dispatch({ type: 'COMMIT_SELECTION', payload: selection })`
- `PolygonClickToolArea.tsx:274` — `dispatch({ type: 'UPDATE_SELECTION', payload: selection })`, the
  redraw of an already-committed polygon

None of those reducer arms append to `history` or move `historyIndex`: `COMMIT_SELECTION` returns
`commitSelection(state, …)` (`StoreContext.tsx:295-313`, dispatched at `:515-516`) and
`UPDATE_SELECTION` returns `updateCommittedSelection(state, …)` (`:315-334`, dispatched at
`:517-519`). Both are `{ ...state, … }` returns that never name `history` or `historyIndex`, so a
selection these gestures create is recorded nowhere. It survives on the timeline only as the
`previousSelectionState` of whatever clear entry happens to come later, and the panel
disable-toggle, `resetHistoryTo` navigation and the durable conversion all treat that later entry
as the event that created it.

Both files also clear selections through the raw action rather than the writer —
`FeatherMagneticLassoToolArea.tsx:304` and `PolygonClickToolArea.tsx:517` in `removeLastAnchor` when
the last anchor is popped. The Clear/Deselect control path already goes through
`useSelectionHistory.clearSelections`, so those two sites are the remaining un-routed clears on
these components.

**Fix.** Route each gesture-end commit through `commitSelection(selection, 'create')` — and
`('…', 'move')` for the committed-polygon redraw at `PolygonClickToolArea.tsx:274` — exactly as the
magic wand and rectangle already do. Capture the before-snapshot at gesture start: the polygon
builds its points anchor by anchor across many clicks, so its `previousSelectionState` must be the
state before the first anchor was placed, not the state at double-click. Keep every pointer-move
preview transient, as the rectangle does — its whole drag is canvas overlay and the store is
untouched until `onChangeEnd` (`RectangularSelectionToolArea.tsx:76-83`) — so the commit belongs at
gesture end and nowhere else, or the gesture writes one history entry per pointer move. The same
change should route `:304` / `:517` through `clearSelections`, and delete the now-dead comment in
`useSelectionHistory.ts:36-42` that claims the raw arms are kept for the polygon and lasso gestures.

**Files.** `src/components/Main/FeatherMagneticLassoToolArea.tsx`,
`src/components/Main/PolygonClickToolArea.tsx`, `src/contexts/useSelectionHistory.ts`

---

## 31. The selection baseline lookup must stay unbounded over the whole timeline

**Problem.** `deriveSelectionBaseline` (`selection-baseline.ts:56`) is deliberately unbounded: it
takes the **first** non-disabled `SELECTION_ACTION` on the timeline and seeds from that entry's
`previousSelectionState` (`:57-59`), with no cursor argument at all. Both consumers take the
timeline wholesale — `history-replay.ts:68` and `history-adapter.ts:465` — so the durable baseline
and the legacy replay start from the same snapshot, which is the parity property `0659ce9`
extracted this rule to own.

Bounding the lookup by replay target looks like a correctness fix and is a data-loss bug **until
item 30 is done**, and that ordering is the whole content of this entry. Two tests pin the
unbounded behaviour as load-bearing, not stale:

- `src/contexts/__tests__/useHistory.test.tsx:439` — "restores a cleared selection when undoing the
  tool-switch history entry". The fixture is a rename entry at index 0 and a selection-clear entry
  at index 1; `undo()` from `historyIndex: 1` replays to index 0, and the only record that the
  selection ever existed is the clear entry at index 1 — after the target. Bound the lookup and
  undoing a tool-switch deselect becomes a silent visual no-op.
- `src/contexts/__tests__/history-replay.test.ts:90` — "uses the first selection action baseline
  before it and its next state at or after it". `replayHistory(history, 0, …)` at `:117` expects the
  baseline, with the `SELECTION_ACTION` at index 1, again after the target index.

**Fix.** Do not bound it yet. The precondition is that **every** selection-creating gesture records
its own entry, so the first `SELECTION_ACTION` on the timeline is the one that created the state
rather than a later entry that merely cleared it — i.e. item 30, plus the two raw clears it names.
Once that holds, bound the lookup at the replay target and change those two tests **in the same
change**: they must be re-derived to assert a creation entry that precedes the target, not deleted
to make the bound pass. The unbounded behaviour is a live feature, so a fix that makes one of them
fail has removed a user-visible capability, not corrected a pin.

**Files.** `src/contexts/selection-baseline.ts`, `src/contexts/history-replay.ts`,
`src/contexts/__tests__/useHistory.test.tsx`, `src/contexts/__tests__/history-replay.test.ts`

---

## 32. Every selection change now appears as a "Selection" row in the History panel

**Problem.** `getHistoryItemTitle` (`useHistory.ts:15`) special-cases a tool source (`:18-20`),
`TOOL_ACTION` (`:22-24`) and the crop (`:26`), and otherwise **falls through to the raw action
name** (`:28`). `HistoryTab.tsx:22` renders that string, so a `SELECTION_ACTION` entry is labelled
with the constant's own value.

That was invisible while selections wrote no history. It is not any more: the Clear/Deselect
controls, the magic-wand click and the rectangle drag end each now append one real entry through
`commitSelection` / `clearSelections`, so every selection change in a session adds a row. Each row
is also a navigation target (`resetHistoryTo(originalIndex)` at `HistoryTab.tsx:27`) and carries a
disable toggle (`:45`), so a user can step onto or disable a row whose label says nothing about
what it did — and there is no way to tell a creation from a clear, since both carry the same
`layerId: 'selection'` and the same action name.

**This is a UX decision, not a defect with one right answer.** The operator chooses between hiding
selection entries from the panel, grouping consecutive ones into a single row, and relabelling them
distinguishably (create / clear / resize). Whichever is chosen, the label has to come from
something the entry actually carries; `nextSelectionState` and `previousSelectionState` are already
on the item (`useSelectionHistory.ts:214-224`), so a relabel is derivable without a new history
field. Do not add a history field for presentation alone while the legacy timeline is still the
replay authority.

**Files.** `src/contexts/useHistory.ts:15-29`, `src/components/SidebarRight/HistoryTab.tsx`

---

## 44. `SaveDialog` has the same unowned keyboard as `NewImageDialog` had, and no dialog in the app is marked as one

**Problem.** `NewImageDialog` no longer has this defect, but its sibling never had the fix.
`SaveDialog.tsx:32` is the same `fixed inset-0 z-[1050]` overlay with `outline-none
focus:outline-none` and nothing else: no `autoFocus`, no `tabIndex`, no `onKeyDown`, so no Escape
handler, no key interception and no focus trap (`grep -n 'autoFocus\|onKeyDown\|tabIndex'
src/components/SaveDialog/SaveDialog.tsx` matches only the Tailwind outline classes).

The consequence is the one `NewImageDialog` just had. Focus stays on the `File ▸ Save As` menu
`<button>`, and the app's whole shortcut layer is one `document`-level keydown listener
(`useKeyboardEvents.tsx:120`) suppressed only by `isEditableTarget` (`useKeyboardEvents.tsx:29-54`),
which is true for textarea, contenteditable, text-like inputs and select — never a `<button>`. With
a document open, `Cmd+Z`, `Cmd+C`, `Cmd+V` and every tool key fire behind the open save dialog.

**Do not copy the old approach.** `SaveDialog`'s first focusable control is the header close button
(`:44`), which precedes both inputs (`:58`, `:71`) in document order. A
`querySelector('select, input, button')` autofocus therefore lands on that **button**, and a button
is not text-like, so `isEditableTarget` stays false and the shortcut hole re-opens. Port the
selector and the `stopPropagation` scope from `NewImageDialog.tsx:20-21` and `:137-153` instead. The
`<select>` at `:71` does not save you either way: the filename input at `:58` precedes it, so the
text-like branch resolves there.

**A focus trap that does not contain focus is the same defect twice.** `NewImageDialog`'s first
version wrapped Tab from the last control to the first and nothing more, and the keydown handler sat
on the overlay, so a keydown whose target was outside the panel was never seen. Clicking the dialog's
own title, or its `Opacity:` label (`NewImageDialog.tsx:259-261`, no `htmlFor`), blurs the focused
control and leaves `document.activeElement` on `<body>`; from there Tab walks out of the modal and
`Cmd+Z` reaches the shortcut layer again, because `isEditableTarget(<body>)` is false. Port the
containment too — the `focusout`/`focusin`/`keydown` capture guards at
`NewImageDialog.tsx:66-115`, the `!panel.contains(document.activeElement)` arm at `:123-127`, and the
test at `NewImageDialog.test.tsx` named "keeps Tab and the app shortcut layer inside the
panel after focus is driven outside it". Two arms are not optional: a click on non-interactive text fires
`focusout` with a null `relatedTarget` and **no** `focusin`, while removing the focused control fires
no focus event at all, so a `focusin`-only guard still leaks.

**No dialog in the app is announced as one.** `grep -rn 'role="dialog"\|aria-modal' src/` matches
`NewImageDialog.tsx:160-161` and nothing else, so a screen reader is told nothing when
`SaveDialog`'s overlay appears: no dialog role, no modality, and the `Save File As...` heading at
`SaveDialog.tsx:43` is not wired to it with `aria-labelledby`. Add `role="dialog"`,
`aria-modal="true"` and an `aria-labelledby` pointing at that heading to the `SaveDialog` overlay,
following `NewImageDialog.tsx:160-162` and `:169`, and add the assertion the
`NewImageDialog` suite carries ("is announced as a modal dialog labelled by its title") so the
attributes are pinned rather than assumed.

**Files.** `src/components/SaveDialog/SaveDialog.tsx:32-51`,
`src/components/SaveDialog/__tests__/SaveDialog.test.tsx` (asserts nothing about focus or role today)
