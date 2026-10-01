# Handoff

Open defects in this code. [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) is the rule: **fixed and
verified DELETES the entry**, a tombstone is not a record, and this file is scoped to `history` by
`SCOPE_BY_FILE`. Where a finding belongs in another document, that document is named in the entry.

Numbering is stable and gaps are expected — a deleted entry's number is not reused.

### Items 5, 7, 9, 13, 14, 18, 19, 21-29, 33-35, 37-42, 44, 48-53, 65, 69-71, 75, 84-85, 100, 104-105, 111, 125, 127, 131, 141 — deleted

Numbers only, and that is deliberate. This heading is the machine-readable record that keeps the
board from re-filing a number as new work
(`scripts/lib/agent-board/handoff-import.mjs` `deadNumbers`), so the numbers have to outlive the
entries. What must not outlive them is prose — a "fixed in `abc123`" line per entry is the
tombstone the lifecycle rule forbids, because it invites a reader to trust a claim instead of
re-deriving the code. So this is a list and nothing else; each number was deleted on verification,
and the verification is `git log`, not this file.

## 1. P0 — the durable replay path has no production caller

**Problem.** Four of the five modules the migration was built around are imported by nothing outside
`src/contexts/__tests__/`:

| module                               | non-test importing files              |
| ------------------------------------ | ------------------------------------- |
| `src/contexts/materialization.ts`    | **0**                                 |
| `src/contexts/replay-coordinator.ts` | **0**                                 |
| `src/contexts/replay-checkpoints.ts` | **0**                                 |
| `src/contexts/durable-replay.ts`     | 1 — `materialization.ts`, itself dead |

Production still runs legacy `HistoryItem[]` → `replayHistory` (`useHistory.ts:81`) → runtime
`Layer` → `layer-renderer.ts:65-146` → canvas. `durableDocument`, `durableStatus` and
`durableDiagnostics` are derived by `buildDurableDocument` (`StoreContext.tsx:659-696`) and
projected onto the three `StoreData` fields at each call site, never inside that function. Two
production components read the fields from `useStore()` — `DevStatusStrip.tsx:18` and
`ErrorBoundary.tsx:48` — so this entry's earlier claim that they are "read by nothing outside that
file" was false and is withdrawn. Neither reader runs on a normal production load, so the
conclusion below still stands: `DevStatusStrip.tsx:62` gates its body on `import.meta.env.DEV`, and
`ErrorBoundary`'s `useStore()` call is inside `ErrorBoundaryFallback` (`ErrorBoundary.tsx:41`),
which renders only after a region has thrown (`ErrorBoundary.tsx:95`).
`StoreContext.durable-boundary.test.tsx:573-583` actively pins the absence — it asserts that
`replayCoordinator`, `presentationMaterialization` and `getReplayRevisionToken` are _not_ in the
store. The suite is green and is enforcing the absence of the feature.

**Why it matters.** Every correctness property the durable model was built to provide — validated
conversion, diagnosable failure, deterministic asset ownership — currently protects no
user-visible behaviour. The migration's deliverable is unwired.

**Trap for whoever wires it.** The affine composition is _not_ duplicated —
`operationAffine` (`materialization.ts:109-116`) composes through the shared
`multiplyAffineTransforms` and `getAffineBounds` from `affine-transform.ts`. What _is_ a second
implementation is the vector-argument rescale: `vectorArgsForSize` (`materialization.ts:125-145`)
scales `start`/`end`/`lineWidth` by the source-to-current ratio inline, and
`scaleVectorArgs` (`layer-renderer.ts:38-49`) does the same arithmetic for the legacy path. Two
files, no shared owner, so the two can drift and the drift only shows as a wrong shape after
cutover. `materializeLayer` / `materializeDocument` have zero callers, so the first wiring attempt
is the first time that code executes against real state.

**Also wrong at the boundary.** The runtime path feeds an _untransformed_ bitmap — `layer.tmpCanvas
?? layer.bitmap` (`useLayer.ts:557`) — straight into a pixel processor (`useLayer.ts:571`); the
durable path materializes the retained presentation first
(`materialization.ts:270-276`). Wiring the durable path without reconciling these changes pixel-tool
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
genuine segment boundaries (`materialization.ts:264-291`), so this is **half-fixed**:
_inter-intra-segment_ interleaving is still grouped.

`materialization.ordering.test.ts:415` is `it.fails('applies interleaved affine and filter
operations in original order, not grouped by type')`. **The pin is inert — it cannot be removed in
the same change as the fix, because it never observes the defect.** It spies on
`HTMLCanvasElement.prototype.getContext` (`:428-429`), but `materialization.ts:55` short-circuits to
`OffscreenCanvas`, `src/test/setup.ts:195-224` installs a global one for every suite that does not
already provide its own, and that test file never stubs it. A probe replicating the pin's instrument
recorded **zero** calls on both
`transform` and `drawImage`, so its assertions fail on `0` rather than on the grouping — and
`0 !== 2` before and after a fix alike. A correct fix is forced to leave the pin, or to rewrite
assertions that still measure nothing. The tripwire convention this rests on is written down in the
pin table below; `AGENTS.md` does not count `it.fails` blocks at all. See `FOCUSED-REVIEW-2026-09-28.md`
§1.

Both the durable-replay handoff and the consolidated handoff gate Phase 3 on this. It is also a
correctness bug in the shared pipeline, so it blocks item 1 as well as the phase gate.

**Fix.** Make `renderRetainedSegment` a fold over the operation list in order, keeping the
raster-processor boundary but not reordering within a segment. **Re-instrument the pin first**, with
`vi.stubGlobal('OffscreenCanvas', …)` as `materialization.assets.test.ts:134` does, and add
`expect(recordedContexts.length).toBeGreaterThan(0)` as a positive control — it fails today and is
what makes the pin a tripwire. Only then can the `it.fails` be removed in the same change.

**Files.** `src/contexts/materialization.ts`,
`src/contexts/__tests__/materialization.ordering.test.ts`

---

## 4. P0 — one error diagnostic voids the entire durable shadow

**Problem.** `convertLegacyHistorySafely` (`history-adapter.ts:720`) checks
`converted.diagnostics.some((d) => d.severity === 'error')` at `:732` and, if any one entry
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

**Problem.** `materialization.ts:162` sets `ctx.globalAlpha = source.opacity`, but there is no
`blendMode` / `globalCompositeOperation` anywhere in `materialization.ts` or `durable-replay.ts`.
Only the legacy renderer applies it (`layer-renderer.ts:101`).

So the moment `materialization.ts` becomes the render path (item 1), every layer with a non-normal
blend mode renders incorrectly. The durable snapshot carries the field; the pipeline drops it.

**Fix.** Apply `snapshot.blendMode` in `materialization.ts` alongside the existing `globalAlpha`,
and add a test that a multiply-blended layer materializes differently from a normal one.

**Files.** `src/contexts/materialization.ts`, `src/contexts/history-model.ts`

---

## 12. `rasterize-layer` has no writer anywhere

**Problem.** The operation kind is declared (`history-model.ts:107`), matched when assets are
collected from it (`:166`) and when it is cloned (`:250`), and in replay (`durable-replay.ts:122`),
and exercised by four test files — but no
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

## 15. `reorder-layers` is published; a self-anchored move is a real converter defect

**Status.** The append-boundary publication landed on `history/reorder-durable-append`. A reorder
is planned, validated and published by the same
`published` / `preconditions` / `mismatch` decision the frame, selection and layer-property appends
use. What remains here is one real defect the slice found, and the conversion-only inventory.

### The remaining conversion-only writers

Reorder and `remove-layer` are no longer among them. These production sites still pass no
`durableEntry`, so each one runs `buildDurableDocument` over the whole timeline. Passing a
`durableEntry` is necessary but not sufficient: the store publishes only on
`outcome === 'published'` and otherwise reconverts.

| Site                                      | Action             | Why                                           |
| ----------------------------------------- | ------------------ | --------------------------------------------- |
| `useLayer.ts:229` `createBlankLayer`      | `NEW_LAYER_ACTION` | asset-bearing; needs the registry transaction |
| `useLayer.ts:247` `createLayerFromBitmap` | `NEW_LAYER_ACTION` | asset-bearing; needs the registry transaction |
| `useLayer.ts:278` `createLayerFromTool`   | `NEW_LAYER_ACTION` | asset-bearing; needs the registry transaction |
| `useLayer.ts:323` `updateLayerByTool`     | `TOOL_ACTION`      | asset-neutral; not blocked by §54             |
| `useLayer.ts:365` `commitDirtyTool`       | `TOOL_ACTION`      | asset-neutral; one commit per pending edit    |
| `useLayer.ts:671` `mergeAllLayers`        | `MERGE_ACTION`     | asset-bearing, retires layers                 |
| `useSelectionHistory.ts:149`              | `SELECTION_ACTION` | `catch` fallback when planning throws         |
| `useSelectionHistory.ts:305`              | `SELECTION_ACTION` | `catch` fallback when planning throws         |

The three `NEW_LAYER_ACTION` rows are the creators that mint the history item, not one shared
dispatch: `useLayer.ts:240`, `:262` and `:316` are the only `layerSource:` writers in the file, and
`_addLayer` (`:185`) is the sink they all dispatch through.

Three sites have no `durableEntry` concept and reconvert unconditionally: `useHistory.ts:117`
`resetHistoryTo` (`APPLY_HISTORY_REPLAY`), `useLayer.ts:195` and `useApp.ts:117` (both
`REPLACE_DOCUMENT`). The `useHistory.ts:52 addHistoryEntry` row this table used to carry is
**deleted**: that symbol no longer exists anywhere in `src/`, and "see item 14" pointed at a
reader that no longer had a referent.

**Fix, in order.** Only `create-layer` and `merge-document` are blocked on §54's registry
transaction, and that gap is what keeps those four writers here. `remove-layer` and the
`TOOL_ACTION` operations are asset-neutral: a `remove-layer` carries only a `layerId`
(`history-model.ts:89`), and a `TOOL_ACTION` carrying no layer source is derived by
`operationForTool` (`history-adapter.ts:442`), whose every arm returns an operation with no raster
snapshot — `apply-raster-processor` (`:460`, `:511`), `apply-affine-transform` (`:478`),
`apply-filter` (`:494`) and `reposition-layer` (`:503`) — reached from the caller arm at `:754`.
`collectDurableAssetIds` scans the whole replayable history but collects only raster-bearing kinds
(`history-model.ts:158-175`), so a removal or an in-place pixel edit changes no reachable asset and
needs neither registration nor retirement. They remain here only until a `durableEntry` is planned
for them; §54 is untouched and still applies to the first actual asset-bearing append writer.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/history-append.ts`,
`src/contexts/StoreContext.tsx`, `src/contexts/useLayer.ts`, `src/components/SidebarRight/LayersTab.tsx`

### How the reorder publication is proved, and what it costs

The blocker was that a reorder's durable operation cannot be derived from the history item: it names
the resulting order of **every** layer, and the item carries only intent. The store now plans it
from `state.layers` read at the boundary (`StoreContext.tsx:890 layerOrderBottomFirst(currentState.layers)`), which is
the same record `reorderLayers` is about to mutate. Three things make that safe:

- **`reorderOrderAfterIntent` (`history-append.ts:229`) is a second implementation, not a call into
  the converter's.** The converter's copy is an inline arm inside `legacyHistoryToDurable`, so
  calling it would reproduce a bug in it rather than catch one. Two copies can drift, so
  `history-append.reorder.test.ts` pins them against each other against a real converter run over
  a matrix of orders and intents, plus a table of hand-written literal maps so a wrong rule on
  _both_ sides still fails. The store test pins the published document against a full conversion,
  which is the end-to-end oracle.
- **The shadow's own layer ORDER is a precondition, compared as a sequence.** Durable replay skips
  ids it does not know (`durable-replay.ts:110`), and a published map is a fresh normalisation of
  the order, so it overwrites whatever order the shadow had. Publishing while the two models
  already disagree about the order launders that disagreement into a durable document no
  reconversion will produce. Membership is not enough: the models can name exactly the same layers
  in a different sequence, and only the sequence check sees it.
- **A refusal is a `preconditions` outcome, never a diagnostic.** A missing mover, a missing anchor
  and a self-anchor produce no order map and no `durable-append-mismatch`, because a fabricated map
  for a no-op is worse than a fallback. The store test asserts the refusal shape directly.

**Cost, stated plainly: the published path is cheaper, not constant.** It replaces a full
_legacy_ conversion with one `replayDurableDocument` over the _durable_ history (`StoreContext.tsx`
`REORDER_LAYERS` branch) plus an appended entry. The durable replay is materially cheaper — no asset
transaction, no arg parsing, no diagnostics, and it clones only the layers each entry touches —
but it is still O(durable history), so calling this "a fast path with no walk" would be false.

### The self-anchored move: a converter defect, deliberately not fixed here

`reorderOrderAfterIntent` **refuses** a move whose anchor is the mover itself, and the boundary
falls back to conversion. That is not caution about an edge case; it is because the two
implementations genuinely disagree, which was measured, not assumed:

- `reorderLayers` (`layer-utils.ts:280-288`) anchors on the mover's own order, shifts everything
  above it, then re-assigns the mover. On a three-layer stack the **visible sequence is unchanged**
  — `{bottom:0, middle:2, top:4}` still reads bottom, middle, top.
- The converter's inline arm drops the mover from `remaining` **first**, so `remaining.indexOf`
  is `-1` and `+ 1` is `0`: it records a **move to the bottom**.

So the shadow and the document describe different orders from that entry forward, and an undo/redo
through it will not restore the stack the user was looking at. The same `indexOf(...) + 1` shape is
what the absent-anchor bug was, one case further in: the fix for that case checked `anchorPresent`
but never checked that the anchor was _not the mover_. Note the disagreement is a function of the
stack, not a blanket one — when the mover is already the bottom layer the two **agree**, so the
boundary's refusal is deliberately over-broad there, in the safe direction.

**Fix.** Decide which answer is correct — the sequence-preserving one is what the document does, so
the identity-on-`preOrder` map is the honest one — then change the converter's arm and
`reorderOrderAfterIntent` **together**, and extend the parity matrix. Changing only the boundary
would make a published shadow differ from a reconverted one for the same history, which is the
exact failure this item exists to prevent.

**Unreachable in production today, and both UIs guard it.** `LayersTab.tsx:94` computes
`isDropTarget` as `dropTargetId === layer.id && dropTargetId !== draggedLayerId && …` and
`LayersTab.tsx:155` returns before dispatching when it is false, so a row cannot be dropped on
itself; the other `animateMove` call site (`LayersTab.tsx:276`) passes no anchor at all, and
`MobileLayersDrawer.tsx:63,72` anchors on a neighbouring index. `git grep moveLayerAfter` returns
only those two components. This was asserted as reachable on an earlier read of this section and
that was wrong — the drop guard is the reason, and it is a guard, not a coincidence. It is still a
real defect: a disabled entry, a replayed history, or any future writer that names its own anchor
reaches it, and the shadow is the production replay authority's shadow either way.

**A related pre-existing hazard, not introduced here and not fixed here.** The dispatcher reorders
the record from the intent unconditionally, without consulting `isEntryEnabled`, so a caller that
supplied a `disabled: true` reorder item would reorder the visible record while the durable entry
— published or converted — is `enabled: false` and replays as a no-op. `da5f719` has the identical
unconditional call, so this slice neither caused nor worsened it, and it is unreachable today: no
production writer supplies an item at all, and `toggleDisabled` routes through `resetHistoryTo` →
`APPLY_HISTORY_REPLAY`, which rebuilds the record by legacy replay. It is recorded because the
new publication makes the mismatch more consequential — a published `enabled: false` entry is
written onto a shadow the next append then trusts.

**The refusal alone does not contain it.** An earlier version of this slice refused the self-anchor
and claimed that kept the boundary and the converter agreeing. It does not: the refusal makes the
append fall back to conversion, which leaves the shadow ordered the converter's way and the
document ordered its own, and the **next** reorder then found matching layer sets and published a
normalisation of the runtime order — a third answer, in a durable document no reconversion would
reproduce. The `durableLayerOrder` sequence precondition is what actually stops it; the refusal is
the first line. `StoreContext.reorder.test.tsx` pins the two-append sequence specifically, because
the single-append case passes either way.

---

## 15a. A self-anchored reorder is refused, and the refusal is load-bearing

Retained as a tripwire. `reorderOrderAfterIntent` returns `null` for a self-anchored move, and
`history-append.reorder.test.ts` asserts the refusal **and** asserts the two disagreeing answers it
exists to avoid choosing between. Two tripwires, because either can fail silently:

- If the test ever starts passing because the two implementations were made to agree, the refusal
  becomes removable and this entry is deleted with the fix in §15 — that is, together, not before.
- If the `durableLayerOrder` sequence precondition is ever relaxed to a membership check, the
  refusal stops containing the defect: the shadow and the document keep disagreeing, and the next
  reorder publishes a third answer. `StoreContext.reorder.test.tsx` pins that two-append sequence
  and is the test that would catch it; it passes either way if only the single append is exercised.

---

## 16. An invalid document frame: conversion reports the loss, the append boundary does not

> **Conversion half fixed and verified. The append-boundary half below is untouched by that change
> and is the remaining work.** Not deleted.

**Done, and how it was verified.** `legacyHistoryToDurable` now pushes a `warning` diagnostic
naming the entry when a `SET_DOCUMENT_FRAME_ACTION` entry derives no durable operation
(`history-adapter.ts:675-681`), so the conversion no longer reports `status: 'current'` while
silently omitting a document-frame change. The severity is the decision, and it is not a detail:
`convertLegacyHistorySafely` returns `unavailable` and withholds the **whole** shadow on the first
`error` diagnostic (`history-adapter.ts:816`), so an error here would punish every unrelated entry
for a defect the legacy timeline tolerates. The archived branch's copy used `error`; that is one of
the two reasons it could not simply be ported. Verified by
`history-adapter.branches.test.ts:322` — the diagnostic, its severity and its message body — plus
that file's coverage of every falsifying branch of `isValidDocumentFrame` and three valid frames
that must still convert silently. It replaced an assertion that pinned the SILENCE
(`expect(diagnostics).toEqual([])`), which was a tripwire for this defect rather than a contract.

**Still open: the append path records nothing.** The boundary's own refusal is real and typed —
`unavailable` (`history-append.ts:81-95`) returns a `warning`-severity diagnostic (`:89`) — and
`decideDurableAppend` never re-checks the plan it is handed (`history-append.ts:641-642`). Two
things then lose it:

- A refused plan is `null`, and `if (!planned)` is the **first** precondition
  (`history-append.ts:590`), so a null planned entry yields `outcome: 'preconditions'` — never
  `'mismatch'`. `durableAppendDiagnostic` (`:663-671`) and its `durable-append-mismatch` code
  (`:668`) are produced only on the `mismatch` branch, at `StoreContext.tsx:990-994` for
  `COMMIT_DOCUMENT_EDIT` and `:922-924` for a reorder.
- The diagnostic the boundary **did** compute never leaves the boundary. All four production call
  sites destructure only two of the three result fields — `useLayer.ts:478`, `useLayer.ts:648`,
  `useSelectionHistory.ts:133` and `useSelectionHistory.ts:289` each read `entry` and `durableEntry`
  — and `diagnostics` (`history-append.ts:78`) has no slot on the `COMMIT_DOCUMENT_EDIT` payload
  (`StoreContext.tsx:235`), so it is discarded at the call site.

**User-visible failure: none today.** The only writer of this action, `applyDocumentCrop`, rejects
`width/height <= 0` (`useLayer.ts:640`) and any frame that fails `isValidDocumentFrame`
(`useLayer.ts:643`) before it plans, and a document load creates a single `OPEN_DOCUMENT_ACTION`
(`useApp.ts:122`). This is a latent observability gap, not a live bug: the day a second
`SET_DOCUMENT_FRAME_ACTION` writer appears, its refusals are as silent as these were. The far end
stays unvalidated too — `durable-replay.ts:129-131` applies `next` with no check — so the shadow
can still _hold_ an invalid frame; what changed is that conversion no longer produces one silently.

**Fix.** Two independent halves. Report the boundary's own `diagnostics`: either dispatch them on
`COMMIT_DOCUMENT_EDIT`, or fold them into `durableDiagnostics` at the point the store already
handles `mismatch`, so a refused plan is not indistinguishable from a clean one. And decide
deliberately whether a null planned entry on a translated action should be `preconditions` or
`mismatch` — today `preconditions` is **right**, because the store falls back to a full conversion
that already handles the case, and grading it a mismatch would report a writer defect for a refusal
the legacy timeline also makes.

**Files.** `src/contexts/history-append.ts`, `src/contexts/useLayer.ts`,
`src/contexts/useSelectionHistory.ts`, `src/contexts/StoreContext.tsx`

---

## 17. Duplicate durable entry id: conversion guards it, the append boundary does not

> **Conversion half fixed and verified. `decideDurableAppend` still has no uniqueness check of its
> own, and that is the remaining work.** Not deleted.

**Done, and how it was verified.** Conversion now withholds a repeated id from publication and says
so. `publishedEntryIds` (`history-adapter.ts:581`) is consulted at the publication guard (`:752`)
and a skip pushes a `warning` naming the id (`:772-778`). `warning` is the only severity the
conversion can afford, for §16's reason: `convertLegacyHistorySafely` withholds the whole shadow on
the first `error` (`history-adapter.ts:816`), and the archived branch's copy used `error`. Only ids
that actually reached `entries` consume the id (`:779-781`), so an entry that derived nothing does
not shadow a later one. Verified by the `durable entry id uniqueness` block in
`history-adapter.diagnostics.test.ts`: the conversion stays `current` (`:576`), the entries after a
repeat still convert (`:602`), the id-keyed lookup still resolves exactly one entry (`:797`), there
is one durable cursor per legacy entry (`:727`), and the frame and layer folds stay advanced
(`:742`, `:764`).

**Still open: the boundary has no uniqueness check, and the one diagnostic it can produce names the
wrong list.** `decideDurableAppend` never re-checks uniqueness. `validatePlannedDurableEntry`
(`history-append.ts:477`) compares `planned.id` to `entry.id` (`:483`) — planned-versus-**legacy**
agreement, not timeline uniqueness — and `next.entries[next.entries.length - 1] !== entry` (`:608`)
is a reference check on the same object. `freezeDurableDocument` only clones and freezes, and
`history-timeline.ts:31-32` appends unconditionally. So a duplicate id on the published path yields
a durable document with two same-id entries, and since the id is a lookup key
(`history-adapter.ts:880`, `history-timeline.ts:24`) a later toggle hits the wrong entry. The
invariant rests entirely on a diagnostic that is computed and discarded.

`validateTimeline` (`history-append.ts:278`) does check uniqueness, at `:279`, and returns an
`error`-severity diagnostic — but it reads the **LEGACY** timeline only, so it cannot see the
durable base, which is the only list the durable entries live in. It also runs after `translate`
(`:307-315`), so the diagnostic coexists with a non-null `durableEntry` by construction.

**Reachability, stated accurately.** This section previously said `planHistoryAppend` is called with
no `id`. That is **wrong**, and would not survive a check: **two of the four production call sites
do pass one.** `useSelectionHistory.ts:133` passes the `uuidv4()` minted at `:124`, and
`useSelectionHistory.ts:289` the one minted at `:277`; the other two — `useLayer.ts:478` and
`useLayer.ts:648` — pass none, so `createHistoryItem` mints one (`history-utils.ts:81`). The
conclusion is unchanged and the reason is narrower: **all four ids are a fresh `uuidv4()`**, so a
collision requires a uuid that repeats. The base's own ids are those same minted ids, carried in by
the rebuild, which is what makes `validateTimeline`'s check fire at all. Every production
`REPLACE_DOCUMENT` supplies a non-empty history.

The cursor branch is largely redundant: `decideDurableAppend` (`history-append.ts:599`) requires
`prior.cursor === prior.entries.length - 1`, so any out-of-range cursor already falls back first.

**Fix.** Return `durableEntry: null` when `validateTimeline` produces an `error`-severity
diagnostic, so the store takes the reconversion fallback. **This breaks two tests, not one.** The
plan-level case at `history-append.test.ts:504` asserts `result.durableEntry` is non-null on exactly
this collision, under the comment "reporting never blocks the append" — that is the assertion the
fix deletes. And the boundary-level block at `history-append.test.ts:1300` pins the same blindness
from the other side: it asserts `decision.outcome === 'published'` for a base whose history already
holds the id, and its own last block pins the coexistence (`expect(collidingPlan.durableEntry)
.not.toBeNull()`). Both must be re-pointed in the same change as the fix; neither may be relaxed.
Note the two are near-duplicates on purpose: the first is a statement about the plan, the second is
the alarm the fix has to trip.

**Files.** `src/contexts/history-append.ts`, `src/contexts/__tests__/history-append.test.ts`

---

---

---

## 31. The selection baseline lookup must stay unbounded over the whole timeline

**Problem.** `deriveSelectionBaseline` (`selection-baseline.ts:56`) is deliberately unbounded: it
takes the **first** non-disabled `SELECTION_ACTION` on the timeline and seeds from that entry's
`previousSelectionState` (`:57-59`), with no cursor argument at all. Both consumers take the
timeline wholesale — `history-replay.ts:68` and `history-adapter.ts:543` — so the durable baseline
and the legacy replay start from the same snapshot, which is the parity property `0659ce9`
extracted this rule to own.

Bounding the lookup by replay target looks like a correctness fix, and it was a data-loss bug until
every selection-creating gesture recorded its own entry. That precondition now holds, so **this entry
is actionable: the bound is safe to make.** Two tests still pin the unbounded behaviour as
load-bearing, not stale:

- `src/contexts/__tests__/useHistory.test.tsx:475` — "restores a cleared selection when undoing the
  tool-switch history entry". The fixture is a rename entry at index 0 and a selection-clear entry
  at index 1; `undo()` from `historyIndex: 1` replays to index 0, and the only record that the
  selection ever existed is the clear entry at index 1 — after the target. Bound the lookup and
  undoing a tool-switch deselect becomes a silent visual no-op.
- `src/contexts/__tests__/history-replay.test.ts:99` — "uses the first selection action baseline
  before it and its next state at or after it". `replayHistory(history, 0, …)` at `:126` expects the
  baseline, with the `SELECTION_ACTION` at index 1, again after the target index.

**Fix.** Bound the lookup at the replay target, and change those two tests **in the same change**:
they must be re-derived to assert a creation entry that precedes the target, not deleted to make the
bound pass. The unbounded behaviour was a live feature, so a fix that makes one of them fail without
re-deriving it has removed a user-visible capability, not corrected a pin.

Both consumers take the timeline wholesale, so the bound has to reach `deriveSelectionBaseline` (add a
cursor argument) and be threaded through `history-replay.ts:68` and `history-adapter.ts:543`
together — bounding one and not the other re-opens the parity divergence that `selection-baseline.ts`
exists to close.

**Two comments carry the stale rationale, so both must be rewritten in the same change — not one of
them:**

- `selection-baseline.ts:46-55` — the doc comment above `deriveSelectionBaseline`. The claim is at
  `:50-51`, "the first non-disabled `SELECTION_ACTION` entry's `previousSelectionState` is the only
  record that the selection ever existed", with `:52-54` restating it for the durable baseline.
- `history-adapter.ts:538-542` — the comment above the `deriveSelectionBaseline(legacyHistory)` call
  at `:543` repeats it in the adapter's own voice: "It cannot be narrowed to the pre-first-entry state
  **while a selection is created outside history**: the tool-switch clear's `previousSelectionState` is
  the only record that the selection existed." Rewriting only the first leaves the rule's owner
  corrected and its caller still advertising the reason it must not be bounded, so the next reader
  takes the call site as exempt from the bound being introduced at the signature.

**Files.** `src/contexts/selection-baseline.ts:46-59`, `src/contexts/history-replay.ts:68`,
`src/contexts/history-adapter.ts:538-543`, `src/contexts/__tests__/useHistory.test.tsx:475`,
`src/contexts/__tests__/history-replay.test.ts:99,126`

---

## 32. Every selection change now appears as a "Selection" row in the History panel

**Problem.** `getHistoryItemTitle` (`useHistory.ts:14`) special-cases a tool source (`:17-19`),
`TOOL_ACTION` (`:21-23`) and the crop (`:25`), and otherwise **falls through to the raw action
name** (`:27`). `HistoryTab.tsx:69` renders that string, so a `SELECTION_ACTION` entry is labelled
with the constant's own value.

That was invisible while selections wrote no history. It is not any more. Every one of these appends
one real entry through `commitSelection` / `clearSelections` / `appendSelectionClear`:

| gesture                                                          | append site                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Clear/Deselect control, and the tool switch                      | `useSelectionHistory.ts:212`, `useSelectionHistory.ts:95` (`useApp.ts:184`) |
| magic-wand click                                                 | `MagicWandToolArea.tsx:93`                                                  |
| rectangle drag end                                               | `RectangularSelectionToolArea.tsx:114`                                      |
| polygonal / freehand lasso close, feathered magnetic lasso close | `PolygonClickToolArea.tsx:324`, `FeatherMagneticLassoToolArea.tsx:424`      |
| polygon's committed anchor or body drag                          | `PolygonClickToolArea.tsx:758`                                              |

So every selection change in a session adds a row, and **one gesture can add more than one kind**: a
lasso gesture appends a creation and a later drag appends a separate move, both labelled identically.
Each row is also a navigation target (`resetHistoryTo(originalIndex)` at `HistoryTab.tsx:74`) and
carries a disable toggle (`:53-57`), so a user can step onto or disable a row whose label says nothing
about what it did — and there is no way to tell a creation from a move from a clear, since all three
carry the same `layerId: 'selection'` and the same action name.

**This is a UX decision, not a defect with one right answer.** The operator chooses between hiding
selection entries from the panel, grouping consecutive ones into a single row, and relabelling them
distinguishably (create / move / clear). Whichever is chosen, the label has to come from
something the entry actually carries; `nextSelectionState` and `previousSelectionState` are already
on the item (`useSelectionHistory.ts:263-273`), so a relabel is derivable without a new history
field. Do not add a history field for presentation alone while the legacy timeline is still the
replay authority.

**Files.** `src/contexts/useHistory.ts:14-28`, `src/components/SidebarRight/HistoryTab.tsx`

---

## 45. The codecs' raster ceilings disagree, and four of six have no budget at all

**What this entry is about.** A document between 80 MP and 100 MP **cannot be saved as AVIF at
all** — `saveImageToDisk` throws with the budget message and `useFile.tsx:117-151` logs it and
resolves `null`. That is the right failure (a clamp silently hands back a smaller image), and the
number was not chosen by whoever added the guard.

**Decided 2026-09-28: the 80 MP ceiling stands.** The operator was asked to choose between raising
`MAX_AVIF_PIXELS` to TIFF's `MAX_CREATABLE_DOCUMENT_PIXELS` derivation and accepting the export loss,
and chose to keep 80 MP. So **New ▸ A3 @ 1200 dpi is not AVIF-exportable in this build, by
decision** — do not "fix" that by raising the number without asking again, and do not write the
decision into `docs/OVERRIDES.md`, which is the operator's file and which records departures from
Adobe rather than this. The remaining work is the other-format gap below, not the ceiling.

**The rule that must survive.** Above a ceiling the file is **rejected with an error, never clamped
or downscaled**: a clamp silently hands the user a smaller image than the one they opened, and a
rejected file loses nothing. The TIFF byte ceiling also has a recorded provenance worth keeping —
`MAX_TIFF_BYTES` is the app's largest creatable document at 16 bytes per pixel, the largest buffer
`UTIF.decodeImage` can build for a 4-sample page (`Math.min(32, t258[0])` bits per sample,
`UTIF.js:116`, times 4 samples) — and `MAX_TIFF_PIXELS` is that same budget read at 8 bytes per
pixel, so the two agree by construction rather than by coincidence. That derivation is what makes a
different number defensible if the ceiling is ever revisited.

**Five ceilings exist and two are below what the dialog can create:**

| ceiling                             | value       | where                                                |
| ----------------------------------- | ----------- | ---------------------------------------------------- |
| largest document the app can create | 100,000,000 | `tiff-utils.ts:13` (`MAX_CREATABLE_DOCUMENT_PIXELS`) |
| affine transform                    | 67,108,864  | `affine-transform.ts:34`                             |
| PSD                                 | 67,108,864  | `psd-utils.ts:36`                                    |
| AVIF, open and save                 | 80,000,000  | `avif-utils.ts:13`                                   |
| TIFF, open and save                 | 200,000,000 | `tiff-utils.ts:23-24`                                |

The two 64 MP constants are the same number written twice, independently, in files that do not
import each other. A 100 MP document can be saved as BMP, GIF, SVG and TIFF, but not as AVIF and not
as PSD — and the PSD cap is recorded nowhere. "One exported `MAX_RASTER_PIXELS`" would have to
reconcile **five** constants, not one.

**And four of the six codecs have no budget at all, or check theirs too late.**

| codec | loader budget                   | encoder budget            | check before the allocation?                 |
| ----- | ------------------------------- | ------------------------- | -------------------------------------------- |
| avif  | yes                             | yes                       | yes                                          |
| tiff  | yes (pixels + bytes)            | yes (+ a dead byte check) | yes — the only genuine pre-decode load check |
| bmp   | **none** — bounded by file size | **none**                  | n/a                                          |
| gif   | **none**                        | 65535/axis                | **no**                                       |
| ico   | **none**                        | 1..256/axis               | **no**                                       |
| svg   | **none**                        | **none**                  | n/a                                          |
| psd   | yes                             | yes                       | yes — the reference implementation           |

The three that are actionable without an architecture decision, all in files no campaign owns:

- **TIFF's byte predictor ignores the tiled-allocation branch.** `tiff-utils.ts:89-104` is the whole
  predictor and never reads `t322` (TileWidth) or `t323` (TileLength), but `UTIF.js:132` allocates a
  **separate** per-tile buffer for a tiled page. The page
  `{t256:[1000], t257:[1000], t258:[8,8,8,8], t322:[23170], t323:[23170]}` predicts 4,000,000 bytes
  — comfortably inside the 1.6 GB ceiling — while UTIF allocates **2,147,395,600 (2.15 GB)**. A
  ~200-byte file forces a 2.15 GB allocation, through the exact mechanism `tiff-utils.ts:74-88`
  documents as the module's reason for existing. Fix: also predict
  `Math.ceil(t322[0] * t323[0] * bitsPerPixel / 8)` and return the larger; a present `t322` with a
  missing `t323` should return `null`, which `assertByteBudget:34` already refuses like over-ceiling.
- **GIF checks the ceiling after allocating the whole raster.** `gif-utils.ts:10` runs
  `getCanvasImageData(canvas)` before the `65535` check at `:14`, so a 70000×100000 canvas allocates
  28 GB before the line that would refuse it — the same ordering defect this item's AVIF half had.
  `gif-utils.test.ts:472-480` cannot catch it: it mocks `getContext` to report a width no real canvas
  has and never asserts `getImageData` was not called. Fix: hoist both checks above `:10`.
- **ICO checks the ceiling after PNG-encoding the entire canvas.** `ico-utils.ts:114` runs
  `canvasToPngBlob` before the 256 check at `:116`, so `Save as ICO` on a 10000×10000 document pays
  a full PNG encode of a 400 MP raster and then throws. The test double stubs `toBlob` with a 3-byte
  blob, so nothing detects it. Fix: move `:115-118` above `:114`.

**And one round-trip asymmetry.** ICO's loader (`ico-utils.ts:23`) validates only
`dibSize < 40 || width <= 0 || rawHeight <= 0 || rawHeight % 2 !== 0`; the 256 ceiling at `:84-85` is
used for **entry selection** only, and the geometry actually decoded is read from the DIB at `:18-19`
and never compared to 256. **A file that opens cannot be saved back.**

**BMP is the worst amplification.** `bmp-utils.ts:46-47` bounds the input by its on-disk byte length
and then allocates `width * height * 4` regardless of depth, so the ratio is exactly
`32 / bitsPerPixel` — a 20000×40000 1-bpp BMP needs 100 MB on disk and allocates **3.2 GB**, with no
absolute pixel ceiling anywhere in the file. `bmp-utils.test.ts`'s largest geometry is 7×4, so no
test can reach an interesting ratio.

**Owned, so recorded not fixed:** `image-load-save-utils.ts:113-136` is the load path for GIF and SVG
and bounds nothing — the whole file is base64-encoded into a data URL and handed to `new Image()`.
That is where a shared load-side ceiling would have to live for those two formats. Separately,
TIFF's save-side byte check at `:176` is provably dead (`MAX_TIFF_PIXELS * 4` is always below
`MAX_TIFF_BYTES`) and its message says "Decoding it" on a save; AVIF's `assertPixelBudget` has no
finite/integer guard, so a decoded `width: -5, height: -3` passes the budget and reaches
`createImageData(-5, -3)`, throwing a DOM `IndexSizeError` instead of an actionable message.

**Files.** `src/contexts/avif-utils.ts:13-19`, `src/contexts/tiff-utils.ts:8-9,74-104,176`,
`src/contexts/bmp-utils.ts:45-47`, `src/contexts/gif-utils.ts:10-16`,
`src/contexts/ico-utils.ts:18-23,84-85,113-118`,
`src/contexts/image-load-save-utils.ts:112-136`, `src/contexts/affine-transform.ts:34`,
`src/contexts/psd-utils.ts:36`

---

## Tool surface - the eraser, fill and eyedropper tranche

This file's stated scope is the durable-replay migration and the presentation/append
boundary, and tool features sit outside it. These six items are inside it anyway, and
the reason is the same one that put the earlier paint-tool-surface items here: the
branch's real plan directory is `.kilo/plans/`, which `.gitignore` excludes, so a
finding recorded there dies with the machine. This file ships with the code. Every
item below is a control that is rendered and cannot work, or a Photoshop slot that is
selectable and inert - the two shapes a silent no-op takes here - and each one names
the fix rather than the wish.

## 46. The `SidebarLeft` suites each carry their own copy of the icon mock

`src/components/SidebarLeft/__tests__/harness.tsx:1-11,64-127` is a shared render harness, and its
docstring says a suite must import it before `../SidebarLeft.tsx` so its hoisted `vi.mock` calls
apply. **Exactly one suite does** — `SidebarLeft.tablet.test.tsx:4-5`, which does it the required
way. The other ten — `SidebarLeft.cleanup`, `SidebarLeft.color-pickers`,
`SidebarLeft.context-menu`, `SidebarLeft.flyout`, `SidebarLeft.flyout-hardening`,
`SidebarLeft.icon-state`, `SidebarLeft.keyboard`,
`SidebarLeft.layout`, `SidebarLeft.primary-selection`, `SidebarLeft.rendering` — re-declare the
whole `storeState` / `toolArgs` / `useApp` / `useCurrentTool` / `toolIcons` fixture inline, so one
suite in eleven uses the harness and the mock it holds is duplicated in all ten of the others while
still having to be kept compiling.

The cost is a defect that only appears on the next tool. `toolIcons` is a hand-written object
literal listing every icon name, and `SidebarLeft` renders
`getToolIcon(tool.name)`. Add a tool and the literal is out of date, so `Icon` is `undefined` and
React throws `Element type is invalid` from `createFiberFromTypeAndProps` — in **every** file in the
directory, with a message that names neither the missing icon nor the stale literal. Adding the
four eraser-family icons meant editing the same list eleven times.

**Fix.** Delete the inline `vi.mock`/`vi.hoisted` blocks from the ten suites, import
`storeState` / `toolArgs` / `goToTool` / `patchToolArgs` / `toolbarButtonByName` from
`./harness` in each (the import must precede `../SidebarLeft.tsx`, which the harness docstring
already states, and `SidebarLeft.tablet` is the worked example), and then delete the harness's
duplicated exports. While in there, replace the
`toolIcons` literal with `import { toolIcons } from '../toolIcons.tsx'` so the list cannot go stale
again — `SidebarLeft.icon-state` needs per-name `data-icon` attributes, so it needs a
`vi.mock` that maps over the real keys rather than a hard-coded array.

**Files.** `src/components/SidebarLeft/__tests__/harness.tsx:1-11,64-127` and the ten
`SidebarLeft.*.test.tsx` files listed above.

---

## 47. `FillToolArgs.size` is written by the tool area and read by nothing

`src/tools/fill.ts:38-44` declares `size: Size` on `FillToolArgs`,
with the comment that a fill needs its layer geometry in the committed args. The seeded defaults are
`{ width: 1, height: 1 }` (`src/tools/settings.ts:196,205`), and the two fill processors take the real
size from the curried `ProcessorToolParams` — `fillLayer` destructures `params.size` (`:102`) and never
reads `args.size`. `pos` is genuinely required, because a durable `apply-raster-processor` op replays
from the stored args alone (`src/contexts/materialization.ts:282`); `size` is not, because the same
call site passes `{ bitmap, size }` separately.

So the field is a write-only trap: a tool area that forgets to write it produces a layer-sized fill
with no error, and a reader that trusts `args.size` gets `1x1`. It is also the only tool args in
the repository that carries a size — every other tool learns it from `params`.

**Fix.** Either drop `size` from `FillToolArgs` and keep only `pos`, or make the processors read
`args.size` and assert in `src/tools/__tests__/fill.test.ts` that a `pos`/`size` pair in the args
governs the raster, so the field cannot be write-only. Do not leave it as it is.

**Files.** `src/tools/fill.ts:38-44`, `src/tools/settings.ts:196,205` (the two
`size: { width: 1, height: 1 }`
defaults)

---

---

---

---

---

---

---

## 54. The durable append fast path does not reconcile asset ownership

**Problem.** `decideDurableAppend` publishes a cloned durable document directly, while full
conversion wraps asset-bearing operations in `beginDocumentAssetTransaction` / commit / reconcile
(`history-adapter.ts:830`, `:843`, `:844`). Every append family published today is asset-neutral —
`set-document-frame`, `set-selection`, `reorder-layers`, `set-layer-properties` and `remove-layer`
(`history-append.ts:499,513,534,556,589` are the five `validatePlannedDurableEntry` arms, and its
terminal refusal at `:600` is what makes the set exhaustive), none of which
`collectDurableAssetIds` scans (`history-model.ts:158-175`) — so the fast path is safe so far. The
next asset-bearing operation could publish a document without registering or retiring its raster
ownership.

**Fix.** Extend the single-writer publication path with the asset-registry transaction before
publishing the first durable operation that introduces or replaces an asset. Keep the property-only
path free of unnecessary asset work.

**Files.** `src/contexts/history-append.ts`, `src/contexts/StoreContext.tsx`,
`src/contexts/history-adapter.ts`

---

## 55. The `EXCLUDED-touched-by-prior-campaigns` manifest is not a safe boundary

**Problem.** `.kilo/reviews/2026-09-27-untouched/scope/EXCLUDED-touched-by-prior-campaigns.txt` is
what a fixer reads to learn which files a prior campaign owns, and item 39 in this file is written
entirely in terms of it. It lists 136 files (`wc -l`). Reconstructing the true set from the session store
instead — every `apply_patch` / `edit` / `write` target in a session whose `model.providerID` is
`openai`, which is 60 GPT sessions — returns **72 `src/` files the manifest does not list**, and
several of them are load-bearing for entries above:

| not in the manifest                                                                                | which entry depends on it |
| -------------------------------------------------------------------------------------------------- | ------------------------- |
| `src/contexts/history-model.ts`                                                                    | 10, 11, 12                |
| `src/contexts/durable-replay.ts`, `replay-coordinator.ts`, `replay-checkpoints.ts`                 | 1, 12                     |
| `src/contexts/psd-utils.ts`                                                                        | 7                         |
| `src/contexts/useSelectionHistory.ts`                                                              | 15, 33                    |
| `src/contexts/selection-baseline.ts`                                                               | 31                        |
| `src/components/HistoryControls/HistoryControls.tsx`, `AppKeyboardShortcuts.tsx`, `UndoButton.tsx` | 37                        |
| `src/components/SidebarLeft/toolIcons.tsx`                                                         | 46                        |
| `src/components/SaveDialog/__tests__/SaveDialog.test.tsx`                                          | 44                        |
| `src/hooks/useAnts.ts`, `src/util/canvas.ts`                                                       | 39                        |
| `src/components/Main/CropToolArea.tsx`, `TextToolArea.tsx`                                         | 22                        |

So an entry whose `Files` line names only unlisted files reads as unblocked when it is not: items 7,
10, 12, 22, 31, 37, 39, 44 and 46 all do. Item 39's own text is the tell — it says `src/tools/draw.ts`
is "**not** in the EXCLUDED list" and therefore needs coordination; it is not in the list because
the list is incomplete, not because the file is free.

**A second, live ownership axis the manifest has no notion of: 40 branches are unmerged.**
`git branch --no-merged main` returns 41, and `merge/ps-tool-expansion` alone diffs 121 files against
`main` — including `src/tools/settings.ts`, `src/contexts/layer-utils.ts`,
`src/components/Main/Main.tsx`, `toolbar-mapping.ts` and every `SidebarLeft` suite. `src/util/floodFill.ts`
is renamed to `src/util/flood-fill.ts` there, so item 49's files are mid-migration. The GPT-owned
unmerged branches are `history-presentation-lifecycle`, `history-selection-baseline-parity`,
`history-append-readiness`, `history-selection-append-support`,
`history-selection-creation-writer`, and `fix/unit-tests` (the branch that closes items 16-19).

**Fix.** Regenerate the manifest from the session store rather than maintaining it by hand, and
extend it with the unmerged-branch file set. Until then, treat "not in the manifest" as carrying no
information at all, and derive ownership the way this entry does before touching anything.

**Reproduce the 72.** The `lightshopy.com` clone is the reason both path prefixes and the
`edit`/`write` tools are in this, not just `apply_patch`:

```bash
GPT="SELECT id FROM session WHERE json_extract(model,'$.providerID')='openai' OR json_extract(model,'$.id') LIKE '%gpt%'"
{ sqlite3 ~/.local/share/kilo/kilo.db "WITH g AS ($GPT) SELECT json_extract(p.data,'$.state.input.patchText') FROM part p JOIN g ON g.id=p.session_id WHERE json_extract(p.data,'$.tool')='apply_patch'" 2>/dev/null \
    | perl -ne 'while(/\*\*\* (?:Update|Add|Delete) File: (\S+)/g){ print "$1\n" }'
  sqlite3 ~/.local/share/kilo/kilo.db "WITH g AS ($GPT) SELECT json_extract(p.data,'$.state.input.filePath') FROM part p JOIN g ON g.id=p.session_id WHERE json_extract(p.data,'$.tool') IN ('edit','write')" 2>/dev/null
} | sed -e 's#^/Users/bkalynovskyi/ph/##' -e 's#^/Users/bkalynovskyi/WebstormProjects/lightshopy\.com/##' -e 's#^\.kilo/worktrees/[^/]*/##' \
  | sort -u > /tmp/gpt_paths.txt
comm -23 /tmp/gpt_paths.txt <(sort .kilo/reviews/2026-09-27-untouched/scope/EXCLUDED-touched-by-prior-campaigns.txt) | grep '^src/' | wc -l   # -> 72
```

`session.model` is a TEXT column holding JSON, so the filter is `json_extract`, not a plain column
comparison. Dropping the clone prefix lowers the count to 39, which is how a `grep -rn lightshopy`
over the store misses a third of the corpus.

**Verified by cross-check, not assertion:** the reconstruction also audited the other write vectors
and found them clean — of 974 `bash` calls in GPT sessions there is no `sed -i`, `perl -i`, `tee`,
`patch`, `git apply` or shell redirect that writes a tracked file. The only files the tool-call
reconstruction misses are `package.json` and `package-lock.json`, via `npm install ag-psd` and
`npm uninstall @floating-ui/react`. Note also that `/Users/bkalynovskyi/WebstormProjects/lightshopy.com`
is a **clone of this same repository** (identical `origin`, and this HEAD is a descendant of its
`1ddc968`), so 317 of those commands target this codebase from another path and a
`grep -rn 'lightshopy'` on the session store misses them.

**Files.** `.kilo/reviews/2026-09-27-untouched/scope/EXCLUDED-touched-by-prior-campaigns.txt` (not
tracked; gitignored under `.kilo/`), and the `Files` line of every entry named in the table above.

## 56. Layer opacity has no writer, and the obvious one is discarded by replay without a word

**Problem.** `Layer.opacity` is a required field (`src/contexts/layer-types.ts:58` — the `Layer`
type moved out of `tool-types.ts`, which now only carries the tool-args types),
PSD import populates and validates it (`src/contexts/psd-utils.ts:159,229`), and
`materialization.ts:162` applies it to the document frame. Nothing in the app ever
writes it. There is no opacity control in the desktop shell, and the mobile layers
drawer had one that was removed rather than shipped broken.

**Why the obvious implementation is wrong.** A slider would reach for
`updateLayer(id, { opacity }, TOOL_ACTION)`, because that is the signature every
other layer property write uses (`src/contexts/useLayer.ts:473`). It fails three
times, all silently. `updateLayer` only plans a durable append when
`isSetLayerPropertiesAction(actionName)` is true, and `TOOL_ACTION` is not in that
whitelist, so the entry never gets a durable translation. `history-replay.ts:166`
reads `if (!layer || !toolArgs?.toolName) continue;`, and a property patch carries
no `toolName` in its args, so legacy replay skips it and the document after an undo
diverges from the document before. And `getHistoryItemTitle`
(`src/contexts/useHistory.ts:22`) returns `(args as ToolArgs).toolName` for a
`TOOL_ACTION`, which is `undefined` here, so the history panel grows an untitled row
per step. A slider drag writes one of each per step: dragging the handle to 50% would
leave ~100 untitled, unreplayable entries in the timeline.

**Fix — a real action, added to the existing layer-property path.** The rename /
show / hide writer already reaches the append boundary, and it does so through a
single canonical derivation that both conversion and the live writer share. Opacity
belongs there, not in a hand-rolled arm, and not in `TOOL_ACTION`. Five places:

- `src/util/constants.ts` — a `SET_LAYER_OPACITY_ACTION` next to
  `SHOW_LAYER_ACTION`/`HIDE_LAYER_ACTION`/`RENAME_LAYER_ACTION`.
- `src/contexts/history-model.ts:80` — add `opacity` to
  `DurableLayerPropertyPatch`. The type is `Readonly<…>`, which is deliberate: it is
  what stops a writer smuggling an arbitrary `Partial<Layer>` through the append
  boundary as a patch the validator then has to re-derive.
- `src/contexts/history-adapter.ts:355` and `:387` — add the action to
  `isSetLayerPropertiesAction` and give `deriveSetLayerPropertiesEntry` its branch.
  Adding it to the first without the second makes `updateLayer` plan an append that
  resolves to no durable entry, and it silently falls back to the raw patch.
- `src/contexts/history-replay.ts:132-141` — the legacy arm beside the
  show/hide and rename arms, writing `{ ...layer, opacity }` the way those write
  `visible` and `name`. This is the arm that made the `TOOL_ACTION` route wrong, and
  without it undo/redo leaves the document inconsistent.
- `src/contexts/useHistory.ts:14` — a real title. Not a correctness fix: the
  `return actionName` fallback at `:27` already yields a non-empty string for a
  purpose-built action, so the `undefined` above is specific to `TOOL_ACTION`. It
  matters because `SHOW_LAYER_ACTION` and friends already render their raw constant
  name in the History panel, and a fourth raw constant is a worse answer than a
  fifth proper title.

`updateLayer` itself needs no change: given a whitelisted action it already replaces
the caller's patch with the canonical one from the planned durable entry.

There is no longer an `UPDATE_LAYERS` shortcut to avoid: it was removed as an unguarded
second writer surface, so `updateLayer` with a whitelisted action is the only way to set a
layer property.

**Files.** `src/contexts/layer-types.ts:58`, `src/contexts/useLayer.ts:473`,
`src/contexts/history-model.ts:80`, `src/contexts/history-adapter.ts:355,387`,
`src/contexts/history-replay.ts:132-141,166`, `src/contexts/useHistory.ts:14,22`,
`src/contexts/psd-utils.ts:159,229`

## 57. The mobile shell has no colour control at all

**Problem.** The desktop rail carries the foreground and background swatches, a swap
and two native colour inputs (`src/components/SidebarLeft/SidebarLeft.tsx:1108-1123,1125-1140,1143-1150`).
The mobile shell has no equivalent: no swatch, no swap, no `<input type="color">`, and
no colour picker. So on a phone the drawing, shape, paint-bucket and colour tools all
use whatever colour the document happened to be created with, and the foreground colour
cannot be changed at all.

An earlier draft of this feature carried a `MobileColorPalette` component. It was
never imported by anything, so it shipped no reachable UI while its own test file
passed against the component in isolation. It was deleted rather than wired, because
choosing which tools expose it is a design decision on the lowest-priority surface in
the app, and shipping an unreachable one is worse than shipping none.

**Fix.** Port the desktop's swatch pair and swap into `MobileBottomBar` or
`MobileLayersDrawer` — it is one `useStore` read of `color` and `backgroundColor`,
and the same two hidden `<input type="color">` elements, so the colour model stays
whatever the desktop uses. A richer picker (a palette, a hex field) is a separate
decision. Note the swatches are 32px in the desktop rail; on a touch surface they need
the same 44px floor as the other mobile controls, which is why they should be built
for mobile rather than copied across.

**Files.** `src/components/SidebarLeft/SidebarLeft.tsx:1108-1123,1125-1140,1143-1150`,
`src/components/Mobile/MobileBottomBar.tsx`, `src/components/Mobile/MobileShell.tsx`

---

## 58. A single brush stroke makes the durable document un-materializable, and it voids the whole document

**Problem.** `convertSource` (`history-adapter.ts:166-171`) routes a layer source's `args.toolName`
to `text` or `vector` for exactly two cases — `'text'`, and the six shape names — and to
`legacy-tool` for everything else. `materialization.ts:156` throws on `legacy-tool`
**unconditionally**, and `materializeDocument` releases every taken lease and rethrows (`:347-350`),
so a single unconvertible layer voids the entire document rather than itself.

`useLayer.ts:287` writes `args: { ...args }` from the concrete tool, so `args.toolName` is
`'brush' | 'pencil' | 'color-replacement'`, never `'draw'`. **All three painting tools take the
`legacy-tool` route.** The second thing a user does in a session is draw a stroke, so this is not a
latent shape of the cutover — it is what the cutover would do.

The irony worth recording: `toolProcessors.draw` at `toolProcessors.ts:152-158` is a genuine `creator: true`, so a
deterministic creator for exactly this exists and is simply unreachable, because the adapter never
routes to it.

**Latent today** — `materializeLayer`/`materializeDocument` have no production caller (item 1). That is
the only reason this is P1 rather than P0, and it is the same reason item 1 should not be treated as
one wiring step.

**Fix.** Either route those three tools to a typed source via the existing `draw` creator, or make
`materializeDocument` isolate per-layer failure — materialize the rest, record the failed layer — so
one unconvertible layer cannot void a document. The second is worth doing regardless: the
whole-document rethrow at `:347-350` is what turns any per-layer defect into a total one.

**Test that fails without the fix.** A brush history item through `legacyHistoryToDurable` must not
yield `source.kind === 'legacy-tool'`. And `materializeDocument` over a replay containing a brush
layer plus two good layers must resolve with the good layers present.

**Files.** `src/contexts/history-adapter.ts:144-185`, `src/contexts/materialization.ts:156,347-350`,
`src/contexts/useLayer.ts:287`, `src/tools/toolProcessors.ts:152-158`

---

## 59. Five selection tools claim `creator: true` and cannot create anything

**Problem.** `materializeLayer` trusts the `creator` flag as its only gate
(`materialization.ts:174`). **Five** `commit: 'selection'` entries claim it — `polygonal-lasso`
(`toolProcessors.ts:177-183`), `freehand-lasso` (`:184-190`), `rectangular-selection` (`:203-209`),
and, added after this entry was first written, `elliptical-selection` (`:216-222`) and
`quick-selection` (`:223-229`). All five processors are pass-throughs over a `bitmap` that is
`undefined` on a creator call:

```ts
export const rectangularSelection =
  ({ bitmap }: ProcessorToolParams) =>
  () => [bitmap];
```

- `rectangular-selection`, `elliptical-selection` and `quick-selection` → `[undefined]`, caught by
  `if (!created) throw` (`:179`), message blames the tool. `ellipticalSelection.ts` and
  `quickSelection.ts` are the same pass-through, so the second and third fail identically.
- `polygonal-lasso` / `freehand-lasso` with empty `points` → `copyPolygonToCanvas` returns a **1×1
  canvas**, which is truthy, so the guard **accepts it** and the layer silently materializes blank.
  With non-empty points it throws an unrelated `SelectionCanvasContextError`.

**Why this is a landmine rather than a typo.** The flag is currently unreachable from production
precisely _because_ item 58's throw fires first. So the lie is invisible today and becomes live the
moment item 58 or item 1 is fixed — which makes it a trap laid for whoever does that work.

**Fix.** Drop `creator: true` from all five. They are `commit: 'selection'` mutators, not creators.
Every genuine creator was checked and honours its curried `params.size`; a repo-wide grep for
`Math.random|Date.now|new Date(|performance.now|crypto.` across `src/tools/` returns **zero**, so the
flag is a sound determinism signal wherever it is honestly set.

**Test that fails without the fix.** For every entry claiming `creator: true`, call
`imageProcessor({ size: { width: 8, height: 8 } })(args)` and assert a returned bitmap with finite
`width`/`height` ≥ 1. Fails today for all five, and for none of the honest creators.

**Three pins assert the current roster, and each is a tripwire by its own admission.**
`tool-processors.test.ts:262-284` hard-codes the 13-name creator roster including all five and
asserts `expect(['source', 'selection']).toContain(commit)`, so it passes on the lie rather than
catching it; `:985-999` records it in prose — "Both lasso tools are flagged creators, yet
`selection` reads `bitmap` … The behaviour is pinned here so the registry/param-type mismatch stays
visible"; and `:367-368` names the two newer offenders. Delete or re-point all three in the same
change as the fix.

**Files.** `src/tools/toolProcessors.ts:177-229`, `src/tools/selection.ts:15-19`,
`src/tools/rectangularSelection.ts:9-13`, `src/tools/ellipticalSelection.ts:20-24`,
`src/tools/quickSelection.ts:24`, `src/contexts/materialization.ts:173-179`

---

## 60. The gesture gate still has one claim site that can strand the keyboard

`PolygonClickToolArea.captureSelectionPointer` writes `selectionPointerIdRef.current` **before** it
calls `claimDocumentGesture(...)` and discards the claim's return value — the same shape the
freehand branch had until the review behind this branch proved it exploitable there: a second
pointer took the ref, so the first pointer's claim could never be released, and every
document-mutating shortcut stayed dead until a page reload.

It is **not** exploitable today, and the reason is not the code. Every press runs
`abortSelectionDrag()` first, which always closes this component's own claim, and
`polygon-selection` has no second claimant. It is recorded because the protection is an accident of
the current press routing rather than a property of the function, and the freehand twin was one line
away from the same failure.

**A leak is now more expensive than when this was written (2026-09-28).** The gate used to cover the
keyboard only, so a stranded claim cost the keyboard. It now also covers the Undo and Redo buttons,
the history-list row clicks, and the history entries' enabled-state toggles — five `useHistory()`
call sites in all. One leaked claim therefore disables undo, redo, rewind and step-toggling at
once, and the only recovery is a remount. **`claimDocumentGesture` returning `false` must be honoured at every
call site**: take the ref, and any state flag, only when the claim succeeds — as `DrawToolArea`,
`ShapeToolArea`, `EraserToolArea`, `MoveToolArea` and the freehand branch now all do.

## 62. The error boundary's fallback loses the region's own sizing and grid cell

`ErrorBoundary`'s fallback renders a bare `div` with no `grid-area` (`ErrorBoundary.tsx:52-56`),
while the regions it replaces are `[grid-area:main]` (`Main.tsx:358`) and `[grid-area:right]`
(`SidebarRight.tsx:321`). Its props are a human-readable `label` and the `children` it has already
replaced (`ErrorBoundary.tsx:5-13`), so it does not know which region it wrapped.

**The auto-placement half of the original claim is wrong, and the consequence is different.** The
grid template at `App.tsx:82` names `header`, `toolbar`, `left`, `main`, `right` and `footer`, but
`header` and `toolbar` are claimed by `DesktopHeader.tsx:172` and `ToolbarHorizontal.tsx:5`, both
rendered by `Menu.tsx:7-8` **before** the boundaries in document order — so auto-placement does not
start at the toolbar row. With `left` claimed by `SidebarLeft.tsx:1026`, the first free cell in
document order is row 3 col 2, which is exactly the canvas's own cell; the second boundary's
fallback then takes `right`. On mobile the template collapses to `'header'`/`'main'`/`'bottom'` with
`main` again the first free cell. Both messages land in the right cells.

**What genuinely remains** is the sizing: the fallback also drops the region's own
`relative overflow-y-auto` (`Main.tsx:358`), so the canvas's message renders content-height instead
of filling the cell.

**Fix.** A new optional `gridArea` prop **plus** the two `App.tsx` call sites (`:92`, `:96`), and the
sizing class alongside it. Do not add the prop without them — an always-`undefined` prop is worse
than the current auto-placement, which at least lands in the right cell.

**Files.** `src/components/Common/ErrorBoundary.tsx:5-13,52-56`, `src/App.tsx:82,92,96`,
`src/components/Main/Main.tsx:358`, `src/components/SidebarRight/SidebarRight.tsx:321`

## 63. The presentation scope's liveness set assumes an invariant it does not enforce

`collectLivePresentationBitmaps` (`StoreContext.tsx`) walks layer records and history entries to
decide which rasters are still reachable, and `retireUnreferenced` closes everything else the scope
published. `AssetRegistry` holds a **borrowed** reference to those same rasters
(`history-adapter.ts`) and hands them to `materializeLayer` through `resolve()`, and nothing in the
retirement path checks that a registry-held raster is derived from a layer record or history entry
the liveness set scans. If a raster ever enters the registry from a source the store cannot reach,
`retireUnreferenced` will close it while a materialization still holds it.

This is an unstated invariant, not a demonstrated defect — no such entry is known to exist, and
`history-replay` reads its sources from `nextState.layers` and `nextState.history`, which are both
scanned. It is recorded because item 54 is about the durable asset registry and this is its
presentation-scope twin: whoever fixes 54 should not leave this one unexamined, and the invariant is
cheapest to pin as a test now.

## 64. `useDrag` has no importer anywhere in `src`

`src/hooks/useDrag.ts` is exported, has its own test file, and is referenced by nothing outside them.
Its sibling `useRect` is used by four tool areas. Dead code a reader must still evaluate on every
change, and a plausible future source of a second drag implementation. Deleting it means deleting
`useDrag.test.ts` with it. Re-derive the grep before acting, because a worktree-local import would
not be visible from `main`.

## 66. A refused pointer gesture is a silent no-op on the document

`src/hooks/usePointerPosition.ts:194-229`, and every tool area that calls its
validators as a bare guard.

`isPointerDownValid` refuses a non-primary button, refuses any press while
`activePointerId` is already set, and only then records the id and takes pointer
capture. `isPointerUpValid` refuses a non-primary release and a release whose id
does not match, and only then clears. Both return `false` and nothing else. Every
caller treats that as "this gesture is not mine" and returns early — with no
log, no thrown error, and no entry in the store. `DrawToolArea` is the clearest
case, because the commit lives in `handlePointerUp` and nowhere else
(`src/components/Main/DrawToolArea.tsx:110-143`), so a refused release means the
whole stroke vanishes: no layer, no history entry, no pixels, and the tool
overlay cleared anyway by `:146`.

That silence is the defect, and it is separate from any particular race. Every
other writer in this codebase either publishes a history entry or reports; a
gesture that is dropped reports nothing at all, so a lost stroke and a
successfully drawn one are the same observable state. Two callers are already
known to need a reason for a refusal and cannot get one:
`EraserToolArea.tsx:142-145` comments that a release the validator refuses must
not hand the document back, which is only checkable by instrumenting the
validator; and `TEST-FLAKES.md` §8 records an e2e failure that surfaced as a bare
ten-second pixel timeout against a canvas that was never going to change, which
is this shape seen from outside the browser. **Whether a refusal has ever
actually fired is not known** — this is an unstated invariant with no
demonstrated occurrence, recorded as §63 is, and the cheapest thing that would
settle it is a `console.warn` carrying the reason at each of the four early
returns, which is a product decision rather than a test one.

---

## 67. Five of the six shape-family tools never receive the store colour

**Problem.** `src/components/ToolbarsRight/Figures/Shape.tsx:31-34` mirrors the foreground and
background swatches into the tool's args, but gates the mirror on `args.toolName === 'shape'`
(the test is at `:32`). `src/tools/toolsMap.ts` routes all six shape-family tools to that one
component — `shape` at `:63`, and `rectangle`, `ellipse`, `triangle`, `polygon`, `line` at
`:154-158` — while `src/tools/settings.ts` gives each of those five its own `toolName` in its
default args: `:276`, `:283`, `:290`, `:297`, `:304`. The guard therefore returns for every one of
them, and their args stay frozen on the hardcoded `color: '#000000'`. Only `shape` itself, whose
default is `toolName: 'shape'` at `src/tools/settings.ts:80`, passes. Moving the foreground swatch
therefore changes the toolbar preview for `shape` and nothing at all for the other five, and the
committed layer is black in all five cases.

The fill half is the mirror's own doing, and it is the more visible half. For the one tool the
effect does run on it mirrors **both** swatches, and `src/tools/shape.ts:144-145` fills with
`backgroundColor` — `if (hasFill && backgroundColor) { ctx.fillStyle = backgroundColor; }` — where
the store's background swatch defaults to `'#ffffff'` (`src/contexts/StoreContext.tsx:325`). So
ticking "Filled" paints white, and the shape reads as an outline with a transparent interior on a
white document. The only way to change the fill colour is to move the **background** swatch, which
is shared with the eraser, the bucket and every other tool that uses it.

`ShapeToolArea`'s preview draws from these same args, so a swatch that never arrives shows as a
wrong preview before the commit as well as a wrong layer after it.

**Fix.** Decide what a filled shape should fill with, then make the guard match. The obvious shape
is to drop the `args.toolName === 'shape'` condition and mirror on `args.toolName` membership in
the six-tool set, and to give the fill its own control rather than borrowing the background swatch.
The second half is a product decision, not a bug fix — the operator has already ruled that shape
fill should follow Photoshop's model, which is a dedicated Fill swatch, so this item reduces to
implementing that and then widening the guard.

**Files.** `src/components/ToolbarsRight/Figures/Shape.tsx:31-34`, `src/tools/toolsMap.ts:63,154-158`,
`src/tools/settings.ts:80,276,283,290,297,304`, `src/tools/shape.ts:144-145`,
`src/contexts/StoreContext.tsx:325`

---

## 68. A committed shape is painted twice, and nothing removes the overlay

**Problem.** `src/components/Main/ShapeToolArea.tsx` never clears the tool overlay during a gesture,
not even on a successful commit. `handlePointerUp` (`:140`) ends with a `flushDrawingFrame()`
(`:174`), whose last act is clear-and-**redraw** (`:74`, `:82-88`), and `createLayerFromTool(fullArgs)`
(`:200`) then commits it as a layer while the overlay keeps the painted shape. For as long as the
shape tool stays selected the same shape exists twice: once in the document, once on the overlay
above it. Only the unmount cleanup at `:239-241` clears it, so it disappears on a tool switch, which
is not the same thing as not painting it.

The file says so itself, at `:228-238`: "This area never clears the overlay on pointer up at all:
`handlePointerUp`'s last `flushDrawingFrame` REDRAWS the shape and the commit at :200 leaves it
there … without it the preview stays painted over the next tool's document — and over this one, for
as long as the shape tool stays selected."

**A unit test now pins the double paint**, which is a finding in its own right:
`ShapeToolArea.test.tsx:1141` is titled "clears the preview a committed shape leaves painted, which
nothing else removes", its comment at `:1158-1162` reads "The shape is now a layer AND is painted
twice", and it asserts `clearRect` is called **exactly once** — only at unmount (`:1167-1168`). **A
fix must delete that test in the same change**, per `AGENTS.md`: a pin left behind turns the fix
into a red suite.

**Fix.** Clear the overlay as part of the commit, after `createLayerFromTool`, so the committed layer
is the only copy. Do not add a second `clearRect` inside `flushDrawingFrame` — it is the batched
draw path and clearing there would blank a frame that has not been committed yet (`:137` re-arms it).

**The coordinate-space half of the earlier version of this entry was wrong, and the suite already
covers what it claimed was uncovered.** `ShapeToolArea.test.tsx:68-69` defines a deliberately
non-zero `DOCUMENT_FRAME` and `beforeEach` at `:209` installs it, so every test in the file runs
under a frame. `:740` ("computes the committed bounds from the same geometry the preview draws")
asserts at `:766-775` that the committed `start`/`end` equal the preview's **plus** `DOCUMENT_FRAME`
minus `pos` — preview in canvas space, commit the same geometry in document space. §132 derives that
same division of labour, and §68's "they can disagree" claim is refuted by a passing test.

**Files.** `src/components/Main/ShapeToolArea.tsx:70-88,137,140,174,200,228-241`,
`src/components/Main/__tests__/ShapeToolArea.test.tsx:1141-1168`

---

---

---

---

## 72. A duplicated `/**` makes `DrawToolArgs.composite`'s doc comment a comment about itself

`src/tools/draw.ts:15-16` opens two block comments back to back. JavaScript block comments do not
nest, so the second `/**` is swallowed as comment text and the `composite` field's documentation is
malformed from its first line. It parses, no line number moves, and every test in the tree passes —
which is why nothing reports it.

It matters because the field's real comment is load-bearing prose rather than decoration: it names
`setupDrawCtx` as the single place both the live preview and the committed raster read, names the
`e2e/export/visual-regression.spec.ts` baselines that depend on the absent case writing
`source-over`, and explains why a legacy stroke still renders as it did. Anyone re-deriving a
citation from that comment reads a comment that starts `/**` and has to work out what it was
supposed to say. Found while researching `draw` for `docs/TOOLS.md`, where the resulting
misreading is recorded as a caveat rather than acted on: deleting line 16 shifts every line below
it, and three `file:line` citations into this file in the description record were written against
the current numbering.

Fix is deleting line 16, then re-deriving any citation into `src/tools/draw.ts` below it.

---

## 73. Two Colors sliders moved in one frame: the first change is silently dropped

**Problem.** `Color.tsx`'s `throttledOnChange` (`src/components/ToolbarsRight/Colors/Color.tsx:28-41`)
stashes the whole args object in `pendingUpdateRef` and writes it from a
`requestAnimationFrame` callback. Each of the three handlers builds that object from
the **render-time** `args` closure — `handleGrayscaleChange` at `:43-46`,
`handleSepiaChange` at `:48-51`, `handleSaturationChange` at `:53-56` — and none of
them reads the pending value. So two slider changes that land in the same frame are
both built from the same stale `args`: the second object carries the new second
value over the **old** first value, and the first change is gone. The rAF does not
queue, so nothing merges them either.

Reproduced in a real browser as well, but that reproduction is not the evidence —
it is a single observation, not a deterministic one. Two `page.locator().fill()`
calls on a range input are two CDP round trips, so whether a frame lands between
them is timing, and a run that happens to straddle one will not lose the edit. In
one measured run the first pass lost the grayscale value and the second and third
kept it, which is the shape a race has and is worth knowing for. **The evidence is
the jsdom tests below**, which drive the handlers directly and cannot miss it.

**The behaviour is already pinned, and pinned on purpose.** Two tests in
`src/components/ToolbarsRight/Colors/__tests__/Color.test.tsx` assert the loss:

- `'coalesces a burst of changes across different sliders into one frame'`
  (`:187`) fires all three sliders before the stubbed rAF and expects
  `{ grayscale: 0, sepia: 0, saturation: 30 }` — the first two gone. Its own
  comment says this documents the lost-update behaviour "rather than a merge".
- `'drops the earlier in-frame edit when two different sliders move before the
frame runs'` (`:213`) fires grayscale and sepia and expects
  `{ grayscale: 0, sepia: 20 }`.

So **fixing this turns both tests red, and flipping those two assertions is part
of the fix rather than a gate being weakened** — they currently encode the defect
as the expected result, which is what a characterisation test does. Whoever does
this should say so in the commit, because "two unrelated Colors tests started
failing" otherwise reads as a regression.

**Fix.** Make the pending object the source of truth for the next one, rather than
the render closure:

```ts
const base = pendingUpdateRef.current ?? args;
pendingUpdateRef.current = { ...base, grayscale };
```

Every handler builds on `base`, so a second change in the same frame inherits the
first instead of discarding it. `pendingUpdateRef.current` is cleared in the rAF
itself (`:36`) and in `discardAdjustment` (`:115`), so it holds exactly the
unpublished edits, and `args` is the right fallback for the first change of a
frame. Worth checking `Blur.tsx` and `Levels.tsx` for the same shape — they were
not audited here.

**Test that fails without the fix.** The two above. A test that waits on each
control's accessible name between the two changes cannot see this, and must not:
it is a race, and the test for a race is the one that does not wait.

**Files.** `src/components/ToolbarsRight/Colors/Color.tsx:28-56`,
`src/components/ToolbarsRight/Colors/__tests__/Color.test.tsx:187,210`

---

## 74. The toolbar is a Photoshop clone, and 45 of 49 rail entries are wrong

**Not a defect — a standing product requirement, recorded with its cost.** `AGENTS.md` now carries
"The toolbar is a Photoshop clone — HARD REQUIREMENT". This entry is the implementable target, the
corrections to the research behind it, and the sequencing.

**The requirement.** The Tools rail must mirror Adobe's Tools panel: same tools, same rendered
names, same groups, same letters. A tool Photoshop does not have is **deleted, not relabelled** —
the app already has the Brush, which is `draw`'s nearest. Adjustments and transforms are
`Image ▸ Adjustments` and `Edit ▸ Transform` commands and leave the rail entirely. The registry
identifier stays free (`reposition` for the Move tool is fine); the **rendered label** does not.

**Shape of the work: 41 `ToolName`s → 70, in 21 tiles. 36 present, 34 to add, 5 to delete.**

**Four corrections to the inventory in `AGENTS.md`, from a second research pass. Read these before
building the target list — the list as written ships a rail that is still not a clone.**

| `AGENTS.md` says                                                              | Actually                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection Brush is "Photoshop on the web, not the desktop panel" — exclude it | Adobe's own **desktop** page says "Select the Selection Brush tool **from the toolbar**". Include it.                                                                                                                                                                                                                                                                                  |
| Adjustment Brush has "zero Adobe pages" — exclude it                          | Two Adobe pages, "Select Adjustment Brush Tool **from the toolbar**". Include it; it is a large _feature_, which is a different decision from membership.                                                                                                                                                                                                                              |
| —                                                                             | **Remove tool** and **Content-Aware Tracing tool** are absent from the list entirely. Both are Adobe-documented, and the Remove tool's page says "In the Tools panel, select Remove tool." A sweep of Adobe's _overview tables_ misses both, because each has its own page instead. Content-Aware Tracing's own page confirms its **group**: "from the Pen tool group in the toolbar". |
| —                                                                             | **Artboard, Frame, Perspective Crop, Slice, Slice Select, Ruler** are also absent. All are in Adobe's own shortcut PDF.                                                                                                                                                                                                                                                                |
| §68 below points at this section                                              | The `AGENTS.md` pointer named a section that did not exist. It exists now.                                                                                                                                                                                                                                                                                                             |

Two that must **not** be added despite appearing in the shortcut PDF: **3D Material Eyedropper** and
**3D Material Drop** (the removed 3D feature), and **Rounded Rectangle** (CC-era, in neither 2026
enumeration). And the trap that produced the Clone Source false positive: **Adobe's Clone Source is
a panel** (`Window ▸ Clone Source`), not a Tools-panel entry. A name appearing in a panel's title is
how a tool gets miscounted.

**Group order is a hypothesis, and the requirement says so.** Adobe publishes no page that
enumerates the Tools panel top-to-bottom. The 21-tile order is reconstructed from two independent
third-party 2026 diagrams, cross-checked against Adobe for **membership only**. Four placements are
unresolved and a screenshot of a restored PS 27.x default workspace settles all four: the Frame
tool's separator (its own tile, but does it close the Crop band or open Measurement?);
Content-Aware Tracing's slot inside the Pen flyout; **Line before Star or Star before Line** in the
Shape flyout (one line, and a line a user's hand learns); and whether Note and Count are in the
default panel or sitting in Extra Tools.

**`toolbar-mapping.ts:30-36` says "Unsupported Photoshop tools are intentionally omitted rather
than represented by placeholder values." That sentence IS the requirement, and it has to be
deleted, not kept.** Separately: `SidebarLeft.tsx:130` does `toolbarMap.flat()`, which discards the
map's section boundaries entirely, so the five current sections are not Photoshop's separators and
the new layout has to decide deliberately whether a section concept survives at all.

**Deletions, cheapest first.** `color`, `levels` and `transform` become menu commands; their
processors are reused unchanged, so this is a **routing** change, not a processing change, and the
history and durable paths are untouched. `shape` dissolves into the five figure `ToolName`s that
already have processors and are already dispatched. `draw` is last and is the expensive one: it is
the suite's default way to make a mark, **25 call sites across 14 e2e specs**, and
`e2e/pen-types.spec.ts` is specifically about it and dies with the tool. Its engine does not die —
`brush`, `pencil` and `color-replacement` are all built on `buildDrawArgs` and `draw()` — only the
tool goes, and the engine should be renamed to stop pretending to be one.

**Cheapest real additions**, and they are parallelisable because they touch disjoint files: Single
Row and Single Column Marquee (SHIPPED 2026-10-01, `src/tools/singleRowColumnMarquee.ts`; the
phrase "two lines of geometry reusing `rectangularSelection`" held up), Sponge, Red
Eye, and Star (a new `FigureType` member plus a star-ratio branch). Next cheapest architecturally
is the measurement band — Color Sampler, Ruler, Note, Count — because these are `PIXEL_FREE_TOOLS`
like the Eyedropper, committing no pixels and needing no durable operation.

**Largest, and they need a primitive the app does not have:** Object Selection, Spot Healing,
Content-Aware Move, Remove (a generative backend), History Brush and Art History Brush (a read-out
across the whole history array, which touches the replay boundary), Vertical Type and its two
masks (glyph→selection rasterisation), Path Selection and Direct Selection (a path model absent
from `src/tools/shape.ts` entirely), and Artboard and Frame (layer kinds the app has no type for).

**One step is a baseline hazard and belongs on its own branch:** Hand, Zoom and Rotate View. The
app's zoom state is commented out (`StoreContext.tsx:1171-1175`; `ZoomData` survives only as a
type), so the seam exists and the state does not. It is small in lines and large in blast radius,
because it touches the renderer and every e2e screenshot baseline.

**The first step is the highest-value thing in the plan and it is not a feature:** land the target
as data, and add a test asserting the **set of rail labels** equals the target set — not the order,
not the tiles. Any future invented tool fails it. It is cheap, and it is the tripwire that makes the
other eight steps safe.

**What this costs in tests, before a single tool is added.** The hand-copied lists are the expense,
and they are already drifted: `src/util/__tests__/constants.test.ts:106-136` holds a hand-copied
29-name list that is **12 short of the real 41** and passes only because its assertion is
`toContain`. `toolIcons.test.tsx:25-72` holds a 46-name union by hand; `tool-processors.test.ts`
carries four separate 41-name and 10-name rosters; `SidebarLeft.rendering.test.tsx:123-140` pins
the exact 16-tile order by name; and `toolbar-mapping.test.ts:101-103` compares a hand-copied
expected shape flyout with `toEqual`, so **an added key on any shape entry breaks it**.
`AppKeyboardShortcuts.tsx:9-16` asserts in prose that its cycle groups match the mapping's groups;
**three of its seven do not** — the Pen tile is six wide and its cycle is three, the shape tile is
six wide and its `Shift+U` cycle is four, and `Shift+U` from the Triangle or Polygon does not skip
them but **restarts** at the rectangle. Nothing tests that claim. And `availableTools` /
`extraTools` have **no production consumer at all** — only tests read them — so a silent omission
there produces three green tests over an incomplete app.

## 76. A closure check reported "3 FIXED" for work that was already fixed before it ran

A verification pass was asked to confirm that 45 identified defects had been closed, and it
reported **3 fixed, 41 absent, 1 regression**. All three "fixed" verdicts were wrong, in the same
direction and for the same reason: the pass was given the _merged_ tree, where `main` had already
absorbed the corrections, and compared it against nothing. It read the presence of a correct value
as the work of a fix that had not happened there.

Re-derived against the actual pre-fix commit `13f44a1`, all three were already correct:

| Reported as fixed by the fix pass               | Actually already true at `13f44a1`          |
| ----------------------------------------------- | ------------------------------------------- |
| color-replacement `placeholder` → `partial`     | `'partial'` already, `paint.ts:301`         |
| rectangle and ellipse `implemented` → `partial` | `'partial'` already, `shape.ts:199,226`     |
| levels black/white point `partial` → `missing`  | `'missing'` already, `transform.ts:301,315` |

So the honest tally of that closure check is **0 fixed, 42 absent, 1 regression** — it was
measuring the tree, not the diff. The regression it _did_ find is real and was fixed: a new
`Shift` 45° modifier row for the polygonal lasso, added by the same pass that was meant to remove
that defect class.

**The check is not worthless, and the failure is not a bad method — it is a missing baseline.** A
closure check must be given the commit the fix was supposed to start from, and must assert against
that, or every value that a _concurrent_ session fixed in the same window is silently credited to
the fixer. Here `main` moved several times while the work was in flight; the audit read a moving
target and reported the motion as work. The concrete form of the rule: **`git show <fix-parent>:<path>`
is the only honest baseline**, and when the pass cannot name that commit its "already fixed"
verdicts are unattributable and must be reported as unknown rather than as a win.

This is the same shape as the one this file used to open with — a citation that moves and still reads
plausibly, or a verdict that moves and is credited to the wrong commit. A plausible reading is not
evidence of when it became true.

## 77. `## 15a.` yields no item, and a suffixed retirement retires its PARENT

`scripts/lib/agent-board/handoff-import.mjs` — `NUMBERED`

Found while fixing a defect in the eraser-options arm of `src/util/settings.ts`, and deliberately
**not** fixed with it. The end-anchored
`DEAD_HEADING` landed as `eba42f8`; a letter-suffix fix for `NUMBERED` was written in the same
branch and then reverted, because it introduced an origin shape that collides with the board's own
namespace and left an unguarded regex in the test. Half-finished is worse than filed.

**The loss, measured.** `NUMBERED = /^(?:item\s+)?#?(\d+)\b/i` cannot match a letter suffix —
there is no word boundary between `5` and `a`, so `NUMBERED.exec('15a. A self-anchored reorder …')`
is `null`. `assemble` then falls through to the `SEVERITY` test (also false) and reaches
`if (open && record.level <= open.level) close(...)`. `HANDOFF.md:442` is a **level-2**
`## 15a. A self-anchored reorder is refused, and the refusal is load-bearing`, a sibling of
`## 15.` — so it **closes item 15's body there** and opens nothing itself. The span
`HANDOFF.md:443-456` is **876 raw characters**, or **874** once the span's leading and
trailing blank lines are trimmed — 874 is the trimmed count, and the raw count is the one
that includes them. Line 455 is a `---` rule, which `bodyOf` drops as layout, so the prose the
parser actually strands is lines 443-454. All of it is unreachable from any item title or body.
Item 15's stored body is 3994 chars and ends mid-sentence; the 15a prose is not in it. The
entry is a load-bearing tripwire, so this is live work loss, not latent.

**Both counts were wrong on the way in, and the correction is self-stable.** The span's text is
byte-identical across every base this entry has been re-derived against, so **its length cannot
change when the line numbers move** — and two earlier revisions "corrected" `872 → 873` and
`870 → 871` for a span that measured the same both times. `comm` over the region's bytes, not a
re-read of the number in the prose, is the only check that catches this: the raw count includes
the digits of the count itself, so replacing three digits with three digits leaves it unchanged
and needs no second pass. **Item 15's stored body is left alone** at 3994: it sits upstream of
every hunk in this entry, and it is the one number here that cannot be measured without the
parser, which is exactly why an unmeasured number must not be edited.

**The same root cause, opposite direction, and worse: a suffixed retirement retires the parent.**
`deadNumbers('## 15a. An old thing — deleted')` returns `[15]` — `NUMBER_OR_RANGE` harvests the
`15` out of `15a` — so item 15 is silently filed as _finished_ by a heading that says `15a` is done.
`## 15a, 16. Old things — deleted` returns `[15,16]`. This is silent corruption, not silent loss,
and a fix that only widens `NUMBERED` does not address it.

**Why the test suite cannot see either.** `handoff-import.test.mjs:205`'s own heading-count regex
carries the **identical** `\d+\b` blind spot, so `items === headings` holds for `## 15a.`,
`## 15b.` and `## 16a.` simultaneously. Both sides miss it; the equality stays green. The corpus
has exactly one such heading today, `## 15a`. Proven: with `NUMBERED` fixed and the count regex
left alone, the count test fails. **The quoted output `expected 38 to be 37` was measured at
`a3f1dcc`**, the campaign branch tip, against that branch's `HANDOFF.md` — 37 headings under the
count regex, 38 items once the suffix is accepted. On `main` the same projection reads
**`expected 49 to be 48`** — 48 headings under the count regex, 49 once the suffix is accepted —
re-measured at **`0d64d75`**, the tip of `main` this branch merges. Neither number reproduces
unless the tree is named, and the assertion itself is `handoff-import.test.mjs:207`. Note that a
_naive_ `NUMBERED` patch does not produce 49: it maps
`15a` to `Number('15a') === NaN`, and folding it to `15` instead collides with the live
`HANDOFF.md#15` and loses it to first-occurrence-wins — the same collision the `makeItem` row
below describes. The projection only holds for a fix that gives the suffix its own origin, which
is the open design question under this table.

**A real fix must change all of these together:**

| Where                              | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handoff-import.mjs` `NUMBERED`    | the suffix, and its case rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `handoff-import.test.mjs:205`      | the count regex, same blind spot. `:137`'s `HEADING_NUMBER` has it too, so there are **three** grammars to keep in step, not two. **"Hoist all three to module constants" is wrong as it stands**, and wrong on all three rows: `:205` is an inline regex literal handed straight to `countHeadings`, and `:137` is a `const` declared **inside an `it()` body** — already named, but test-local, so it agrees with nothing and hoisting it changes only where it sits. The one grammar that _is_ a module constant is `NUMBERED`, in the other file. The fix is therefore one shared constant for the two test-side grammars, declared once at module scope |
| `handoff-import.mjs` `makeItem`    | `` `${base}#${number}` `` — `Number('15a')` is `NaN`, so every suffixed entry gets a literal `#NaN` origin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `handoff-import.mjs` `planImport`  | the `/#(\d+)$/` dead-set filter cannot match `#15a`, so a suffixed item can never be suppressed by the document's own dead list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `handoff-import.test.mjs:256`      | and `:265`. The **unguarded** `Number(/#(\d+)$/.exec(item.origin)[1])` this entry used to cite is **gone from `main`** — `a14d728` ("close the eight findings from the board's review") replaced it with the guarded `?.[1]` at those two lines. There is no unguarded form left to fix here; the obligation moves to whoever writes the `## 15a.` assertion                                                                                                                                                                                                                                                                                                 |
| `handoff-import.test.mjs:67`       | `liveItems`, which the same row used to point at as the place to copy. It is at **67**, and it does **not** use `?.[1]`: it is `!number \|\| !parsed.dead.includes(Number(number[1]))` at `:70`, guarding on a separate statement. The guarded form to copy is at `:256`/`:265`                                                                                                                                                                                                                                                                                                                                                                              |
| `handoff-import.mjs` `deadNumbers` | the dead set is `number[]` end to end — typedef, both `Set`s, and `planImport`'s `.map(Number).filter(Number.isInteger)`. It cannot represent a non-integer at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Open design question, for a human.** What origin shape should a suffixed entry get? `#15a` is
the label the document actually wrote and is the natural key, but it is grammatically
indistinguishable from a slug under `isImportedOrigin` in `db.mjs` (`<file>.md#<number-or-slug>`,
slugs are `[a-z0-9-]+`), so neither `planImport` nor the board can tell the two apart. `#15-a-slug`
is unambiguous but invents a label the document never wrote. Folding `15a` into `15` is **not**
available: two headings sharing one origin makes one of them unfileable on every later run, which
is the collision the `NUMBERED` comment already warns about. The larger question is whether the
parser should support suffixes at all — or keep rejecting them and make the rejection **loud**,
because the current failure is silent, with nothing anywhere reporting that an entry vanished.

`## 15A.`, `## 15ab.` are the same silent content-loss path: no item, no origin, and a level-2
one closes its parent exactly as `## 15a.` does.

## 78. Three rail defects §74 does not name, and no test can catch any of them

**Validated by an independent audit pass over `toolbar-mapping.ts` against Adobe's own
documentation, 2026-09-29.** §74 carries the inventory; these are the _mechanical_ consequences,
and each is a one-line fix.

**1. Two tools render the letter `B`, and the real `B` handler never reaches one of them.**
`toolbar-mapping.ts:96` gives the non-Photoshop `draw` entry `shortcut: 'B'`, the same letter
`toolbar-mapping.ts:72` gives the Brush. The badge is rendered from the map
(`SidebarLeft.tsx:837`), so the user is told the Draw Tool answers to `B`; and
`AppKeyboardShortcuts.tsx:19` puts `b` on `brushGroup = ['brush','pencil','color-replacement','eraser']`,
so pressing it can never select `draw`. The same pass found `Shift+B` cycling into `eraser`, which
is wrong twice: `B` cycles only within the brush group, and the Eraser's own letter is `E`.

**2. Three Photoshop groups are collapsed into one flyout, and the evidence for the split is
Adobe's own shortcut table, not a third-party diagram.** The app has one six-entry flyout —
Brush, Pencil, Color Replacement, Eraser, Magic Eraser, Paint Bucket. Adobe's table binds
`B` to Brush, `E` to Eraser and `G` to Paint bucket, with `Shift+G` for "Switch between Paint
bucket and Gradient tool": distinct letters are how Adobe proves the three groups are three. The
app's own `G` handler already cycles a Gradient/Paint-Bucket pair, and the Gradient sits in its
**own single-tool tile** rather than sharing `G` — so the one grouping fact Adobe states outright
is the one the rail contradicts. This matters independently of §74's unresolved order questions:
group membership is settled, only position is not.

**3. Nothing asserts that two tools cannot share a letter.** `toolbar-mapping.test.ts:126-131`
checks the `U` group and nothing else, so a `B`/`B` collision is invisible to the suite. One
`expect` over the flattened map's `shortcut` values would have found defect 1 on the day it
shipped. Note the trap it must not fall into: `draw` and `pen` variants legitimately share a
letter with their group leader, so the assertion is "no letter is claimed by two _different_
groups", not "no letter repeats".

**These are filed, not fixed.** Deleting `draw` and re-grouping the flyout are §74's work, and
doing them here would land the deletion without the replacement rail.

## 79. A move drag that goes out and back releases the selection where it was never taken

`src/components/Main/EllipticalSelectionToolArea.tsx:200-204`, and the two accumulators
disagree about which frame of the drag they are tracking. `delta` is measured from `drag.origin`,
which `:207` then **advances** to the current pointer position, and it is applied to
`drag.baseline`, which **never** advances. The running displacement is therefore the last frame's
delta alone, and every earlier frame is discarded. Take a selection 60px right and 40px down,
retract the pointer to the point you pressed from, and release: the commit lands the selection at
`(-60, -40)` on a document that starts at the origin. One frame's worth of history, applied twice,
in opposite directions — and the preview overlay shows the same wrong position for the whole
gesture, because `drag.preview` feeds `redrawOverlay` at `:209-211`.

The fix is already written elsewhere in the same directory. `PolygonClickToolArea.tsx:825-827`
applies the same delta to `selectionDrag.selection` and advances **both** accumulators into the
next ref record in one statement; that is the correct shape and it is what `:206` should be.
`moveSelectionByDelta(drag.preview, delta)` puts this arm on the same footing, and the first
frame needs no special case because `drag.preview` is already seeded with `activeSelection` at
`:165`. The release gate at `:226` then does the rest for free: a net displacement of zero lands
the preview back on the baseline's own geometry, `hasSameSelectionGeometry` reports them equal,
and the gesture commits nothing.

**Why nothing saw it, and why that is a gap rather than a blessing.** Every move-drag case in
`EllipticalSelectionToolArea.test.tsx` issued exactly one `pointerMove`, and with a single frame
the last delta _is_ the whole delta — so `moveSelectionByDelta(baseline, delta)` and
`moveSelectionByDelta(preview, delta)` return the same selection. The suite was blind to the
difference by construction rather than by accident. Verified by mutation: changing `:206` to
`drag.preview` leaves every pre-existing case green, including the zero-delta single move the file
has since gained at `:359` — which agrees under both accumulators, exactly as the one-frame
argument predicts.

The half of that which was sound: no assertion in the file pins the drifted position, so nothing
enshrines the bug. It was uncovered, not endorsed.

Pinned as `it.fails` at `EllipticalSelectionToolArea.test.tsx:318`, "commits nothing for a move drag
that went out and came back to the press point". A zero net displacement is observed through the
absence of a commit rather than through a committed position, which is the same observable the
neighbouring zero-delta case pins for the one-frame shape of the same gesture; the case carries
its own control — a second, single-frame drag on the same mount, which is independent of the
defect — so the empty assertion cannot pass by the arm never having run. **Delete the `it.fails`
in the same change that fixes `:206`**, per `AGENTS.md`: it is a tripwire for broken behaviour,
and left behind it turns the fix into a red suite.

## 80. Five components fold `!isBedrock` into `usePaintStroke`; four of them gained a test, and `CloneStampToolArea` is the one that did not

A correction, because a wrong claim in this repository's own history is read by every future agent
that runs `git log`. `b001d7d` states that five components fold `!isBedrock` into the flag they
hand `usePaintStroke` — Dodge, Burn, Smudge, CloneStamp and Gradient — "and not one had a test".
Both halves need narrowing, and the error in the second one is about coverage rather than about
the flag.

The list of five is **correct**: `DodgeToolArea.tsx:59`, `BurnToolArea.tsx:65`, `SmudgeToolArea.tsx:79`,
`CloneStampToolArea.tsx:210` and `GradientToolArea.tsx:85` each compute an `enabled` /
`isEnabled` from `activeLayer && !activeLayer.isBedrock` and pass it to `usePaintStroke`. What is
wrong is "not one had a test" as a description of the finished branch: `b001d7d` added suites for
four of the five, and **`CloneStampToolArea` still has no test file** — `git ls-tree main --
src/components/Main/__tests__/` answers none. The fifth area the commit covers is
`EllipticalSelectionToolArea`, which is **not** one of the five: it imports no `usePaintStroke`
and reads no `isBedrock`. It is a selection tool, and the rule it shares with the four is nothing
more than "the suite mounts a store fixture and drives real pointer events".

Two components read `isBedrock` without `usePaintStroke` and must not be counted into that set
either: `CloneStampToolArea` folds it into `isEnabled` **and** uses `usePaintStroke`, so it is
in; `MoveToolArea.tsx:35`, `EraserToolArea.tsx:56-63` and `FillToolArea` read the flag directly
and are out of it. **The cheapest thing that settles whether `CloneStampToolArea` is actually
covered is a test, not a sentence** — and until one exists, treat the "not one had a test" claim
as four, not five.

## 81. The two `it.fails` on the polyline animation loop were mock artefacts, and the production comment that justified them is stale

`src/hooks/usePolylineAnts.ts:134-136` — pending animation-frame handle

Two `it.fails` tests in `src/hooks/__tests__/usePolylineAnts.animation.test.tsx` were **deleted
and the behaviour pinned as working**, because both were pinned to a defect that a rAF mock
manufactured rather than to a real one. That conclusion is right. What is left behind is not:
**the production comment those two tripwires were written against still asserts the opposite, and
the test suite now contradicts it.**

**(a) The handles were an artefact of the mock, not a defect.** The mock counted frame handles
from `0`. HTML Standard §8.12 (Animation frames) defines the handle as a pre-increment: the target
object has "an animation frame callback identifier, which is a number that **must initially be
zero**", and the `requestAnimationFrame(callback)` steps say to "**increment target's animation
frame callback identifier by one, and let handle be the result**". Handles are therefore `1, 2, 3,
…` and `0` is unreachable. The first `it.fails` reported that pausing with frame 0 pending did not
stop the loop, and the second that a second loop ran in parallel at double speed — both inputs a
browser cannot produce. **The mock now starts at `1` and both are ordinary passing tests.** An
earlier version of the comment justified this with the spec defining a frame handle as a "new
POSITIVE long"; that phrase is in no version of the spec and the IDL return type is
`unsigned long`, so the claim was unciteable even though the conclusion held. The mechanism is
the pre-increment above.

**(b) The production guard is a truthiness guard where its sibling uses `!== null`.**
`usePolylineAnts.ts` guards a pending frame three times — `:80` (the `clear` cancel), `:124` (the
`draw` cancel before rescheduling) and `:148` (the `isPaused` effect cleanup) — and all three are
`if (animationIdRef.current)`. `useAnts.ts:40` and `:82` do the identical job for the identical
"pending animation handle" and use `if (animationIdRef.current !== null)` and
`=== null`. `useAnts` nulls the ref immediately after cancelling, so `0` and `null` are genuinely
distinguishable there; `usePolylineAnts` never produces `0` either way, which is why the
truthiness form is currently correct. **It is correct by the spec argument in (a), not by
construction**, and the sibling in the same directory is the standing counterexample to "0 cannot
happen" — which is a local property of one file's mocks, not of the platform.

**(c) The comment at `:134-136` is stale and asserts the branch removed.** It reads:

> A pending handle of 0 is the one case the cleanup's own truthy guard skips, but 0 is falsy here
> too, so cancelling here never had anything to do. That falsy-0 path is why pausing with frame 0
> pending does not stop the loop.

The last sentence is the claim `usePolylineAnts.animation.test.tsx:145` now **falsifies**: the
test at that line asserts that pausing before the first frame has run _does_ stop the loop, and
cites `:148` — the very line this comment describes. The repo currently holds a production comment
saying the loop does not stop and a test saying it does, and only one of them can be right.

**When production is next touched, `usePolylineAnts.ts:134-136` must be corrected or deleted**, and
the two sibling counters that still start at `0` — `usePolylineAnts.test.tsx:9`,
`useAnts.test.tsx:9`, `useAnts.transform.test.tsx:20` — should move to `1` in the same change, so
the four rAF mocks in `src/hooks/__tests__/` stop disagreeing about a value the platform fixes.
Switching the three guards to `!== null` to match `useAnts` is the durable fix and makes the whole
question disappear; it is deliberately **not** done here, because this branch is tests and handoff
only and may not edit production.

**No defect is claimed here.** Nothing user-visible is broken today, the truthiness guards do the
right thing in a browser, and the two `it.fails` were correctly removed. The finding is that the
justification for that removal is still in production prose in the opposite form, and a reader who
trusts it would re-add the tripwires.

## 82. The parser retires a LIVE numbered heading that ends in a status word, silently

`scripts/lib/agent-board/handoff-import.mjs` — `DEAD_HEADING`, consumed by `assemble`

**The defect.** `DEAD_HEADING` requires the status word to be last, which is right, and
`assemble` consumes a matching heading with `continue` without ever opening it as an item. Those
two facts compose into a silent loss: a **live** numbered heading that happens to end in a status
word is retired, and its prose leaves the import with nothing anywhere in the parse result saying
so. Measured through the real parser, both directions, side by side (indented deliberately: the
heading-count assertion at `scripts/__tests__/handoff-import.test.mjs:205` matches
`^#{1,6}[ \t]+\d+` **without skipping fenced code**, so an example of this shape written at column
zero inside any fenced block fails that test against the parser being _right_ — a blind spot in the
assertion, pre-existing, and the reason for the indentation):

```
  ## 31. The dialog-closed assertion is fixed   ->  dead=[31]  items=[]
  ## 9.  — deleted .                           ->  dead=[]   items=[#9]
```

The first is a live entry retired. The second is the **visible** false row — a title printed on
`swarm ready` that a reader can clear. A numbered heading that genuinely ends in a status word
(`## 5. Whatever — resolved`) is not _structurally_ distinguishable from one that merely does, so
anchoring the word does not separate the two cases; it only decides which one the corpus has not
produced yet. Latent, not live: over the 97 real headings on `main` at `0d64d75` the narrow rule
and the loose one give the same verdict for every heading except the five the loose one gets
wrong, and the one genuine retirement is still read as a retirement. The narrowness is a
judgement about the corpus, not a proof, which is why the paragraph on the obvious fix below
measures what the alternative actually does rather than assuming it does nothing.

**Why this is a filed defect and not a documentation nit.** The `DEAD_HEADING` docstring carried
an argument that this risk was one-sided and loud — under-matching a retirement gives a visible
row, over-matching is always a silent loss. That argument was **false for numbered headings**, for
the reason `DEAD_HEADING`'s own separator class gives, measured in the table at the end of this
entry. It is now corrected in place to state that the residual risk is two-sided, with both
measured rows quoted.

**Provenance, because the false claim is not on `main` and the question was lost with it.** The
claim was written in `a3f1dcc` (the campaign branch) under a heading reading "THE TWO FAILURE
MODES ARE NOT SYMMETRIC, AND THAT IS THE ARGUMENT FOR THE RULE". `bd137d0` merged that branch
after pointing its parser change at `eba42f8`'s implementation and keeping the tests; the
+146/-0 merge dropped the whole argument block. Dropping a false claim was right. Dropping the
question it was an answer to was not, and `eba42f8`'s shorter docstring argues the rule
empirically without ever addressing the over-match direction.

**Why the obvious fix is worse than the defect — and the first version of that paragraph was
itself wrong.** Requiring a separator before the marker (`— resolved`, `(done)`, `…: fixed`) was
written off here as "does not distinguish the two cases either", on the grounds that a title may
legitimately end in a separator character. **That reason is false, and it was the reason the
paragraph below it was already making correctly.** Dropping `\s` from `DEAD_HEADING`'s separator
class `(?:^|[\s\-–—(\[])` to `(?:^|[\-–—(\[])` does separate the cases: it keys on _no space before
the marker_, and the ordinary English shape of a retirement — `… — deleted`, `… — resolved` — has
one. `## 5. Whatever — resolved` goes from `DEAD` to `live`, and so does `## 31. The
dialog-closed assertion is fixed`.

What it buys that is real; what it costs is larger, and the cost is measurable. Re-derived by
patching the separator class and re-running the real parser over the merged corpus:

| Heading                                                                                    | Now                | Separator required |
| ------------------------------------------------------------------------------------------ | ------------------ | ------------------ |
| `## 13. Landed, superseded and deleted` (pinned fixture, `handoff-import.test.mjs:654`)    | `dead=[13]`        | `dead=[]`          |
| `### Items 5, 7, 9, … — deleted` (`HANDOFF.md:119`, the corpus's **only** real retirement) | `dead=` 26 numbers | `dead=[]`          |
| Whole `HANDOFF.md` — `planImport(...).create`                                              | 49                 | **51**             |

The second row is the one that decides it. `HANDOFF.md:119` is the heading the `DEAD_HEADING`
docstring names as "the only retirement marker any of the three documents actually uses", and the
separator requirement re-reads it as live prose: `dead` goes from 26 numbers to **none**, and two
already-retired items — `HANDOFF.md#7` and `HANDOFF.md#18` — come back to the board as open work.
So the fix does not trade a silent loss for one false row; it trades it for **26** un-retirements
and two live ones, on a heading the corpus really contains, and it breaks the pinned fixture while
doing it. Adopting it is a corpus change, not a parser change, and it is the operator's to make.

**What a fix needs, and why it is not one line.** Either a marker position that cannot be
incidental, or a **loud** failure when a `NUMBERED` heading is retired without the document having
listed retired items. The loud option is the only one that preserves both directions, and it is
not local: it needs a field on `ParseResult` (whose exact shape
`handoff-import.test.mjs` asserts on an empty document), and a caller in `agent-board.mjs` that
actually reports it. Both are outside what a comment-level correction can reach, and the operator
should choose which of the two behaviours a mistyped heading should have.

**Pinned while unfixed, as an `it.fails` tripwire.** `scripts/__tests__/handoff-import.test.mjs`
holds the shape in `it.fails('keeps a LIVE numbered heading that ends in a status word as an open,
filed item')`: the body asserts what a **fixed** parser returns, so it is red today and the `fails`
is what makes the suite green. It is the marker the repo already uses in ~20 places
(`image-processors.test.ts:151`, `StoreContext.durable-boundary.test.tsx:441`) and the one
`AGENTS.md` describes. **Delete the `it.fails` in the same change that fixes `DEAD_HEADING`** — the
moment the body goes green, the `fails` goes red, which is the intended signal and not a
regression to chase. The live side of the same rule, and the visible false row it contrasts with,
are held in an ordinary green test beside it, so a pin that starts failing for an unrelated reason
cannot hide behind `it.fails` passing.

## 83. The panel workspace: seven documented Photoshop behaviours are NOT built, and the list matters more than the feature

`feat/panel-docks` made the tools rail and the History/Layers dock draggable and resizable. The
behaviours it ships are transcribed from Adobe's own help pages, and the citations are in the
header of `src/contexts/PanelLayout.tsx` — read that before crossing this boundary, because the
two scope decisions below were made against sources rather than against taste.

**1. Panels cannot float.** "Dragging a panel out of its dock creates a floating panel that you
can position anywhere in the workspace"
(<https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/stack-floating-panels.html>).
Not implemented. It needs its own window layer, a z-order above the canvas, and persistence for
panels dragged off-screen — none of which exists. **This is the one real gap.** A user who
wants a panel out of the way has no gesture for it, and `Window` has no panel list to remove one
from, which Adobe does document and which is also missing.

**2. `Tab` and `Shift+Tab` do not hide panels.** "Press Tab to hide all panels... Press Shift +
Tab to hide all panels except the Tools panel and Options bar."
(<https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/hide-show-panels.html>).
Not implemented, because `Tab` is already bound to leave an open tool flyout
(`SidebarLeft.tsx`), and a global hide is a different feature from a drag one. `Window > Collapse
Panels` is a reasonable way in; the keyboard shortcut needs the flyout binding resolved first.

**3. `PanelGroup` is draggable but not groupable.** Photoshop lets Layers/Channels/Paths be tab
GROUPS sharing one body. The hook does the vertical case of it and not the horizontal one, and
the group model only pays off once a third panel exists. The drag that would extend it is the
same `PanelGroup` header.

**4. A dock cannot be shorter than the workspace.** "You can prevent panels from filling all the
space in a dock. Drag the bottom edge of the dock up so it is separated from the workspace's
edge." The column is always `h-full`. A `useDockDrag` comment here also claimed "the divider
itself is not a Photoshop-documented gesture", which is false — Adobe's wording is "Drag any
side of the panel" and "drag the dock's bottom border" — and that comment is corrected.

**5. Panel icons in the icon strip are not draggable.** "To move a panel icon (or panel icon
group), drag the icon. You can drag panel icons up and down in the dock… or outside the dock."
They are click-only buttons.

**6. A panel GROUP cannot be moved as a unit by its title bar.** "To move a panel group, drag
its title bar (the solid empty bar above the tabs)." This branch has no title bar: `PanelGroup`'s
header _is_ the tab, so there is no separate bar to grab. Item 3 is a different axis — grouping
several panels into one body, not moving a group.

**7. There are no workspaces.** Adobe documents saving, switching, deleting and restoring them
as four separate operations, and a workspace "remembers the size and position of panels". This
app has one unnamed workspace persisted under one key, with a single hard-coded
`Window > Reset Workspace` and no panel list to remove a panel from — "Select Window from the
menu bar. Select the panel name to remove it from the workspace", and the per-tab
**Close / Close Tab Group** context menu, are both absent.

**An earlier version of this entry listed three of these and called it complete.** It was not, and
the count was the problem rather than the omissions: a list that claims to be the full set of what
is missing reads as a finished audit, and the four above were each a page of Adobe's own
documentation.

**Two rules in the shipped work are worth keeping, because both were found by a test failing and
neither is obvious from the code:**

**A dock's resize handle must be on its CANVAS side, and the border must follow the dock.**
`SidebarRight.tsx` picks `left-0` or `right-0` from `dockOnLeft`. Inverted, the handle lands
against the window border — unreachable, and it reads as a resize grip for nothing. The unit test
that pinned it asserted `right-0` for the default because that was what the code did, and it
stayed green through the inversion; only `e2e/panel-workspace.spec.ts` caught it, by measuring
the handle's real box.

**The rail's re-dock target is the edge the rail is NOT on, and `dockOnLeft` is the inverse of
the rail's destination edge.** Both halves were wrong at once, in ways that cancelled: dragging
the rail LEFT reported a drop target at the left edge and swapped, so the rail ended up on the
right and every outcome assertion passed. The unit test now asserts the drop target's side, and
`e2e/panel-workspace.spec.ts` asserts the rail's `boundingBox().x` — an outcome-only assertion
cannot see this class of bug at all.

**One locator trap, because five e2e specs and three unit tests depend on it.** A layer row's
`title` is `"Drag to reorder"`, and `page.getByTitle` matches on substring. A panel tab whose
tooltip contained that phrase resolved to the tab header instead, and every one of those
locators silently began pointing at the wrong element — five specs failed with
`Received string: "History«"`. `PanelGroup`'s header `title` must stay clear of it.

**One overlap that `toBeVisible()` cannot see.** The rail is 108px wide and its tool
grid is as wide as the rail, so a tile in the LEFT-hand column of the two-column rail
ends nowhere near the panel's right edge. A flyout hung off that tile lands over the
rail's own first column — inside the viewport, so nothing complains, and painted over
the panel. `AnchoredOverlay` takes an `xAnchor` — the rail's horizontal edges, with the
tile still driving vertical — which is what Photoshop does by hanging a tool flyout off
the panel edge. The ORIGINAL version of this entry gave a mechanism that was never true
(a "108px grid inside a ~83px content box", so the second column started past the rail's
own right edge); the second column starts well inside the panel, and the overlap came
from anchoring to a tile at all.

The mechanism is **overlap, not clipping**, and the first version of this entry said clipping. The
overlay is portalled to `document.body` and positioned `fixed`, so the rail's `overflow-y: auto`
cannot clip it at all and no `toBeVisible()` failure would ever have reported it. The assertion in
`e2e/panel-workspace.spec.ts` is a geometry one — clear of the rail's left edge — and that is what
fails if `xAnchor` is removed.

---

## 86. No `useRect` border animates, so the crop, move, text and rectangular-selection rects all sit still

**Problem.** `useRect` strokes its border with a fixed dash pattern and never advances it:
`ctx.setLineDash([5 / scale, 5 / scale]); ctx.strokeRect(x, y, width, height);`
(`src/hooks/useRect.ts:235-236`). No `lineDashOffset` is ever assigned, and the file's one
`requestAnimationFrame` (`:483-488`) throttles the DRAG, not the border: it recomputes the rect and
calls `drawMask(true)`, which redraws the same fixed dash. It looks alive during a drag only because
the drag is RAF-throttled, so the line is redrawn at pointer rate — the dashes never move.

**`useRect` is the one border in the app that redraws without advancing, and THREE selection
borders are drawn that way — not one.** `useMarchingAnts`
(`src/hooks/useAnts.ts:24,48-70`) is the real marching-ants loop, and its only production consumer is
`MoveToolArea.tsx:6`, which paints the outline of a **hovered layer** in `reposition` mode. So
"marching ants on a rectangle" is the Move tool's layer outline.

**Three selection borders still sit still, not one.** A polygon selection animates
(`useSelectionMarchingAnts`), but only for the three modes in `Main.tsx:40`'s
`POLYGON_SELECTION_MODES`. The elliptical and quick selection tools are deliberately absent from it
and map to their own `interactionMode`s (`Main.tsx:104,106`), so their borders stay the static
`drawSelectionOutline` stroke — and they commit `geometry: 'polygon'` selections
(`createCommittedPolygonSelection`, `src/util/selection.ts:29`, whose `geometry: 'polygon'` is at `:51`), so nothing about the selection's
own shape marks them as un-animated. That leaves THREE static selection borders: the rectangle
(`useRect`), the elliptical marquee and quick selection. Fixing only the rectangle — the cheap half
of the choice below — would leave two behind, which is why they are named here together.

**The rectangle and the polygon no longer match each other** in colour or weight (`#007bff` at 2px,
plus four square handles, versus black/white ants at 1px), and the two marquee tools match neither.

**It affects four tools, not one.** `useRect` is shared by `MoveToolArea.tsx:117`, `CropToolArea.tsx:61`,
`RectangularSelectionToolArea.tsx:65` and `TextToolArea.tsx:24`, so the crop rectangle, the move
rectangle, the text frame and the rectangular selection all have the same still border.

**Fix.** Three shapes, and the choice is a recording decision rather than a mechanical one. Fixing
the rectangle alone is a real option, but it is not the same task as fixing all three still
borders, and the entry above says which is which — pick the scope deliberately.

- Animate inside `useRect` — advance a `lineDashOffset` ref by a few pixels per frame inside the
  existing draw path, keeping the current colour and the four handles. Cheapest, and the only option
  that covers all four callers at once. It needs its own loop, because `drawMask` is only called while
  something is changing. Fixes the rectangle and the crop, move and text frames with it; leaves the
  two marquee tools static.
- Or give the rect the ants treatment the polygon got: stop `useRect` stroking the border, drop
  `rectangular-selection` from `Main.tsx`'s `POLYGON_SELECTION_MODES` exclusion
  (`useSelectionAnts.ts:69` currently skips rectangles on the assumption that `useRect` still paints
  one), and let the ants canvas own the rect. Note the constraint this has to respect: `useRect` also
  draws the dim-out scrim (`:226`) and, in the same pass, the border and the corner handles (`:233-246`), so the border and the handles have to
  end up on different canvases or the scrim will wipe the ants mid-drag.
- Or extend the ants to the two marquee tools as well, which is the only shape that reaches all
  three: add `'elliptical-selection'` and `'quick-selection'` to `POLYGON_SELECTION_MODES`
  (`Main.tsx:40`) and stop those two tool areas calling `drawSelectionOutline`
  (`EllipticalSelectionToolArea.tsx:112`, `QuickSelectionToolArea.tsx:104`). This one is not only a
  mode list, because both commit `sourceTool: 'magic-wand'`
  (`ellipticalSelection.ts:48`, `quickSelection.ts:43`) — the constant each borrows from the wand —
  and `drawSelectionAnchors` skips that source, so the anchors have to be taught the difference
  between a wand selection and a marquee selection or the two tools lose their handles as well as
  their border. `EllipticalSelectionToolArea.test.tsx`'s 'strokes a committed selection border' pins
  the current ownership and will fail until this is done on purpose.

Whichever is chosen, `useRect.drag.test.ts:136,252` pins the current `setLineDash` values and has to be
updated in the same change.

**Files.** `src/hooks/useRect.ts:233-246,483-488`, `src/hooks/useAnts.ts:24,48-70`,
`src/components/Main/MoveToolArea.tsx:6,117`, `src/components/Main/CropToolArea.tsx:61`,
`src/components/Main/RectangularSelectionToolArea.tsx:65`, `src/components/Main/TextToolArea.tsx:24`,
`src/hooks/useSelectionAnts.ts:69-70`, `src/hooks/__tests__/useRect.drag.test.ts:136,252`

## 87. The append boundary never checks that its base is at its own tip

**Problem.** `decideDurableAppend` (`history-append.ts:579`) proves `documentId`, both revisions,
the legacy tip, the length delta, the legacy cursor and the appended entry's identity
(`:590-610`) — and never proves `base.cursor === base.history.length - 1`. The published cursor is
`base.history.length` (`:644`), not `base.cursor + 1`, so a base sitting below its own history
publishes a cursor **past** the entries it had not reached. The one cursor guard that looks related
runs the other way: `cursor > next.cursor` (`:647`) catches a base with too MANY entries, and a base
with too few slips straight through.

**User-visible failure.** An edit the user undid comes back as applied. The entries between the
base's cursor and its tip are below the published cursor, so the shadow now replays a crop the user
undid, and the redo-only state the base described is gone — with no diagnostic, because the base
satisfies every precondition.

**Reachable only by accident today.** A mid-timeline base is produced by a rebuild, and
`buildDurableDocument` derives the shadow cursor from the **legacy** cursor
(`StoreContext.tsx:674-677`, `converted.legacyCursorToDurableCursor[historyCursor] ?? -1`) — so the
same rebuild also hands the boundary a `prior` that is not at its tip, which `:599` refuses before
this gap is reachable. Nothing in the boundary enforces the invariant; only that coupling does, and
it is one refactor away from not holding.

**Fix.** Add `if (base.cursor !== base.history.length - 1)` to the precondition list, next to the
legacy tip check at `:599`, with the same `preconditions` outcome. Pinned as a KNOWN-GAP pin at
`history-append.test.ts:1182`; the fix must re-point it in the same change.

**Files.** `src/contexts/history-append.ts`, `src/contexts/__tests__/history-append.test.ts`

---

## 88. The append boundary never re-validates a planned frame's `next`

**Problem.** `validatePlannedDurableEntry`'s frame branch (`history-append.ts:486-498`) proves only
that `planned.operation.next` equals the legacy `args.nextFrame` structurally (`sameFrame`, `:492`)
and that `nextFrame` is present (`:491`). It never asks whether either is a **document frame** —
`isValidDocumentFrame` is not called anywhere in the boundary. The shared derivation the boundary
relies on does call it (`history-adapter.ts:260`, reached from `history-append.ts:133`), so the two
routes disagree about one legacy item by construction.

**User-visible failure.** A published `0x0` crop. Durable replay applies `next` with no validation
at all (`durable-replay.ts:129-131`) and `documentFrameSize` clamps to a 1×1 minimum
(`document-frame.ts:9-14`), so the shadow comes to describe a **one-pixel-square document** rather
than a zero — the loss is invisible as a degenerate size. The conversion route for the same item
publishes nothing and names the loss (`history-adapter.ts:675-681`), so of the two routes only one
says anything.

**Latent.** Only a **supplied** entry reaches it: every production `durableEntry` is
`planHistoryAppend`'s output, which refuses the frame at `history-append.ts:134-136`, or
`deriveReorderLayersEntry`, which is not a frame action (`StoreContext.tsx:913`).

**Fix.** In the frame branch, reject a `planned.operation.next` that fails `isValidDocumentFrame`
before comparing it to the legacy arg, and treat the refusal as a `mismatch` so the store records
it. Pinned as a KNOWN-GAP pin at `history-append.test.ts:1221`; the fix must re-point it.

**Files.** `src/contexts/history-append.ts`, `src/contexts/__tests__/history-append.test.ts`

---

## 89. The baseline document source's id is not in the duplicate-id set

**Problem.** The duplicate-id guard records an id only when an entry is actually published
(`history-adapter.ts:779-782`). The baseline document source is adopted, not published: its branch
`continue`s at `:586-589` — pushing cursor `-1` at `:587` — long before the publication guard at
`:752`, so the baseline's id never reaches `publishedEntryIds` (`:581`) and a later entry reusing it
is published as a first occurrence. No diagnostic is raised, and the two id-based resolvers now
disagree: `updateHistoryTimeline` finds the **first** match in the legacy timeline
(`history-timeline.ts:24`) while `toggleDurableEntry` finds the first in the durable document
(`history-adapter.ts:880`), so one History-panel eye click disables a different edit in each model.

**User-visible failure.** A click that toggles the wrong row, and a durable document whose entries
carry an id the legacy timeline already used. Silent: `status` stays `current` and no diagnostic
names the id.

**Reachable only by accident today.** Production mints a fresh `uuidv4()` per commit
(`history-utils.ts:81`), so the baseline id and a later entry's id are unrelated values. Note that
this is the one hole where the "does not consume its id" rule is **not** a safe answer, unlike the
refused replacement and the entry that threw: the baseline id is not a durable entry, so this set
structurally cannot see it, while the legacy timeline still holds it.

**Fix.** Add the baseline's id to `publishedEntryIds` when it is adopted, or widen the guard to
compare against the legacy timeline as well. Pinned as a KNOWN LIMIT pin at
`history-adapter.diagnostics.test.ts:873`; the fix must delete or re-point it.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/__tests__/history-adapter.diagnostics.test.ts`

---

## 90. A disabled FIRST history entry is adopted as the durable baseline

**Problem.** `replayHistory` skips a disabled item before it does anything else
(`history-replay.ts:74`), so the document it produces for a timeline whose first entry is disabled
is empty. The converter takes that **same entry** as the durable baseline
(`history-adapter.ts:584-589`) without ever consulting `isEntryEnabled` (`:422-425`), and maps it to
cursor `-1` as though it were the pre-history state.

**User-visible failure, and this one is REACHABLE.** Disable the first History row and the canvas
blanks while the durable shadow still describes a full document — the layers, the frame and the
selection of an edit the user just turned off. The two models disagree about the same timeline with
no diagnostic, and nothing downstream reconciles them.

**How the toggle is exposed.** The History tab renders one eye button per row, including the first:
`HistoryTab.tsx:88-98` calls `handleToggleDisabled` (`:90`, titled "Disable history item" at `:95`)
→ `toggleDisabled(itemId)` (`:56`) → `useHistory.ts:148` → `updateHistoryTimeline`'s
`toggle-disabled` command, which flips `disabled` on the addressed entry
(`history-timeline.ts:23-28`). `sortedHistory` is `[...history].reverse()` (`HistoryTab.tsx:12`),
so the first entry is the **last** row — the one closest to the panel's footer, not a row anyone
treats as special. The mobile drawer exposes the same control
(`MobileLayersDrawer.tsx:106-110`).

**Fix.** Make the baseline branch adopt an entry only when `isEntryEnabled` agrees that the entry
would have applied — and say what a timeline whose baseline is disabled should convert to, because
"an empty baseline" and "a baseline derived from the first **enabled** entry" are two different
answers and only one of them is the document `replayHistory` produces. Pinned as a KNOWN-DIVERGENCE
pin at `history-adapter.branches.test.ts:704`; the fix must re-point it.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/__tests__/history-adapter.branches.test.ts`

---

## 91. The durable baseline's bedrock frame rule is implemented and no test reaches it at index 0

**The rule, and why it is right, so nobody re-derives it.** Legacy replay takes the document frame
from a bedrock source when the entry is the FIRST one (`history-replay.ts:103-109`), and that is the
shape every document opens with: `App.tsx:21-27` seeds a `DEFAULT_BLANK_IMAGE` carrying
`{ isBedrock: true, size }` and commits it through `setBlankImage` → `createBlankLayer(params, true)`
(`useApp.ts:77-80`). `frameFromFirstEntryBedrock` (`history-adapter.ts:263-271`) is the durable
model's copy of that rule, applied at `:591` as

```ts
frame: frameFromFirstEntryBedrock(first) ?? options.initialFrame ?? documentFrameFromSize(initialSize),
```

— ranked **above** `options.initialFrame`, which is the caller's current frame, and therefore the
cropped frame once the document has been cropped. The two models agree at index 0 by rule, not by
seeding. The read is in the baseline, not in the create-layer arm, which still leaves `currentFrame`
alone for every later entry (`:649-654`): a bedrock commit mid-history moves neither model.

**What is missing is the tripwire, and nothing on `main` can fail.** `grep -rn frameFromFirstEntryBedrock src/`
matches only `history-adapter.ts` — the function has no test at all. The two cross-model tests that
look like they cover it do not: `history-adapter.branches.test.ts:746-793` puts its bedrock entry at
index **1** (its `convert` helper at `:93-99` prepends `baselineHistory()`), and
`history-adapter.tool-conversion.test.ts:136-154` does the same through its own `convert`
(`:48-61`) and asserts only `created.layer.source` — never `baseline.frame`, never
`replayDurableDocument(…, -1)`. The one test that seeds an `initialFrame` differing from the derived
size, `history-adapter.branches.test.ts:131-149`, has a history with **no** source at all, so
`frameFromFirstEntryBedrock` returns `undefined` and `options.initialFrame` still wins.

So a regression that flips the ranking — putting the caller's seed back above the bedrock size — is
invisible, and the failure it produces is a baseline that describes the cropped document at exactly
the cursor where the user can undo back into the un-cropped original.

**Test that fails without it.** A history whose **first** element is a bedrock `NEW_LAYER`, converted
with an `options.initialFrame` of a different size, asserting `baseline.frame` equals the bedrock
size AND that `replayDurableDocument(converted.document, -1)` agrees with
`replayHistory(history, 0)`. Neither model is allowed to prefer the caller's seed at index 0.

**Files.** `src/contexts/history-adapter.ts:263-271,591,649-654`,
`src/contexts/history-replay.ts:103-109`,
`src/contexts/__tests__/history-adapter.branches.test.ts:93-99,131-149,746-793`,
`src/contexts/__tests__/history-adapter.tool-conversion.test.ts:48-61,136-154`

---

## 92. The converter re-derives a created or merged layer's snapshot, and disagrees with the runtime rule

**Problem.** The runtime builds a layer through one rule, `createLayerSource` (`layer-utils.ts:166`),
which `replayHistory` reaches through its `createLayer` dependency (`:108` and `:134`, wired at
`useHistory.ts:88`). The converter builds the same layer through a **second, re-derived** rule,
`sourceToRuntimeLayer` (`history-adapter.ts:842-860`), called from the create-layer arm (`:605`) and
the merge arm (`:728`). The two disagree on three fields, on the first layer of any document:

| field     | runtime (`createLayerSource`)                                         | shadow (`sourceToRuntimeLayer`)                          |
| --------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `name`    | `` `${getNameFromSource(source)} ${maxOrder}` `` (`:181`)             | the bare kind, with no order suffix (`:847`)             |
| `opacity` | `1`, always (`:189`)                                                  | `source.opacity` for a blank (`:850`)                    |
| `order`   | `maxLayerOrder(layers) + 1` (`:169`), `0` for an empty record (`:41`) | `Math.max(-1, …) + 1` (`:853`), so `0` for an empty fold |

Executed against the real converter on a blank source with `opacity: 0.5` added to an empty
document: the runtime layer is `{ name: 'Blank 1', opacity: 1, order: 1 }` and the durable snapshot
is `{ name: 'Blank', opacity: 0.5, order: 0 }`. A second disagreement rides along in the same line:
`getNameFromSource` applies `ellipsify` (`layer-utils.ts:158`), so a long image name is truncated in
the document and not in the shadow.

**User-visible failure.** The shadow describes a differently **named** and differently **transparent**
layer than the document for the same edit. The `opacity` half is the dangerous one and it is not
merely a wrong number: the runtime bakes a blank's `source.opacity` into the canvas pixels
(`layer-utils.ts:205-215`, `ctx.globalAlpha` at `:212`) and leaves `layer.opacity` at `1`, so the
shadow's `opacity: 0.5` is a **layer-level** claim about an alpha the document holds in the bitmap.
A materialization that applied it would double-apply the transparency. The `order` half is quieter
but not free: it puts the first layer of a document at order `0` in one model and `1` in the other.

**Two existing tests pin the two answers, which is why neither side is accidental.**
`layer-utils.createLayerSource.test.ts:107-108` pins the runtime (`'Blank 1'`, `'shape 1'`) and
`durable-replay.layer-operations.test.ts:113` pins the shadow (`'Blank'`). **A fix has to flip the
second one.**

**Fix — this is a decision, not an edit, and the decision comes first.** The obvious move is to have
the converter call the runtime rule rather than re-implement it, and that is what should happen; but
it cannot be done until the durable model says what a layer's `opacity` **means**. Today the field is
a runtime `Layer` field the runtime never sets from a source, so "copy the runtime layer" and "record
the source's alpha" are different contracts and only one of them can become the durable snapshot's.
Decide that, then make the converter derive through the shared rule and update both pins above in
the same change. Do not "fix" the name and order without it: a partial fix leaves the converter
deriving one field from the runtime rule and another from the source, which is a third rule rather
than one of the two.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/layer-utils.ts`

---

## 93. `plainValue` drops `undefined` from an object and throws on it inside an array

**Problem.** The two arms of `plainValue` (`history-adapter.ts:101-120`) disagree about one value.
The object arm filters it out — `.filter(([, item]) => item !== undefined)` (`:116`) — so an
`undefined` property is silently dropped. The array arm (`:106-111`) has no filter, so an `undefined`
element falls through both guards to `:112` and throws `Non-plain value at <path>[i]`.

**User-visible failure.** One sparse tool-arg array voids the **entire** durable document. The throw
is raised inside the per-item `try` (`history-adapter.ts:602`), caught at `:748-750`, and recorded by
`diagnosticFromError` at `severity: 'error'` (`:411`) — which is precisely the condition
`convertLegacyHistorySafely` turns into `status: 'unavailable'` with `document: null` (`:816`). The
object arm's `undefined` proves the value is not a contract violation; the array arm treats it as
one, and pays for it with every other entry in the timeline. Executed: a tool source whose args hold
`composite: [1, undefined, 3]` produces `Non-plain value at layer:L1.source.args.composite[1]` and
`status: 'unavailable'`, while the same args with a top-level `undefined` property convert with no
diagnostic at all. (The field name in that example is illustrative: `DrawToolArgs.composite` is
`'destination-out' | undefined`, not an array. The **mechanism** is reproduced by it; substitute any
real array-valued arg.)

**Not latent, and the earlier version of this entry said otherwise for the wrong reason.** It claimed
"No `ToolArgs` field is an array", which is false — `DrawToolArgs.points?: Point[]` and
`lineDash?: null | number[]` (`src/tools/draw.ts:13-14`), `EraserToolArgs.points` (`eraser.ts:66`),
`DodgeBurnToolArgs.points` (`dodgeBurn.ts:31`), `CloneStampToolArgs.points` (`cloneStamp.ts:18`),
`ColorReplacementToolArgs.points?` (`colorReplacement.ts:97`), plus the polygonal-lasso,
feather-magnetic-lasso, quick-selection and elliptical-selection args — and production really does
write them into history verbatim: `BurnToolArea.tsx:88-94` commits
`updateLayerByTool({ toolArgs: { …args, points: … } })`, and `updateLayerByTool` appends the
`TOOL_ACTION` entry at `useLayer.ts:376-386`. A `points` array of `Point` objects never contains
`undefined`, so the user-visible failure is not reachable today. But the arm is one stray element
away on a field already in production history, which is a stronger argument than the one it
replaces. The call sites are the ones that carry whole tool args — `convertSource:165` and
`operationForTool:495`, `:516`, `:546`.

**Fix.** Drop `undefined` elements in the array arm the way the object arm drops `undefined`
properties, and document that a sparse tool arg is normalised rather than rejected. If a future arg
genuinely must not be sparse, that is a per-arg rule with a named error, not a property of the
value copier.

Note for whoever re-derives the blast radius: `.kilo/plans/history-migration-finalisation-plan.md`
frames this as a choice between compaction and rejection and asserts `main` preserves sparse array
holes today. That is right about a true **hole** (`.map` skips it) and wrong about an explicit
`undefined`, which throws and voids the document — the plan never mentions the throw.

**Files.** `src/contexts/history-adapter.ts:101-120,165,495,516,546,648,800-802,868-876`,
`src/contexts/useLayer.ts:376-386`, `src/tools/draw.ts:13-14`, `src/tools/eraser.ts:66`,
`src/tools/dodgeBurn.ts:31`, `src/tools/cloneStamp.ts:18`, `src/tools/colorReplacement.ts:97`

---

## 94. A skipped duplicate leaves the fold advanced, so a later `set-document-frame` can carry a `previous` the durable history never reached

**Problem.** When a duplicate id is skipped, the publication is withheld and the **fold state is
deliberately left advanced** (`history-adapter.ts:752-782`). That breaks the invariant the frame
derivation states in its own docstring — `currentFrame` is the last enabled **durable** frame
(`:253`) — so a later `set-document-frame` that supplies no `previousFrame` takes its `previous`
from `currentFrame` (`:263`) and publishes a frame the durable history never reached.

**User-visible failure, today: none.** Nothing reads `previous`. Durable replay applies `next` only
(`durable-replay.ts:129-131`), exactly as `set-selection` applies `after` only
(`durable-replay.ts:140-142`). This is a latent hazard for the day something does read it, not a live
wrong answer — recorded here so the day it stops being latent is not also the day the advance is
"fixed" by someone who has not read this.

**The advance is deliberate and must not be undone.** `replayHistory` addresses entries by position
(`history-replay.ts:73`) and has no id check, so it **applies both** repeats and ends in the same
fold state the converter holds. Not advancing would add a second, independent way for a later
derivation to disagree with the legacy timeline — the converter would then differ from both the
document and itself. Parity is the reason; the stale `previous` is the price, and it is a price
worth paying while `previous` is unread.

**Fix.** Not a fix to the advance. When something starts reading `previous`, the invariant has to be
restored then — most likely by recording the durable-reachable frame separately from the fold — and
that change must re-point the pins at `history-adapter.diagnostics.test.ts:742` and `:764`, which
assert the advanced fold on purpose.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/durable-replay.ts`

---

## 95. A refused `PUBLISH_RUNTIME_PRESENTATION` reports an intended no-op as a lost user edit

**Problem.** `StoreContext` refuses the publication when
`layersDifferOnlyByPresentation(currentState.layers, action.payload.layers)` is false
(`src/contexts/StoreContext.tsx:849`) and logs one `console.error` for it
(`src/contexts/StoreContext.tsx:862`). The comment above it already knows the problem
(`src/contexts/StoreContext.tsx:851-852`): _"Two refusals share that outcome and mean different
things, so only one of them is reported."_ Two refusals, one message — so the second is not merely
unreported, it is **misreported**: a publication that is a deliberate no-op is logged with the text
of a lost logical edit.

**The second reason is an identity affine operation.** The shape, from the code:

- `normalizeCommittedToolArgs` returns `null` for a transform whose retained history args are the
  identity (`src/contexts/useLayer.ts:76`, tested by `isIdentityAffineTransform`,
  `src/contexts/affine-transform.ts:47`), so the operation is dropped from the **history args**.
- The layer record published alongside it is built from the preview and **copies the preview's
  operations array** (`src/contexts/useLayer.ts:391`), so the identity operation is still on it.
- `pendingToolEdits` is only pushed when the normalized args are truthy
  (`src/contexts/useLayer.ts:396`), so with nothing recorded the commit takes the
  `!pendingToolEdits.length` branch (`src/contexts/useLayer.ts:414`) and dispatches
  `PUBLISH_RUNTIME_PRESENTATION` (`src/contexts/useLayer.ts:417`) with a payload that differs from
  the stored layer in `operations` alone.
- `layersDifferOnlyByPresentation` (`src/contexts/layer-presentation.ts:96`) compares durable state,
  and `operations` is durable. The publication is refused, and a no-op is reported as an invariant
  violation.

**It is NOT reachable by dragging the rotate slider and releasing.** `Transform.tsx:48` calls
`tempUpdateLayer` and nothing else; the options bar has no commit gesture. The commit is
`commitDirtyTool(true)` at `src/contexts/useLayer.ts:348`, reached from `goToTool`, the Apply link, a
new layer, or `mergeAllLayers`. So the operation is **staged** by the slider and only meets the
publishing branch when one of those commits — and `useLayer.lifecycle.test.tsx:541` already pins
that a staged identity preview is discarded. Do not write the test for this by moving a slider and
releasing; nothing publishes.

**Why it matters beyond the log line.** The refusal is contained — nothing is persisted and
`previewLayersRef.current` is cleared at `src/contexts/useLayer.ts:400` — so no user edit is lost.
It is NOT the `tmpCanvas` story the comment at `src/contexts/StoreContext.tsx:850-851` tells for the
other refusal: the transform preview nulls `tmpCanvas` outright (`src/contexts/useLayer.ts:557`), so
there is no cached raster still rendering. What is lost is the signal — a `console.error` reading
"this action's invariant was broken" for a commit that did exactly what the user asked. Once that
text exists, the real violation is the one an operator learns to discount.

**Two tests already pin the message, so this is a change to them, not an addition beside them.**
`src/contexts/__tests__/useLayer.commit.test.tsx:258-261` asserts the call count, the invariant text
and the offending ids — and its own comment at `:256-257` already states the two-refusal claim this
entry is recording. `src/contexts/__tests__/StoreContext.presentation.test.tsx:315-318` pins the
count and the layer ids. Any fix must decide what those two assert for the identity case, which is
the actual design question, and it is not a question this entry can answer for you.

**Fix, and the decision it turns on.** A second predicate beside `layersDifferOnlyByPresentation` in
`src/contexts/layer-presentation.ts`, sharing one walk of the record rather than re-walking it,
answers "do these differ by presentation caches and by identity affine operations and nothing else?".
What `StoreContext` then does with a `true` is the decision:

- **Refuse, and report it as routine** — the smaller change. The invariant "a promotion carries
  caches only" stays absolute, so the identity case is still a violation of a literal rule, just a
  benign one. The two tests above keep asserting the lost-edit text for the durable difference, and
  gain an assertion that the identity case is _not_ reported that way.
- **Accept, and publish the stored record** — the larger change, and the one the durable model
  prefers. An identity operation in `layer.operations` with no history entry is live state the
  durable shadow cannot reproduce: the reducer deliberately does not move `durableStatus` on this
  transition (`src/contexts/StoreContext.tsx:510-515`), and `history-replay.ts:200` rebuilds
  `layer.operations` from history entries. Accepting the payload as-is would publish a record whose
  operations the shadow cannot re-derive. Publishing the STORED record instead makes the preview a
  pure no-op, which is what the user asked for.

Whichever is chosen, two details are load-bearing. `operations` **is** in `logicalLayerState`, because
`PRESENTATION_FIELDS` is only `bitmap` and `tmpCanvas`
(`src/contexts/layer-presentation.ts:70,76-78`), so it must be excluded explicitly on both sides. And
`getLayerAffineTransform` skips both non-affine kinds and disabled operations
(`src/contexts/affine-transform.ts:229-236`), so the filter must be exactly `kind === 'affine-transform'
&& isIdentityAffineTransform(op.transform)` — and since `createAffineLayerOperation` mints a fresh
uuid per preview (`src/contexts/layer-utils.ts:114`), the two sides are only comparable after the
identity entries are removed from **both**.

**Files.** `src/contexts/StoreContext.tsx:849-868`,
`src/contexts/__tests__/useLayer.commit.test.tsx:256-261`,
`src/contexts/__tests__/StoreContext.presentation.test.tsx:313-318`,
`src/contexts/layer-presentation.ts:96`, `src/contexts/useLayer.ts:76,391,396,400,414-417,557`,
`src/contexts/affine-transform.ts:47,229-236`, `src/contexts/layer-utils.ts:114`,
`src/components/ToolbarsRight/Transform/Transform.tsx:48`.

**Origin.** Salvaged from the unmerged `fix/unit-tests` branch, which also carried two
`history-adapter` changes — a duplicate-durable-entry-id filter and a frame-omission diagnostic.
Both have since landed on `main` by other routes (`history-adapter.ts:581,752,780` and the `else`
at `:656`). The `layer-presentation` predicate was the third part, and it has NOT landed: it is
absent from `main` today, and `fix/unit-tests` remains 2 commits ahead with 13 conflicting files,
`StoreContext.tsx` and `useLayer.ts` among them. Treat the branch as at-risk salvage, not as a clean
source, and re-derive from this entry rather than from its copy.

## 96. `docs/LAYERS-PANEL.md` §20 item 6 undercounts a live filename defect, by line numbers that no longer point at it

**Problem.** The file on disk is `e2e/OPEN_PROBLEMS.md`. The hyphen form `e2e/OPEN-PROBLEMS.md` names a
path that does not resolve — and that is not a macOS-only hazard, because a hyphen and an underscore
are different characters, so it is broken on a case-insensitive volume too. It is live in **three
files**:

```
$ git grep -n 'e2e/OPEN-PROBLEMS' -- . ':!HANDOFF.md'
TEST-FLAKES.md:722:(`e2e/OPEN-PROBLEMS.md`, the CDP-capture P2), and it prints both bounding boxes when it fires.
docs/LAYERS-PANEL.md:825:6. **The `e2e/OPEN-PROBLEMS.md` filename mismatch — a _docs_ defect with no routed home.** The file
e2e/viewport-drawing.spec.ts:228:   * that drift is a filed defect (`e2e/OPEN-PROBLEMS.md`, the CDP-capture P2). The
```

`docs/LAYERS-PANEL.md:826-834` reports it as "written in **only two files, five lines**:
`AGENTS.md:15`, `:165`, `:172` and `TEST-FLAKES.md:391`, `:657`". Every one of those five citations
is stale, and two of the four files it names (`AGENTS.md`) no longer hold the typo at all — the
routing table rewrite replaced them with the underscore form. Its supporting premise is stale the
same way: `AGENTS.md` no longer carries the route-by-scope rule that the item argues from, and that
rule is now `docs/DOCUMENTATION.md:103-117`. So `TEST-FLAKES.md:391` and `:657` name a port note and
a marker-bounding-box note rather than a filename reference, and `:712` in an earlier revision of this
entry was the occurrence that is now at `:722`.

**The three survivors route differently, and two of them are not this file's business.**
`TEST-FLAKES.md:722` and `docs/LAYERS-PANEL.md:825` are prose, so this entry is their routed home.
`e2e/viewport-drawing.spec.ts:228` is a comment inside a Playwright spec, so by the same routing table
it belongs in `e2e/OPEN_PROBLEMS.md` — **and no such entry exists** (`grep -in 'OPEN-PROBLEMS' e2e/OPEN_PROBLEMS.md`
is empty). A fix confined to the two prose files leaves that third occurrence standing, which is
almost certainly how it has survived every earlier pass.

**Fix.** Correct all three to the underscore form, filing the `e2e/viewport-drawing.spec.ts:228`
occurrence in `e2e/OPEN_PROBLEMS.md` rather than here. Then delete or rewrite §20 item 6 so it
asserts neither a five-line census nor the `AGENTS.md` premise. Re-derive the remaining line numbers
from the prose at the time of the fix: `AGENTS.md` is the file every agent reads first, so a citation
into it silently rots, and its own rule says as much.

**Files.** `docs/LAYERS-PANEL.md:824-834`, `TEST-FLAKES.md:722`,
`e2e/viewport-drawing.spec.ts:228`, `docs/DOCUMENTATION.md:103-117`

---

## 98. The console log is the app's whole error channel, by decision

**Decided 2026-09-30: the app gets no user-facing error surface.** Swallowing a failure is acceptable
provided the console reports it. Every `alert()` was removed in favour of `console.error`
(`155ba7b8`), and nothing replaced them: `git grep -iE "toast|snackbar|notif"` over production `src/`
returns nothing, and `ErrorBoundary` is mounted at only two places (`src/App.tsx:92,96`), catches
React render throws only, and covers neither `Menu`, `MobileMenuDrawer` nor `MobileHeader`.
**Do not "fix" a silent failure by adding a dialog or a banner** without asking again — the reasoning
that removed the alerts applies to whatever would replace them.

**The accepted cost, which is real and deliberate.** A failed file open, save, export or selection
copy is invisible on screen. Export is the sharpest case: `handleImageSave`'s `finally` closes the
save dialog unconditionally (`src/contexts/useFile.tsx:133-136`), so a failure closes it exactly as a
success does, and on desktop the screen is then byte-identical to success — `fileName` is rendered
only at `src/components/Mobile/MobileMenuDrawer.tsx:110` and `src/components/Mobile/MobileHeader.tsx:107`,
and `hasUnsavedChanges` is rendered nowhere, appearing in components only inside the three `confirm()`
guards. This is reachable by decision, not by accident: entry 45 keeps the 80 MP AVIF ceiling, so an
80–100 MP document is _supposed_ to fail to export.

No data is lost. `useApp.handleImageSave` (`src/hooks/useApp.ts:67-71`) is the only writer of
`hasUnsavedChanges: false` and of the rename, and it is guarded by `if (data)` at every call site, so
a failed export leaves the document dirty and intact rather than half-saved.

**What the decision required.** A report is only as good as the channel, so the console gap had to be
closed for it to hold. `copyActiveSelection` returns `false` without throwing for every null-snapshot
case (`src/contexts/useSelectionClipboard.ts:41-62`), and seven call sites used to discard that boolean
in silence — `FreehandLasso.tsx`, `FeatherMagneticLasso.tsx`, `MagicWand.tsx`, `QuickSelection.tsx`,
`EllipticalSelection.tsx`, `RectangularSelection.tsx` and the `AppKeyboardShortcuts.tsx` copy shortcut.
All seven now log it, so no failure path is silent. The file and export sites also pass the caught
value as a second argument instead of stringifying it, so a non-`Error` rejection reaches the log as
its reason rather than as `[object Object]`.

**What is not covered.** Each report is pinned by a unit test asserting the exact `console.error`
call, including the non-`Error` cases. No Playwright spec drives a failed open, save, export or
copy, so those four paths have no browser-level coverage. (Console and page errors are no longer
unasserted in general: `e2e/helpers/console-police.ts` fails every spec on an unaccepted console
error or page error. What remains true here is narrower — those four paths are never _reached_
in a browser, so nothing there could produce a message for it to catch.)

**Files.** `src/contexts/useFile.tsx:118-136`, `src/hooks/useApp.ts:67-71`,
`src/contexts/useSelectionClipboard.ts:41-62`, `src/components/Main/Main.tsx:183,355,369`,
`src/components/DesktopHeader/DesktopHeader.tsx` (File > Save handler),
`src/components/Mobile/MobileMenuDrawer.tsx:49,60,82,110`,
`src/components/Mobile/MobileHeader.tsx:81,107`, `src/App.tsx:92,96`,
`src/util/selection.ts:430-442`.

## 99. Every `history-replay.ts` line citation past `:89` is off by twenty

**Problem.** The bedrock-frame assignment in `replayHistory` is now wrapped in `if (index === 0)`
(`history-replay.ts:103-109`), which turned a five-line block into a thirteen-line one, and the
`documentSource` arm above it grew a gate of its own (`:89-94`). Every cited line up to `:78` still
points where it did; **every citation past `:89` is now twenty lines early**, and the shift in between
is not uniform (`:79-82` moved eleven, `:83-84` twelve, `:85-89` nineteen). The citations were all
correct before the gates and are all wrong after them, so nothing here is pre-existing rot — it is
drift this change introduced.

**Why it matters.** These are references a session follows instead of reading, and `history-replay.ts`
ends at 227, so a twenty-line miss lands inside the neighbouring arm rather than past the file. The
sites this entry listed in other documents have been re-pointed; the ones left are in the history
tests, which still quote the bedrock block as `:85-97`
(`history-adapter.branches.test.ts:724`, `:771`, and `useHistory.test.tsx:413`), the document-frame
arm as `:99-105` (`history-adapter.branches.test.ts:344`) and the document-source arm as `:78-84`
(`:669-670`). Entry 96 in this file is the same genre of defect for the same reason.

**Fix.** Re-point each site by reading the file, not by arithmetic — the shift is not uniform below
`:89`. For reference, past `:89` the two gates together moved everything twenty lines down: the
bedrock block is `:103-109`, the document-frame arm `:111-117`, the layer arms `:126-161`, the
`layer-operation` test `:172` and the `document-operation` `continue` `:215`. Already correct, and
re-verified against the working tree: the `set-document-frame` comment in
`src/contexts/history-adapter.ts:707-717` (which now names `frameFromFirstEntryBedrock` and cites
`:103-109`), `src/contexts/history-adapter.ts:303` and `:670`, and `src/contexts/history-append.ts:179`
and `:464`. The four sites in this file are re-pointed too. Sites still stale:

- `src/contexts/__tests__/history-adapter.branches.test.ts:344` (`:99-105`), `:669-670` (`:78-84`), `:724` and `:771` (`:85-97`), `:1407` (`:135`)
- `src/contexts/__tests__/useHistory.test.tsx:413` (`:85-97`)

**Files.** `src/contexts/history-replay.ts`

---

---

## 101. A new blank image keeps the previous document's file name, so Save As pre-fills the old file's name

**Problem.** `src/contexts/useLayer.ts:199-212` builds the `REPLACE_DOCUMENT` payload for a new
document and omits `fileName` from `updates`. `REPLACE_DOCUMENT` spreads caller `updates` over state
(`src/contexts/StoreContext.tsx:574`), so the field is simply never written and the outgoing
document's name survives. The other two document-creation paths both set it — the raster open through
`_setFileName` (`src/hooks/useApp.ts:164`) and the PSD open through `updates.fileName`
(`src/hooks/useApp.ts:128`) — which is exactly why the omission reads as an accident rather than a
decision.

Measured 2026-09-30 against the real `StoreProvider`, driving `setBlankImage` after seeding a document
named `holiday-photo.png`:

```
PROBE fileName after setBlankImage = "holiday-photo.png"
PROBE hasUnsavedChanges = true
```

Consequence: a document the user just created from scratch is named after a file that had nothing to
do with it. The stale name reaches the export path through three hops — the store's `fileName` into
`openSaveImageDialog` (`src/components/DesktopHeader/DesktopHeader.tsx:253`), into `setFileInput`
(`src/contexts/useFile.tsx:110`), and out as `SaveDialog`'s `proposedName`
(`src/contexts/useFile.tsx:174`) — so the save dialog is pre-filled from the old file. On mobile the
staleness is also on screen, in the two components that render it (`MobileHeader.tsx:107`,
`MobileMenuDrawer.tsx:110`); on desktop nothing displays it, so there the stale name is invisible until
a save. `hasUnsavedChanges` is not rendered anywhere, so there is no dirty-marker reading either way —
its only consumers are the two `confirm()` guards at `DesktopHeader.tsx:200` and `:225`.

**Fix.** Add `fileName` to the `updates` block in `_addLayer`'s `newDocument` branch
(`src/contexts/useLayer.ts:199`). A new document's name is a product decision, not a derivation — the
PSD arm sets the imported name, so the blank arm needs the untitled one (`BlankImageParams` at
`src/contexts/tool-types.ts:107` carries no name field, so either a constant is introduced or the
value arrives from the caller alongside `size`; `src/App.tsx:21`'s `DEFAULT_BLANK_IMAGE` is the
existing precedent for a caller-supplied default). `src/hooks/__tests__/useApp.document-reset.test.tsx`
is the place to pin it, and its `expectOutgoingDocumentKilled` helper deliberately asserts nothing
about `fileName` today — adding that assertion is the fix's own tripwire, so it must be added in the
same change.

**Files.** `src/contexts/useLayer.ts:199-212`, `src/contexts/StoreContext.tsx:574`,
`src/hooks/useApp.ts:128`, `:164`, `src/contexts/useFile.tsx:110`, `:174`,
`src/components/DesktopHeader/DesktopHeader.tsx:253`, `src/components/Mobile/MobileHeader.tsx:107`

---

## 102. A failed raster open resizes the canvas and then keeps the old document

**Problem.** `src/hooks/useApp.ts:160-164` resizes the canvas before it has anything to replace:

```ts
const { image } = data;
const size = { width: image.width, height: image.height };
handleImageCreate(size); // :162  resizes the canvas
await createLayerFromBitmap({ bitmap: image, name: fileName, size, isBedrock: true }, true); // :163  may reject
```

`createLayerFromBitmap` awaits `immutableRaster` (`src/contexts/useLayer.ts:253`) before it dispatches
`REPLACE_DOCUMENT`, so a decode failure rejects at `:163` with the canvas already resized and no store
transition published. The store half is correct — the retained document is untouched, and
`src/hooks/__tests__/useApp.document-reset.test.tsx` pins exactly that as a negative control. The
canvas half is not: it is now the new file's size while the document, `totalSize` and `documentFrame`
are all still the old one.

Measured 2026-09-30, failing a 64×48 open against a seeded 800×600 document:

```
PROBE canvas after failed open = 64 x 48
PROBE document totalSize after failed open = {"width":800,"height":600}
PROBE documentId after failed open = outgoing
```

The retained document then renders through a canvas of the wrong size until something redraws it, and
the overlay refs are untouched, so the tool overlay keeps the old geometry while the base canvas does
not. The PSD arm already gets this right — it resizes all three refs at `:111-115` only after
`immutableRaster` has resolved every layer at `:88-104`.

**Fix.** Move `handleImageCreate(size)` to after `await createLayerFromBitmap(...)`, matching the PSD
arm's ordering, or resize inside `_addLayer`'s `newDocument` branch where the replacement is
published. Three things must change in the same commit, all of them pins of this defect rather than of
intended behaviour:

- `src/hooks/__tests__/useApp.image-upload.test.ts:148-153` asserts
  `['resizeCanvas:80x480', 'resizeCanvas:80x40', 'createLayerFromBitmap', 'SET_FILE_NAME']`.
- `src/hooks/__tests__/useApp.image-upload.test.ts:174-179` asserts the same shape with a live canvas
  read — `createLayerFromBitmap(canvas=120x90)` is interpolated from inside the mock, so it pins the
  canvas's dimensions at the moment the layer build starts and cannot be satisfied by reordering alone.
- The `it` titles at `src/hooks/__tests__/useApp.image-upload.test.ts:143` and `:167` declare the
  ordering as the behaviour ("has already resized the canvas to the image size when the layer creation
  starts"), so renaming the expectations while leaving those titles would leave the test promising the
  defect.

**Files.** `src/hooks/useApp.ts:160-164`, `src/contexts/useLayer.ts:247-277`,
`src/hooks/__tests__/useApp.image-upload.test.ts:143-180`,
`src/hooks/__tests__/useApp.document-reset.test.tsx` ("kills nothing when the import fails before the
document is replaced")

---

## 103. The `REPLACE_DOCUMENT` fast path is a second, untested copy of the reducer's identity logic

**Problem.** `src/contexts/StoreContext.tsx:1064-1108` intercepts `REPLACE_DOCUMENT` before it
reaches the reducer. It recomputes seven fields the reducer's own `REPLACE_DOCUMENT` arm
(`:568-586`) also computes — `documentFrame`, `totalSize`, `documentId`, `documentRevision`,
`branchRevision`, `history`, `historyIndex` — assigns them to `latestStateRef.current` at
`:1085-1097`, and then calls `rawDispatch`, so the reducer runs anyway and React state is recomputed
from the reducer chain. The two copies are related by nothing but a comment.

**Measured 2026-09-30, one field at a time, against the real provider** with
`src/hooks/__tests__/useApp.document-reset.test.tsx` (12 tests, all green):

| fast-path line | field              | mutated to                      | result                                                                               |
| -------------- | ------------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| `:1088`        | `documentFrame`    | `currentState.documentFrame`    | **survives**                                                                         |
| `:1089`        | `totalSize`        | `currentState.totalSize`        | **survives**                                                                         |
| `:1090`        | `documentId`       | `currentState.documentId`       | **survives**                                                                         |
| `:1091`        | `documentRevision` | `currentState.documentRevision` | **survives**                                                                         |
| `:1092`        | `branchRevision`   | `currentState.branchRevision`   | **survives**                                                                         |
| `:1096`        | `history`          | appended instead of replaced    | **survives**                                                                         |
| `:1097`        | `historyIndex`     | `currentState.historyIndex`     | **survives**                                                                         |
| `:1082`        | disposal guard     | `if (false)`                    | caught — but by `StoreContext.durable-boundary.test.tsx:711`, not by any other suite |

Seven of eight survive, and the reason is structural rather than incidental: the pre-write lands in
`latestStateRef`, which the next dispatch reads as its `currentState`, and that value is used only to
(a) decide document disposal and (b) seed the _next_ fast path. It never reaches `useReducer`, so no
React state and no exported value can observe it. The one append that reads a cursor —
`updateHistoryTimeline` — clamps it, so even a stale `historyIndex` yields the same timeline.

**Why it matters.** The duplication is a real correctness surface, not dead code: `currentState` is
read by the disposal guard, so a wrong `documentId` at `:1090` would dispose the wrong document's
assets — and that is precisely the one field whose divergence is currently caught by a different
suite, which is luck rather than design. Nothing binds the two copies together, so an edit to the
reducer arm that is not mirrored at `:1085-1097` is invisible, and an edit to the fast path that is
not mirrored in the reducer is invisible too.

**Fix.** Two options, and the second is the real one. Either expose the fast path's pre-write to a
test — `latestStateRef` is already in the provider's value, so a store test can assert the seven
fields directly and pin the two copies against each other. Or delete the fast path and let the
reducer be the only writer; the pre-write exists to make same-batch dispatches see the new document,
which `useSetSelectionFromHistory` and the append path need, so deletion is not free and the first
option is the cheaper correct move. Whichever is chosen, the seven lines above are the list.

**Files.** `src/contexts/StoreContext.tsx:1064-1108`, `:568-586`,
`src/contexts/__tests__/StoreContext.durable-boundary.test.tsx:711`

## 106. `docs/TOOLS-RESEARCH-BRIEF.md` cites four numbers for one file, and all four are stale

```bash
wc -l .skills/photoshop-tool-creation.md       # 4,455
grep -n '^## Photoshop shape tools\|^## The tool backlog\|^## Appendix A' \
  .skills/photoshop-tool-creation.md
```

which prints `373:## Photoshop shape tools`, `3879:## The tool backlog — what to build next` and
`4094:## Appendix A — the trap list`.

`docs/TOOLS-RESEARCH-BRIEF.md:102-104` says "a 4,371-line playbook", its `## Photoshop shape tools`
section is "`:357-846`", its `## The tool backlog` is "`:3797`" and its `## Appendix A` is
"`:4012`". Every one of those points at content that has since moved. This is the citation-staleness
defect `.skills/photoshop-tool-creation.md` phase 9 exists to catch, in the one document that tells
an agent what to read before writing a tool — and the drift is in the count as well as the anchors,
which is the case a `grep` cannot see.

**Fix.** Re-derive all four from `wc -l` and `grep -n` at the moment of writing, and consider naming
the sections by heading rather than by line, since a heading survives a merge and a line number
does not.

**Files.** `docs/TOOLS-RESEARCH-BRIEF.md:102-104`, `.skills/photoshop-tool-creation.md`

## 107. `docs/ORCHESTRATION.md` cites a handoff section and a source line that both point at the wrong thing

The pointer in the document every other worktree rule defers to: `docs/ORCHESTRATION.md:201` cites
`db.mjs:1130` for the `lock.agent_id !== who` conflict test. `:1130` is `holdFiles`' own signature
line. The lock-level comparisons are `scripts/lib/agent-board/db.mjs:1163` (inside `holdFiles`) and
`:1554` (inside `lockFile`); the claim-level ones are `:1071`, `:1320`, `:1587` and `:1677`.

It matters more than an ordinary stale citation because it sits inside a rule an agent is told to
obey rather than to check — the section that ends "Only `e2e-run/<…>/<digits>` is probed" — and
because the wrong line names a function rather than a comparison, so a reader who opens `db.mjs:1130`
sees something that looks like the rule and is not.

A second, now-corrected pointer: `docs/ORCHESTRATION.md:117` attributed the `git stash` rule to
"HANDOFF §69", which was an eraser-preview defect, not the stash rule, and the real rule's own entry
restated `docs/ORCHESTRATION.md` back at it. Both entries are now deleted and the dangling pointer
went with them, so `docs/ORCHESTRATION.md` carries the stash rule once and on its own.

**Files.** `docs/ORCHESTRATION.md:201`, `scripts/lib/agent-board/db.mjs:1130`, `:1163`, `:1554`

## 108. `.skills/photoshop-tool-creation.md` carries ~200 source citations it last verified two days before `main` moved, and it does not know which are dead

The skill's own header says every `file:line` was "last re-verified on 2026-09-28", and `main` has
moved since. The four worst instances are confirmed stale today:

- **`:492`** quotes `e2e/README.md:30` for "npm run test:e2e is **headless by default. Keep it that
  way.**". That sentence is at `e2e/README.md:73`; `:30` is the "Counts are deliberately absent…"
  line. The same paragraph says the README is "415 lines" and it is **580**.
- **`:3774-3779`** and **`:3766-3767`** assert `e2e/README.md:401-411` still says the `e2e` job is
  `continue-on-error: true`, and instruct the reader that "the README is the stale one — fix it in
  the same commit". It is already fixed: `e2e/README.md:401-411` is a file listing of the export
  baselines, and the history is at `:564`, which reads "It **was** `continue-on-error`". **This
  instructs an agent to "fix" a correct document.**
- **`:3137`**, **`:3553`**, **`:3766`**, **`:4328`** say the pass/skip count lives in
  `e2e/OPEN_PROBLEMS.md:41-42`. `:41` is blank and `:42` is the `## Observed failures` heading;
  `grep -c '97 pass\|skipped by declaration' e2e/OPEN_PROBLEMS.md` returns **0**. The count moved
  to `AGENTS.md:129` and nothing in the file says so.
- **`:3207-3208`** cites `e2e/README.md:243-263` for `testInfo.snapshotDir`, which is at `:395`; and
  **`:3770-3772`** cites `e2e/OPEN_PROBLEMS.md:13-17` for a passage that starts at `:19`.

**Why this is filed as one entry rather than five.** The individual fixes are mechanical and were
deliberately **not** made here: a bulk re-derivation of a 4,455-line document's citations is its own
job, and doing it in a change whose subject was orchestration rules would hide the diff. The defect
worth recording is the **shape**: the skill asserts verified citations over `src/`, `e2e/` and
`scripts/`, has no way to know which half are dead, and its phase 9 rule ("verify every citation
before you commit the handoff") is scoped to the handoff the skill writes rather than to the skill
itself. A skill that carries hundreds of line-numbered claims about a moving tree needs either a
dated re-verification pass recorded per section, or citations that name a **symbol** rather than a
line — which its own header already recommends and its own body does not follow.

**Fix.** Run the re-derivation as its own change: for every `file:line` in the skill, check the
line, and where it has moved, replace it with `file:symbol` rather than a new number. Then record
the date the pass covered. Fix the `e2e/README.md` `continue-on-error` instruction **first**, since
it is the one that causes an agent to make the tree worse.

**Files.** `.skills/photoshop-tool-creation.md:492`, `:3774-3779`, `:3137`, `:3207-3208`, `:3553`,
`:3766`, `:3770-3772`, `:4328`; `e2e/README.md:30`, `:73`, `:401-411`, `:564`;
`e2e/OPEN_PROBLEMS.md:41-42`

## 109. `.skills/hard-merge.md` cites eight source locations that have moved, three of them inside a paragraph that tells the reader to re-derive

`.skills/hard-merge.md` has the strongest evidentiary discipline of any document here — it names the
tree it was read against, and Appendix F is entirely about not trusting a citation. These are the
ones that did not get re-derived:

| line                   | claims                                                           | actually                                                                     |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `:433`                 | `git.mjs:183-224` is `mergeConflict`                             | `git.mjs:198` (`export function mergeConflict`)                              |
| `:445`                 | "JSDoc at `git.mjs:193-196`"                                     | `:194-197`                                                                   |
| `:445`                 | `return { conflict: null, … }` at `:226-231`                     | the two returns are at `:231` and `:233`                                     |
| `:1129`                | `'toolbar-overflow'` present on `main` at `:859`                 | `scripts/lib/worktree-inventory/curated.mjs:947`                             |
| `:1067`                | "of the last 200 merge commits on `main`, 50 carry a body"       | re-running the document's own command returns **62**                         |
| `:851-853`, `:868-871` | "matches 83"; "78 times … and 5 in `HANDOFF.md`"                 | 92 uncorrected today: 79 in this skill, 7 in `HANDOFF.md`                    |
| `:829-830`             | quotes `ef85d3ab`'s subject                                      | the real subject ends "**and shorten it**"; quoted with no ellipsis          |
| `:1426`                | "See `docs/ORCHESTRATION.md:290-294`" for the expired-lease trap | that range is the `mustNotPrune` paragraph; the lease material is `:596-606` |

The load-bearing claim — that the **corrected** pattern has **0** occurrences — still holds, so the
rule the numbers support is intact. What is broken is every number a reader would copy.

**Fix.** Correct the eight, and prefer the symbol over the line everywhere in this file, because
Appendix F's own argument is that a line number is a property of a moment.

**Files.** `.skills/hard-merge.md:433`, `:445`, `:829-830`, `:851-853`, `:868-871`, `:1067`,
`:1129`, `:1426`; `scripts/lib/worktree-inventory/git.mjs:198`,
`scripts/lib/worktree-inventory/curated.mjs:947`

## 110. `ToolbarsRight/Lasso/Lasso.tsx` has no importer, and it is the only UI for two persisted lasso settings

`src/components/ToolbarsRight/Lasso/Lasso.tsx` (152 lines) is not reachable:

```bash
git grep -nE "import .*\bLasso\b.* from" -- src e2e   # zero hits
git grep -n "Lasso/Lasso.tsx" -- src e2e             # zero hits
```

`src/tools/toolsMap.ts:65-79` wires the three lasso keys to `PolygonalLasso`, `FreehandLasso`
and `FeatherMagneticLasso`. The component's only consumer is its own test,
`Lasso/__tests__/Lasso.test.tsx`, which renders a component the app can never reach.

**It is nevertheless the only place `lineWidth` and `alpha` are editable**, and both are
persisted defaults for two live keys:

- `src/tools/settings.ts:96-111` — `'polygonal-lasso'` and `'freehand-lasso'` each declare
  `{ alpha: 1, lineWidth: 3, color: '#FF0000', fill: false, points: [] } satisfies LassoToolArgs`.
- `src/tools/polygonSelection.ts` types all of them, and `PolygonSelectionToolSettings` is
  `Omit<LassoToolArgs, 'points'>` — so they survive a reload.
- `PolygonalLasso.tsx` and `FreehandLasso.tsx` render **hint text only**; neither has a control.

So deleting it is not a cleanup, it is a second defect: two persisted settings with no UI
at all, and a settings bucket that round-trips values a user can no longer change. **The real
defect is the missing options bar.** `src/tools/descriptions/selection.notes.md:92` already
records what Photoshop's Polygonal Lasso bar carries — the four combination modes, `Feather`,
`Style` and `Anti-alias` — and marks them absent here, while `FeatherMagneticLasso` ships
`featherRadius` / `magneticWidth` / `edgeContrast` / `frequency` (`settings.ts:112-116`).

The component is also wrong if reconnected: `Lasso.tsx:22` hardcodes
`toolName: 'polygonal-lasso'` into every `setToolArgs`, so wiring it to the freehand key would
label that tool's panel with the polygonal name.

**Fix.** Do not delete. Port `lineWidth` and `alpha` — and Photoshop's `Feather` and
`Anti-alias` — into `PolygonalLasso.tsx` and `FreehandLasso.tsx`, which are the components the
keys actually render, and delete `Lasso.tsx` and `Lasso.test.tsx` **in the same change**. The
two hints in `Lasso.tsx:145-146` ("Backspace removes anchor • Enter finishes • Esc cancels")
are behaviour the live panels do not document, so carry them across too.

**Files.** `src/components/ToolbarsRight/Lasso/Lasso.tsx`,
`src/components/ToolbarsRight/Lasso/PolygonalLasso.tsx`,
`src/components/ToolbarsRight/Lasso/FreehandLasso.tsx`,
`src/components/ToolbarsRight/Lasso/__tests__/Lasso.test.tsx`, `src/tools/settings.ts:96-111`

## 112. Freeform Pen and Curvature Pen render the standard Pen's chip list, and a test documents the wrong config as expected

`src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:23-25` defines:

```ts
pen:             ['Tool Mode', 'Fill', 'Stroke', 'Make Selection', 'Path Operations', 'Alignment', 'Auto Add/Delete'],
'freeform-pen':  ['Tool Mode', 'Fill', 'Stroke', 'Magnetic', 'Curve Fit'],
'curvature-pen': ['Tool Mode', 'Fill', 'Stroke', 'Magnetic', 'Curve Fit'],
```

but `src/tools/toolsMap.ts:132` and `:137` point all three at the **`pen`** key, so
`freeform-pen` and `curvature-pen` render the standard Pen's seven chips. **Magnetic and Curve
Fit are the two controls that are the entire reason those two tools exist** — a Freeform Pen
tool without Magnetic, and a Curvature Pen without Curve Fit, are the Pen under another name
(`src/tools/descriptions/pen.notes.md`, `docs/TOOLS.md:1656`, `:1716`).

`ToolbarPlaceholder.test.tsx:163-172` asserts the resulting dead config is
`expect(unreachableKeys).toEqual(['freeform-pen', 'curvature-pen', 'rectangle'])` and the
comment is explicit that the list is _meant_ to be short. So this test is **half a pin**: it is
doing its stated job against a growing pile, and it will fail the moment the wiring is fixed.
The fix and the test must land together, with the list shrinking to `['rectangle']`.

`rectangle` is the third unreachable group and is **correct** to be there: `rectangle` is a
registry id the rail never names (see §114), so it renders the real `Shape` bar.

**Fix.** Pass `'freeform-pen'` and `'curvature-pen'` as the second argument of their
`placeholderTool(...)` calls in `toolsMap.ts`, and update the expected array in the same
change.

**Files.** `src/tools/toolsMap.ts:129-138`,
`src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:24-25`,
`src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:163-172`

## 113. `docs/TOOLS-TOO-HARD.md` attributes the placeholder-tool policy to `AGENTS.md`, which does not contain it

`docs/TOOLS-TOO-HARD.md:214-215`:

> "`AGENTS.md` is explicit that this is the correct state for a tool the app cannot do: the
> Photoshop grouping and naming are the specification, and the stub bar is the debt."

`grep -rn "grouping and naming are the specification" --include='*.md'` returns exactly two
hits — `docs/TOOLS-TOO-HARD.md:215` and `docs/PHOTOSHOP-UX.md:65`. `AGENTS.md` is 158 lines
with no match for _placeholder_, _specification_, _grouping_ or _stub bar_.

The policy is real, deliberate, and load-bearing: `docs/PHOTOSHOP-UX.md:62-66` — _"A tool the
app cannot actually do still belongs in the rail, rendering Photoshop's real options bar,
because that is the contract… Seven tools currently render a `PlaceholderTool` chip bar instead
— the six Pen-family tools and Custom Shape. Photoshop's grouping and naming are the
specification; the stub bar is the debt."_

**Why this matters beyond a citation.** Six of the seven placeholder tools were audited for
deletion this week and every one came back "keep" **because of that policy**. An agent
reasoning from `TOOLS-TOO-HARD.md` follows a citation that resolves to nothing, and the natural
conclusion from a missing policy is that no policy was ever written down.

**Fix.** Change `AGENTS.md` to `docs/PHOTOSHOP-UX.md:62-66` in that one sentence.

**Files.** `docs/TOOLS-TOO-HARD.md:214-215`, `docs/PHOTOSHOP-UX.md:62-66`

## 114. `rectangle`, `ellipse`, `triangle`, `polygon` and `line` are `ToolName`s the rail can never select, and nothing states whether they are load-bearing

`toolbar-mapping.ts:110-114` (repo root) gives the toolbox entries
`name: 'shape'` plus a `figure`, never the key:

```ts
{ label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' },
{ label: 'Ellipse Tool',    name: 'shape', figure: 'oval' },
{ label: 'Line Tool',       name: 'shape', figure: 'line' },
{ label: 'Triangle Tool',   name: 'shape', figure: 'triangle' },
{ label: 'Polygon Tool',    name: 'shape', figure: 'polygon' },
```

All four activation surfaces translate — `SidebarLeft.tsx:580-583`,
`Mobile/mobile-tools.ts:77-85`, `DesktopHeader.tsx:112-117`,
`AppKeyboardShortcuts.tsx:109-136` — and `useApp.ts:196` is the only `SET_TOOL_NAME` dispatch
in `src`, so the enumeration is complete. `DesktopHeader.tsx:67-76` records that dispatching the
key directly was a **bug they fixed**: it mounted the Shape panel where the
`toolName !== 'shape'` guard at `Shape.tsx:32` suppressed the colour publish, so the well said
red and the shape committed black.

So the five keys are unreachable as a `toolName` but wired: each has a `ToolArgs` union variant
(`src/contexts/tool-types.ts:65-77`), a per-figure settings bucket (`src/tools/settings.ts:278-312`),
a description record (`src/tools/descriptions/shape.ts:290,318,345,387,423`) and doc sections.
`docs/PHOTOSHOP-UX.md:46-54` names them as _"registry ids the rail never names"_ and frames the
rail-naming decision around them.

**What is not stated anywhere is whether they are forward-scaffolding or residue**, and one fact
would settle it: **can a durable document or a replayed history item carry
`toolName: 'rectangle'`?** `src/tools/toolProcessors.ts:326-330` registers all five as
`{ creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape }`,
so a committed shape carries its tool name into history. The dispatch path is closed in the
running app, but document import and the durable `ToolArgs` deserialiser were **not** audited
for a persisted figure-key `toolName`. If one can arrive, these keys are load-bearing for
existing documents and deleting them is a data-loss change; if none can, they are pure residue
and the `ToolArgs` union is carrying five variants nothing constructs.

**Fix.** Audit the import and durable-replay path for a persisted figure-key `toolName`, then
either state in `docs/PHOTOSHOP-UX.md` that the five ids exist to keep historical documents
replayable, or delete them together with their `ToolArgs` variants, settings buckets and
descriptions. Whichever it is, `ToolbarPlaceholder.test.tsx:172`'s `rectangle` entry in the
unreachable-config list changes and that test moves with it.

**Files.** `toolbar-mapping.ts:110-114`, `src/tools/toolsMap.ts:154-159`,
`src/tools/toolProcessors.ts:326-330`, `src/contexts/tool-types.ts:65-77`,
`src/tools/settings.ts:278-312`, `docs/PHOTOSHOP-UX.md:46-54`,
`src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:163-172`

## 115. The rectangular marquee ships no options bar at all, while the elliptical marquee beside it ships four controls

`src/tools/settings.ts:130` declares
`'rectangular-selection': { toolName: 'rectangular-selection' }` — **no settings whatsoever** —
while `:220-226` gives `elliptical-selection` `style`, `fixedRatio`, `fixedWidth` and
`fixedHeight`, implemented in full at `src/tools/ellipticalSelection.ts:9,51-67` down to the
`MARQUEE_RATIO_MIN/MAX` and `MARQUEE_SIZE_MIN/MAX` bounds.

`RectangularSelection.tsx:36` is, in full, the literal string
`'Draw a rectangle and copy selected bitmap area.'` plus Copy / Paste / Clear.

Photoshop's rectangular marquee carries the same four combination modes, `Style` and the
`Width`/`Height` pair, and `src/tools/descriptions/selection.notes.md:92` already records them
as absent. Since `docs/PHOTOSHOP-UX.md:62-66` makes the rendered bar the contract, this is debt
on a **shipped, working, reachable** tool — the rectangular marquee is a rail tile
(`toolbar-mapping.ts:41`) with the `M` shortcut.

**Fix.** Give `RectangularSelectionToolArgs` the same `MarqueeStyle` field the ellipse uses,
extract `ellipticalSelection.ts:121-131`'s `applyRatio` as a shared ratio helper, and render
the four controls.

**Files.** `src/tools/settings.ts:130`, `src/tools/rectangularSelection.ts:4-7`,
`src/components/ToolbarsRight/RectangularSelection/RectangularSelection.tsx:36-48`,
`src/tools/descriptions/selection.notes.md:92`

## 116. Three of the six pen tools have no shortcut and no Tools-menu entry

`AppKeyboardShortcuts.tsx:33` binds `penGroup = ['pen', 'freeform-pen', 'curvature-pen']`, so
`P` / `Shift+P` cycle three of the six. `add-anchor-point`, `delete-anchor-point` and
`convert-point` have **no keybinding** and no Tools-menu entry — `DesktopHeader.tsx:56-58` lists
only the three pens. `AppKeyboardShortcuts.tsx:109-137` is the only `DEFAULT_KEYBOARD_SHORTCUTS`
consumer and `useApp.ts:196` the only `SET_TOOL_NAME` dispatch, so the enumeration is complete.

**Both other halves of the earlier version of this heading are wrong, and the rail never needed
them.** The icons are **not** identical: `SidebarLeft/toolIcons.tsx:75-79` gives `freeform-pen` its
own `FreeformPenIcon`, and `toolbar-mapping.ts:135-147` gives each of the six its own label. The
Tools-menu absence is Adobe's own doing — Adobe's keyboard-shortcut reference (Adobe, primary, and
the source `docs/PHOTOSHOP-UX.md:191` cites for its own shortcut list) lists **no** shortcut for
`Add Anchor Point`, `Delete Anchor Point` or `Convert Point`, so a menu row for them would be a
departure rather than a fix, and `docs/OVERRIDES.md` has no entry authorising one. What
`docs/TOOLS.md:1755`, `:1787`, `:1823` record is only that the shortcuts do not exist, which is what
this entry says.

**The rail half does not survive either.** `docs/PHOTOSHOP-UX.md:110` states the six Pen-family
tools "currently render a `PlaceholderTool` chip bar instead", and its open-violations section
(`:30-56`) lists only `draw`, `color`, `levels` and `transform` as invented entries — **not** the
pen family. So the "incomplete hiding" framing has no premise: nothing was hidden, and
`docs/PHOTOSHOP-UX.md` is the document that owns the answer if the family is ever implemented. **Do
not add a shortcut here without asking.** What remains is a record, not a defect.

**Files.** `src/components/Common/AppKeyboardShortcuts.tsx:33,109-137`,
`src/components/DesktopHeader/DesktopHeader.tsx:56-58`,
`src/components/SidebarLeft/toolbar-mapping.ts:135-147`,
`src/components/SidebarLeft/toolIcons.tsx:75-79`, `docs/TOOLS.md:1755,1787,1823`,
`docs/PHOTOSHOP-UX.md:30-56,110,191`

## 117. The operator's rail decision on `color`, `levels` and `transform`, and what an implementation still owes

**The requirement and the rail violation are `docs/PHOTOSHOP-UX.md`'s** (§"Adjustments are not
tools", `:39-56`), which now states them accurately and points here for the decision. This entry
does not restate them: the three are live tiles at `toolbar-mapping.ts:62-64`, `extraTools`
(`:164`) has no production reader, and `draw` is live at `:97` behind a real rasteriser at
`toolProcessors.ts:96-102`. What follows is the decision and what is left to settle, which is what
`docs/PHOTOSHOP-UX.md` defers to.

### The operator has decided: delete the three

**2026-10-01. The operator's decision, in their words: "I decide to remove them."** `color`,
`levels` and `transform` come **out of the rail**. Not relabelled, not moved to a menu, not
kept alongside — removed. This settles the question the Fix paragraph above left open, and it
resolves it the way `docs/PHOTOSHOP-UX.md:32-45` already required.

**This is not an override**, and `docs/OVERRIDES.md` must not gain an entry for it. That file's
own definition (`:11-18`) is a decision that this app deliberately does **not** replicate
Photoshop's behaviour. Removing three ids Adobe's Tools panel does not contain moves this app
**toward** Adobe, so the precedence ladder in `docs/DOCUMENTATION.md:11-23` already decides it
and the operator is ratifying the documented requirement rather than departing from it.

**What the implementation has to settle, which the decision does not:**

- **The destination already exists, under the wrong name.** There is no `Image` menu — the app's
  four menus are File, Tools, Edit, Window (`src/components/DesktopHeader/DesktopHeader.tsx:185`,
  `:283`, `:309`, `:390`) — **but `Edit` is already an `Image ▸ Adjustments` host**: it carries
  hard-coded items for `color`, `blur`, `levels`, `transform`, `draw` and `text`
  (`DesktopHeader.tsx:319`, `:329`, `:339`, `:349`, `:359`, `:369`, dispatching through
  `handleToolSelection` at `:121`-`:127`). So "extracting these three means building a real menu
  bar first" is **wrong** — the menu exists, the items exist, and they call the same
  `handleToolSelection` the rail calls. What is missing is that the menu is called `Edit` where
  Adobe says `Image ▸ Adjustments`, and that `blur`/`draw`/`text` are real Tools-panel tools
  sitting in a menu. **The rail removal and the menu relabelling are the same three-id change in
  two hand-written lists**, not a menu build. This correction supersedes the earlier claim in
  this entry that no menu exists to receive the three.
- **The `imageProcessor` for two of the three is DEAD CODE.** `color` and `levels` are
  `commit: 'layer-operation'`, and `useLayer.ts:576` returns before the `imageProcessor` call at
  `useLayer.ts:603`. The visible effect comes from a CSS string assigned to the canvas —
  `layer-renderer.ts:15-16` and `:17-18` build `buildColorsFilter` / `buildLevelsFilter` results,
  applied by `ctx.filter = getLayerFilter(layer.operations)` at `layer-renderer.ts:77` — and
  `functions.ts:60-62` is literally `grayscale(%) sepia(%) saturate(%)`. Their only callers are
  `image-processors.test.ts`. `transform` is split: its affine path is bypassed
  (`useLayer.ts:550-566`), its trapezoid path is live. **A restructure that moves these to a
  menu should move the CSS-filter path, not the OffscreenCanvas path** — the latter is what a
  reader would assume is the implementation, and it is not the one that paints.
- **`levels` is a misnamed Brightness/Contrast, confirmed in code.**
  `LevelsToolArgs = { brightness: number; contrast: number; toolName: 'levels' }`
  (`src/tools/levels.ts:4`), and `functions.ts:66-70` emits `brightness(...) contrast(...)`.
  Adobe's Levels is a three-point piecewise-linear remap with a channel selector and a histogram;
  this is two global sliders. **The app has no Levels.** Note the consequence: renaming the
  capability rather than moving it is a decision — the bar renders Brightness/Contrast controls
  under a "Levels" label, so a menu called `Image ▸ Adjustments` with an item labelled `Levels`
  would be a _new_ falsehood, and the honest item is `Brightness/Contrast`.
- **They are in a second surface already, and the IDs are load-bearing beyond the UI.**
  `src/components/DesktopHeader/DesktopHeader.tsx:27-32` holds a `TOOL_MENU_ITEMS` list including
  all three, under a header comment (`:20-21`) saying "a tool missing from the Tools menu is a
  visible inconsistency"; the same component hard-codes them as `Edit` items at `:319`-`:349`.
  The claim that extraction is "routing only, with the history and durable paths untouched" is
  **refuted**: `'color' | 'levels'` are a **durable schema type** at
  `src/contexts/history-model.ts:74` (`DurableFilter`) and `src/contexts/layer-types.ts:28`
  (`LayerOperationArgs`). 53 non-test lines across `src/`, 250 test lines, and **five e2e spec
  files** that select one of the three **through the rail flyout** — `adjustments.spec.ts`,
  `filter-tools.spec.ts`, `levels.spec.ts`, `sidebar-flyout.spec.ts` and
  `responsive-shell.spec.ts` — so all five break. Zero keyboard shortcuts are bound to any of the
  three, so that part is free.
- **`extraTools` is inert either way.** `toolbar-mapping.ts:164` exports it; its only reader is
  `src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts:97-99`, which checks it is
  disjoint from `shape`. Deleting the three makes the flag mean what its name says for the first
  time, or makes it dead code to remove.

### The premise was falsified: adjustments DO reach Photoshop's Tools panel

Research on 2026-10-01, after the decision above was recorded, established that the **justification
was wrong even though the decision survives**. `docs/OVERRIDES.md` was correctly _not_ used, but
the reasoning it was given does not hold:

- **The Adjustment Brush Tool is a real Tools-panel entry.** Beta in Photoshop 25.9 (Feb 2024),
  GA in **25.11 (July 2024)**, with its own toolbar slot in the Retouching & Painting Tools
  group — deliberately promoted out of the Brush flyout because nesting broke the `B` cycle. It
  has **no single-letter shortcut**; the widely-quoted `K` is the CS3-era Targeted Adjustment
  Tool, a different and removed tool. Adobe: it is "non-destructive, as they generate a new
  adjustment layer with a layer mask", created on mouse-release, painted area = mask.
- **The Selection Brush Tool is also real**, GA in the same 25.11, in the **Lasso group**, reached
  by cycling `L` then `Shift`+`L`. It only makes selections.
- **So "adjustments are not tools" is false as a general statement.** Adobe ships a tool whose
  output is an adjustment, not pixels. (Two other non-pixel tool outputs exist: Type, and the
  shape tools, which create shape/fill layers.)
- **The decision still stands**, because the narrow claim survives: `color` and `levels` here are
  **whole-image adjustments with no mask**, and the Adjustment Brush can only apply an adjustment
  where you paint. It cannot do what these two do. `transform` is untouched by any of this.
- **The recorded justification must not stand as written.** This is the concrete harm: the entry
  asserted a general claim that Adobe's own documentation contradicts, and a later session
  auditing rail compliance against it would find the Adjustment Brush and conclude the app is
  right and the doc is wrong — the exact inversion §117 exists to prevent.

**What this changes for a restructure — see the section after this one for the operator's later
signal, which supersedes two of these recommendations.** The honest target is not "move three things
to a menu". It is: rename the `Edit` host to `Image ▸ Adjustments`, relabel `levels` to
`Brightness/Contrast` because that is what it computes, keep `color`'s three CSS filters under a name
that says what they are (`grayscale`/`sepia`/`saturate` is neither Black & White nor plain
desaturation — there is no per-hue weighting anywhere), and treat **real Levels, real Curves and
adjustment layers as unbuilt work.** The app has no adjustment-layer machinery at all:
`psd-utils.ts:88-106` refuses `adjustment`, `mask` and `clipping` on import. What exists is a
retained per-layer operation stack (`layer.operations[]` → `apply-filter`), which retains but
cannot re-edit, and has no properties panel.

- **The tool sources survive; two of the three are dead on the edit path.**
  `src/tools/colors.ts`, `src/tools/levels.ts` and `src/tools/transform.ts` ship real processors,
  but for `color` and `levels` those processors are **dead code** — `commit: 'layer-operation'`
  returns at `useLayer.ts:576` before the `imageProcessor` call at `:603`, and what paints is
  `ctx.filter = getLayerFilter(layer.operations)` (`layer-renderer.ts:77`). `transform` is the
  geometry path and does run. `docs/TOOLS-TOO-HARD.md` records the extraction as a routing change
  with the history and durable paths untouched, so deleting the tool names is cheap — but the
  operations, not the processors, are what a surviving surface would have to own, and there is
  currently none.
- **What is NOT decided here.** `draw` is a separate id in the same section
  (`docs/PHOTOSHOP-UX.md:32-37`) with its own history — it is the suite's default way to make a
  mark, in every `e2e/*.spec.ts` that strokes (`grep -rc "clickToolButton([^)]*'draw'" e2e
--include="*.spec.ts"` re-derives it), and `e2e/pen-types.spec.ts` exists specifically to test
  it and dies with the tool. The operator's decision covers the three adjustment ids only, and
  `docs/PHOTOSHOP-UX.md` sequences `draw` last. `HANDOFF.md` §74 remains the open entry for it.

### The capability is coming back as real Photoshop commands, and the requirements are not written down

**2026-10-01, after the decision above: the operator signalled that Levels, Colors and the other
`Image ▸ Adjustments` commands "will be implemented".** This does not reopen the rail decision — the
three ids still leave the rail, because Adobe's Tools panel has no such entries and that was decided
for a reason that has not changed. What it changes is the paragraph above.

**Read those two claims as superseded, and this is why they are not silently rewritten:**

- _"relabel `levels` to `Brightness/Contrast` because that is what it computes"_ was advice about
  what to do with the existing two-slider stand-in when it moves. If real Levels is built, that
  question dissolves: the menu item is `Levels` and it computes Levels. **Do not relabel and do not
  build the stand-in into the menu** — a relabelled stand-in is the falsehood, made more permanent
  by being menu-launched.
- _"treat real Levels, real Curves and adjustment layers as unbuilt work"_ was a routing judgement
  about where those gaps belong. They now have a destination, and `docs/TOOLS-TOO-HARD.md` records
  that signal: its "nobody re-audits it, nobody estimates it" policy is **suspended for the
  `Image ▸ Adjustments` family**. That file's Black-and-White entry is the one to delete first when
  the work starts — its "why it is too hard" describes the CSS-filter mechanism being replaced, not
  a constraint on the replacement.

**What is NOT settled by this signal, and an agent must not assume any of it:**

- **No requirements document exists.** Nothing here says what the Levels dialog contains, whether it
  is a menu command or a panel, whether it produces a baked raster or an adjustment layer, or how it
  round-trips. `docs/DOCUMENTATION.md`'s ladder means Adobe's pages are the requirement and this
  sentence is not — but building "Levels" without the Adobe spec produces exactly the
  stand-in-under-a-Adobe-name that the operator's own signal is trying to end.
- **The adjustment-layer question is untouched and is the load-bearing one.** `psd-utils.ts:88-106`
  refuses `adjustment`, `mask` and `clipping` on import, and `layer.operations[]` retains without
  re-editing. Whether `Image ▸ Adjustments` bakes pixels or creates adjustment layers changes the
  durable schema, not just the UI, so it is an architecture decision the operator has not made.
- **`transform` is not in this family.** `Image ▸ Transform` in Adobe is Free Transform; this app's
  `transform` is the trapezoid/affine geometry path. Whether it is restyled, relabelled or left
  alone is a separate question this signal does not answer.

**So the work is real and unblocked; the spec is missing.** The next session to touch this should
ask for the requirements rather than derive them, and should not start from
`src/tools/levels.ts`, whose `{ brightness, contrast }` is the thing being replaced.

**This entry is a decision record, not a changelog.** It stays until the three are gone from
`toolbar-mapping.ts`, at which point the fix **deletes** it rather than rewording it
(`docs/DOCUMENTATION.md:145-158`). Nothing in the codebase is changed on the strength of this
entry alone.

## 118. `brush`, `pencil` and `draw` are one rasteriser behind three tool names, and the rule that keeps them apart is not on `main`

`src/tools/toolProcessors.ts` registers all three against the same rasteriser:

```
 96: const buildDrawArgs = (args, penType: 'pen' | 'spray', lineWidth?) => …
259-262: brush   → draw({…})(buildDrawArgs(args, 'pen'))
267-275: pencil  → draw({…})(buildDrawArgs(args, 'pen', lineWidth))
```

So `brush ≡ pencil ≡ draw` at the pixel level. They differ by nothing a user can see except the
preset list (`src/tools/brush.ts:143-154`) and the tool name carried into history.
`src/components/ToolbarsRight/Brush/Brush.tsx:3` and `Pencil/Pencil.tsx:3` are both three-line
`createPaintToolbar('brush' | 'pencil')` calls over one shared bar.

**The constraint that makes this correct rather than a duplication bug exists only on an
unmerged branch.** `fix/stale-reclaim-skill`'s `AGENTS.md` carries it:

> "`PaintToolName` is `'brush' | 'pencil'` and that narrowing is load-bearing: a tool that
> SUBSTITUTES pixels cannot share a processor, args type or options bar with one that STAMPS
> them — sharing is what let a forced `'spray'` `penType` masquerade as a tool setting, and a
> tool that left the paint panel must not be widened back for a new bar. Corollary: a group that
> persists one key may not absorb a tool that has more than one."

The corollary's original pointer (`HANDOFF.md` §70, "a tool whose settings do not fit a shared arm")
is gone — that defect was fixed, and the rule it recorded is the sentence above. `grep -c
PaintToolName AGENTS.md` on `main` returns **0**. `git grep -ln PaintToolName -- '*.md'`
returns exactly one file, `.skills/photoshop-tool-creation.md`. The type exists and is enforced in
code (`src/tools/draw.ts`, asserted at `src/tools/__tests__/paint-tools.test.ts:22`) — but the
sentence that explains _why_ `'brush' | 'pencil'` is a narrowing and not an accident is on a
branch that has not landed, and **it is now the only copy**: the entry that used to hold it is
deleted, correctly, because its own defect was fixed.

**Why it matters for the dead-tool question this surfaced.** Three tools sharing one rasteriser
is exactly the shape that reads as dead-code duplication, and the correct deletion — merging
`brush` and `pencil` into `draw`, or deleting `draw` as `docs/PHOTOSHOP-UX.md:32-37` orders — would
be a real regression for anyone who has not read the rule. The rule is what stops it. That is
also the general lesson: **a rule can outlive the entry that recorded it, and deleting the entry
does not delete the rule** — so a rule with no home is a defect in itself.

**Fix.** Move the `PaintToolName` paragraph out of the branch's `AGENTS.md` and into `main`'s
**Architecture status** section, next to the history-authority paragraph it constrains. It is a
boundary rule of the same kind, and it is currently only readable by whoever opens a branch that
was never merged.

**Files.** `src/tools/toolProcessors.ts:96`, `:259-262`, `:267-275`,
`src/tools/brush.ts:143-154`, `AGENTS.md` §Architecture status, `docs/PHOTOSHOP-UX.md:32-37`

## 119. The Draw tile and the Brush tile both advertise `B`, and no keypress selects the Draw tool

**Problem.** Two tiles print the same key. `toolbar-mapping.ts:73` declares the Brush with
`shortcut: 'B'` and `toolbar-mapping.ts:97` declares the Draw tile with `shortcut: 'B'`, so the rail
renders `B` on both.

The key answers to the Brush. `AppKeyboardShortcuts.tsx:348-360` registers `b` and `shift+b` against
`selectBrushTool` and registers nothing for `draw`, so the Draw tool cannot be reached by the key its
own tile prints. That is worse than a tile printing no key: the reader has been told a shortcut
exists, and pressing it goes somewhere else.

**Nothing asserts this, which is why it survived.** `toolbar-mapping.test.ts` checks shortcut shape
inside the figure flyout only — `:82` ("only declares U as the shape shortcut") and `:107`. No test
compares shortcuts across the rail, so a second declaration of a live key is invisible to the suite
however it arrives.

**Not decided here: which tile keeps `B`.** That is a question about what Photoshop does, and
`docs/DOCUMENTATION.md`'s ladder makes Adobe's documentation the authority — this entry does not
answer it and no change may be made on this paragraph alone. What is decided is the invariant: a
tile may only print a key the handler answers, and no two tiles may print the same one. Whichever
way the first question resolves, both halves of that have to hold afterwards.

**Fix.** Resolve the Adobe question, then make the surviving declaration match the handler rather
than the other way round, and add a rail-wide uniqueness assertion over `toolbarMap` so the second
declaration of a key cannot land again. The assertion is the part that outlives the decision: it
fails on any duplicate, whichever tile the duplicate is on.

**Files.** `toolbar-mapping.ts:73`, `:97`, `src/components/Common/AppKeyboardShortcuts.tsx:348-360`,
`src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts`

## 120. The Move tool has nine documented missing controls and no entry tracking them as work

`docs/TOOLS.md:2006-2028` gives `reposition` a written `partial` verdict and enumerates what is
absent: Tool Preset Picker, Auto-Select, Auto-Select: Group, Auto-Select: Layer, Show Transform
Controls, Align, Distribute, Align to, Width, Height — plus Alt-drag, Shift-constrain,
Shift-extend and arrow-key nudge. It records Auto-Select as welded on with no control to turn it
off.

`grep -n reposition HANDOFF.md e2e/OPEN_PROBLEMS.md` returns only `:347`, `:1755` and `:2539`,
and each is about a different subject. **Nothing tracks the nine as work.**

The tool itself is not parked, which is the reason this is a handoff entry and not a deletion
candidate. Its _processor_ file was last touched 2026-09-25 by `2e1b6e46` — a config-and-test
commit whose real content was removing a dead `resize` rasteriser branch — but its live surface,
`src/components/Main/MoveToolArea.tsx` and the Move panel, was changed on **2026-09-28** by
`a30c318a` and `f6f54752`, i.e. _newer_ than `transform`'s 2026-09-27. It is the tool that owns
`Merge all` (`src/components/ToolbarsRight/Reposition/Reposition.tsx:21`), which nothing else has.

The scope decision is written down; the work is not. A documented `partial` verdict with no
tracked work is how a half-built tool becomes permanently half-built.

**Fix.** Add one `HANDOFF.md` entry carrying the nine controls and the four modifiers as named
work, referencing the existing verdict rather than restating it.

**Files.** `docs/TOOLS.md:2006-2028`, `src/components/ToolbarsRight/Reposition/Reposition.tsx:21`,
`src/components/Main/MoveToolArea.tsx`

## 121. The worktree sweep is structurally blind to every branch that has no worktree, and one of those branches is the upstream reference implementation

**Problem.** `scripts/worktree-inventory.mjs` derives its entire model from
`git worktree list`; the only place any branch name is read is
`scripts/lib/worktree-inventory/git.mjs:69`, which parses a `branch refs/heads/…` line out of that
listing. A branch with no worktree is therefore not `land`, not `at-risk`, not `dispose` and not
`goneWorktrees` — it does not appear in `WORKTREES.json` at all, so no reclaim or harvest run can
ever reach it. There are **42** such branches in `refs/heads` today, and the one that matters is
worse than merely unlisted.

**`layers` is not this project's work.** `origin` is
`https://github.com/drguz69/lightshopy.com.git`, and `main` is a rewrite of it that has diverged
815 commits. `layers` is an upstream branch of the reference implementation, and it still carries
**25 patches that are not on `main`**:

```
git merge-base main layers     # 894ee443b  "layers + history", 2026-03-20
git cherry main layers         # 25 lines starting with '+'
git merge-base --is-ancestor layers main   # NO
```

Its log is the author's original implementation of the areas this repository has since rewritten
twice — `drag and drop done right`, `try to add back history [WIP]`, `fix Shape tool area
calculation for square`, `correct circle selection`, `history eye`. `git cherry` therefore reports
it as unlanded work, and a sweep that trusted that field the way `.skills/worktree-merge-harvest.md`
step 1 tells a reader to — re-verify, then land — would merge the upstream implementation into the
rewrite. Its value is as a **reference to read**, not as a branch to land, and nothing in the
repository says so.

**Reproduce.**

```bash
git worktree list --porcelain | grep 'branch refs/heads/layers'   # no output: no worktree
git cherry main layers | grep -c '^+'                            # 25
git remote get-url origin                                       # .../drguz69/lightshopy.com.git
```

**Fix.** Two separate problems, and the second is the cheaper one.

1. Record that `layers` is the upstream reference and is not a merge candidate, so the next sweep
   reads it before `git cherry` misleads it. **There is no longer a branch-state section in this
   file to put it in** — the one this entry used to name opened with a 136-line block of branch
   bookkeeping whose own pointers had rotted, and deleting it is correct. The durable home for a
   statement about the repository's remotes is `docs/ORCHESTRATION.md`, which already carries the
   upstream-rewrite rule this entry restates (`a branch rewrote the whole history of the app … is
a remote-tracking ref, not a local branch`).
2. Teach the inventory to enumerate branch-only refs. `git for-each-ref refs/heads` alongside
   `git worktree list` is the whole change; a branch with no worktree should surface as an explicit
   category rather than as silence. The 39 fully-merged branch-only refs
   (`git merge-base --is-ancestor <b> main` → yes) are pure clutter today that no sweep will ever
   collect, and the remaining three — `layers`, `ps-integration` (0 unlanded patches, not an
   ancestor: merge commits only) and `fix-merge` (already on `main`) — are the ones a reader needs
   warned about.

**Files.** `scripts/lib/worktree-inventory/git.mjs:69`, `scripts/worktree-inventory.mjs`,
`docs/ORCHESTRATION.md` (the upstream-rewrite rule)

## 122. No pixel tool honours an active selection — the eraser, the magic eraser, the paint bucket and the clone stamp all ignore it

**Problem.** A selection is a coverage limit on every raster operation. In this app it is a limit on
none of them. Measured against current `main`:

```
git show main:src/tools/eraser.ts     | grep -ci selection   # 0
git show main:src/tools/cloneStamp.ts | grep -ci selection   # 0
git show main:src/tools/fill.ts       | grep -ci selection   # 0
git grep -niE "multiplyBySelection|applySelectionMask|selectionAlpha|constrainToSelection" main -- 'src/**'   # 0
```

There is no shared seam to hang a fix on, and `src/contexts/useLayer.ts`'s commit path never reads
selection state at all. So selecting a region and painting outside it paints outside it.

**Reproduce.** Make a selection, switch to the Eraser or the Paint Bucket, and stroke well outside
the selection's bounds. The stroke is not clipped.

**Fix.** Multiply the selection's alpha into the region write, per processor, because each computes
coverage differently: the eraser has a stroke mask, the flood fills a fill mask, the clone stamp a
displaced fetch. There is no shared region-write primitive to hang a common helper on, so this is a
per-processor change and needs its own tests — a "clip the whole result afterwards" approach
re-reads and re-writes the bounding box on every stroke and is what makes this expensive.

**Where this came from.** The abandoned branch `ps-pixel-tools` (worktree `ps-pixel-tools`, 12k lines,
now harvested) filed it as handoff items 34/35 of a different numbering. Its code is superseded by a
different architecture, so this is a rebuild, not a merge. Two of that branch's items are dead: the
`eraseToHistory` plumbing it described no longer exists on main at all, and its blast-radius note is
addressed (`useLayer.ts` now wraps the processor in a `try`/`catch` that logs and returns).

**Files.** `src/tools/eraser.ts`, `src/tools/cloneStamp.ts`, `src/tools/fill.ts`,
`src/contexts/useLayer.ts` (the commit path)

## 123. Every pointer move of a stroke re-rasterizes the stroke's whole bounding box

**Problem.** `tempUpdateLayer` is the sanctioned live-pixel writer for a stroke in progress, and the
pointer-move path reads the bitmap from the hook closure rather than from the canvas the previous
move wrote:

```
src/contexts/useLayer.ts:584   previewLayersRef.current[id] = { layer: previewLayer, toolArgs };
src/contexts/useLayer.ts:585   drawAllLayers();
src/contexts/useLayer.ts:589   const bitmap = layer.tmpCanvas ?? layer.bitmap;
```

`previewLayersRef.current[id]` is written and never read back as the next invocation's input, so each
move redoes the work for the entire region the stroke has touched so far. A short stroke is cheap; a
long drag over a large canvas is quadratic in the distance travelled, and it gets worse the longer
the stroke runs.

**Reproduce.** Drag one continuous stroke across a large canvas and profile `tempUpdateLayer`. Cost
per event grows with the bounding box covered SO FAR, not with the delta.

**Fix.** Either accumulate across the stroke, or document the cost as a known limit. A persistent
canvas handle in the processor contract would work, but it must NOT go in `args`: the durable
conversion whitelists the tool-arg shape, and a canvas in `args` would either void the document or
require a migration. Put it outside `args`.

**Files.** `src/contexts/useLayer.ts:583-612`

## 124. An ordinary tool commit can move the document's size, and a mid-document bedrock blank layer is the production trigger

**Problem.** A tool commit is supposed to change pixels, not the document. A reproduction harness
exists that measures `totalSize`, `documentFrame` and the canvas backing store across commits, and it
has never been run to a verdict. Four production entry points, all of them live code:

1. ten Rectangle commits, then ten undos and ten redos — the canvas backing store and the footer's
   `totalSize` text must never move
2. crop, then five more commits, then three undos and three redos — the pre-crop cursor must stay at
   the pre-crop size and every later cursor at the cropped one
3. a 64×64 document opened from a fixture, then five commits and five undo/redo rounds (the import is
   async, so it must be polled, and the opened size must be passed in rather than the seeded default)
4. the **mobile shell** — `MobileLayersDrawer.tsx:172` calls
   `createBlankLayer({ …, size: totalSize, isBedrock: true })` with NO `replaceDocument`

**Entry point 4 has been closed since this entry was written, and it was the one with a live
consequence.** `MobileLayersDrawer.tsx` no longer calls `createBlankLayer` at all; the shell's blank
layer now goes through `applyRasterReplacement` (`MobileLayersDrawer.tsx:205-216`), which
`useApp.ts:140-154` routes through `setBlankImage` and therefore **replaces the document**. The
history shape a replay bedrock branch reacts to is gone from that path, so scenario D's premise no
longer describes production. Keep the scenario — it still measures `totalSize` across commits, and
the harness is the only thing that does — but its mobile half no longer reproduces the
document-moves trigger, and a fix for the mobile shell is not what this entry now needs.

The other three entry points are unmeasured. **`applyRasterReplacement` is now a second place that
decides document replacement by convention** (the first is the `REPLACE_DOCUMENT` fast path in
§103), and neither it nor the mobile caller carries a comment saying the omission is deliberate —
which is exactly the shape §142 describes for the main worktree.

**Reproduce.** The harness is committed on `salvage/probe-canvas-growth` (it was untracked in a
detached-HEAD worktree, so it was on no ref at all and nothing in git could have recovered it):

```bash
git worktree add .kilo/worktrees/probe-checkout salvage/probe-canvas-growth
cd .kilo/worktrees/probe-checkout
npx vitest run src/contexts/__tests__/probe-canvas-growth.test.tsx   # the per-cursor sweep
npm run test:e2e -- e2e/zzz-probe-canvas-growth.spec.ts              # the four entry points
```

**Not verified.** Whether the defect still reproduces at current `main` is UNKNOWN — the probes have
never been run to a verdict, and 31+ commits have landed since they were written. Run them before
acting on anything here. Scenarios D and E in the jsdom probe are deliberately assertion-light and
only log a summary: they are diagnostic, not verdicts.

**Careful with the landing shape.** `probe-canvas-growth.test.tsx` is named `*.test.tsx` and is
therefore collected by `npm run test`, so it must not be merged as-is without deciding where the
probes live — an `expected-fail` pin or a prose reproduction in this file. A probe that FAILS is a
tripwire, and per the repo's own rule it is removed in the same change that fixes the defect; a probe
that PASSES means the defect is gone and the file should be deleted, not kept as a passing test.

**Files.** `src/components/Mobile/MobileLayersDrawer.tsx:172,205-216`,
`src/contexts/useApp.ts:140-154`, `src/contexts/history-replay.ts`,
the harness on `salvage/probe-canvas-growth`

## 126. The five figure tools never see the foreground colour, because of one guard in the swatch

**Problem.** `rectangle`, `ellipse`/`oval`, `triangle`, `polygon` and `line` all take their colour from
a hardcoded literal rather than the foreground swatch:

- `src/components/ToolbarsRight/Figures/Shape.tsx:32` mirrors the swatch behind an
  `args.toolName !== 'shape'` guard, and one options-bar component serves all six of `toolsMap.ts`
- `src/tools/settings.ts:278-306` gives each of those five a hardcoded `color: '#000000'`
- `src/components/Main/ShapeToolArea.tsx` contains **zero** occurrences of `color` — it reads
  `args.color` and nothing sets it

So moving the foreground swatch does nothing for five of the six figure tools.

**Fix.** In `ShapeToolArea.tsx`, read `color` and `backgroundColor` off the store AT GESTURE TIME —
the same shape `FillToolArea.tsx` already ships — and inject them into the committed args and the
live preview. Do **not** route through `setToolArgs`: `saveLastSettings` persists those five names as
a bare `{ toolName }`, so a tool-args write would leave `args.points` and `lineWidth` undefined after a
tool switch. The alternative — deleting the `args.toolName !== 'shape'` guard at `Figures/Shape.tsx:32`
— writes through the args context, so that persistence hazard has to be closed first.

Baked-in args rather than replay-time reads are what keep undo/redo re-rasterising in the painted
colour with no migration, because the durable `legacy-tool` conversion already serialises the whole
args object. Add BOTH colours: `hasFill` and the fill swatch are store-owned for the same reason, and
a half-fixed shape tool strokes in the swatch while still filling in the default.

**Where this came from.** The abandoned branch `fix/paint-overlay`. Its other two commits are dead:
`139cc432` (clear the tool overlay on unmount) is on `main` verbatim at `useRect.ts:129-135`, and
`37132d95`'s primary claim about `brush`/`pencil`/`color-replacement` being wired to a placeholder is
false on main, which built a real options panel at `src/components/ToolbarsRight/Paint/Paint.tsx:63-66`.
Only this rider survives.

**Files.** `src/components/ToolbarsRight/Figures/Shape.tsx:32`, `src/tools/settings.ts:278-306`,
`src/components/Main/ShapeToolArea.tsx`

## 128. `scripts/lib/agent-board/db.mjs` carries two raw NUL bytes, at 90 KB in

**Problem.** `scripts/lib/agent-board/db.mjs` is 90,036 bytes and contains **two raw NUL bytes**, at
**line 1117** (byte offsets 44860 and 44978), inside the `Map` key of `locksFor`:

```js
const live = new Map(this.liveLocks(at).map((lock) => [`${lock.path}<NUL>${lock.agent_id}`, lock]));
```

That file is the coordination database every worktree shares, so the blast radius is every tool that
sniffs for NUL before treating a file as text.

**Reproduce.**

```bash
perl -0777 -ne '$c = () = /\x00/g; print "$c\n"' scripts/lib/agent-board/db.mjs   # 2
perl -0777 -ne 'while (/\x00/g) { printf "%d\n", pos() - 1 }' scripts/lib/agent-board/db.mjs
LC_ALL=C tr -dc '\000' < scripts/lib/agent-board/db.mjs | wc -c                  # 2
```

**A detection trap worth knowing.** `grep -aob $'\000'` **cannot** find these: zsh truncates NUL in
`argv`, so the pattern arrives empty and the command reports nothing found on a file that has two.
That is a false negative produced by the tool, not by the file. Use the `perl` count above, or the
`tr` one, both via a pipeline rather than an argument.

**Fix.** Replace the literal NUL separator with a printable one that cannot occur in a path or an
agent id, and note the choice in a comment — the obvious fix is to write `'\0'` in the source, which
keeps the byte out of the file while a reader still sees an escape. The working replacement is
already implemented on branch `fix/swarm-lock-identity` (commit `8c4316cf`), which folds the pair into
a single `holdingKey` helper for exactly this reason.

**One scoping correction to the earlier version of this heading.** It claimed the file "reads as
binary", and that is true of `file(1)` (which reads all 90 KB) but **not** of git: git's binary
sniff inspects only the first 8,000 bytes, and both NULs sit far past that. So `git diff` and both
`git grep` and `git grep -I` still find `liveLocks` in the file. The defect is real and the fix
stands; what is overstated is the set of tools it breaks, and anyone who checks with `git grep -I`
will conclude the file is clean and think the entry wrong.

**Files.** `scripts/lib/agent-board/db.mjs:1117`

## 129. The worktree-inventory suite's per-test timeout scales with the number of worktrees, so it fails under load and is indistinguishable from a real break

**Problem.** `scripts/__tests__/worktree-inventory.test.mjs > the curated table > never asks the table
to protect a worktree whose protection is derived` runs the inventory generator over every worktree,
and the generator runs git per worktree, so the test's cost grows with the fleet. Measured on `main`
with 56 worktrees:

```
full suite under concurrent load : 76957ms  -> Error: Test timed out in 60000ms
the same test alone, unloaded     : 53180ms  -> passes (1 passed, 149 skipped)
```

So it sits at ~53s against a 60s wall clock. It is a knife edge, and the failure it produces is a
bare `Test timed out` with no assertion — the same output a genuine break produces.

**Why this is worth an entry rather than a re-run.** A sweep that leaves more worktrees than it
started with makes this test cross the line, and CI cannot tell the difference. A green local run at
99 worktrees and a red CI run at 56 would be the same defect with a different cause.

**Fix.** Make the enumeration cheaper, not slower-tolerant. The test wants to know whether a
worktree whose protection is _derived_ is ever asked to be protected by the curated table, which is
answerable from a handful of synthetic worktrees in a temporary repository — the same technique the
fixture-based tests in this suite already use. Do **not** raise the timeout: that is a gate change,
and it moves the knife edge rather than removing it.

**The second worktree-count sensitivity this entry used to name has been removed from the tree, and
the removal is documented in place.** The old sibling `it('gives every non-primary worktree a curated
entry, so none is undocumented')` — the one that asserted on the size of the operator's fleet — no
longer exists. What replaced it is a 28-line comment at
`scripts/__tests__/worktree-inventory.test.mjs:1863-1891` headed "WHY THERE IS NO 'EVERY WORKTREE HAS
AN ENTRY' RULE HERE", which records that the rule was the recurring red, why no agent can make a
committed table agree with a moving fleet, and that the risk is now asserted where the risk is
derived. The knife edge above therefore no longer has a second test on the same axis; the entry keeps
only what is still live. `git log --oneline -S'gives every non-primary worktree' -- scripts/__tests__/worktree-inventory.test.mjs`
names the commit that did it.

**This is a `TEST-FLAKES.md` finding by the routing table, not a defect record.** `docs/DOCUMENTATION.md`
routes an intermittent test there, and `TEST-FLAKES.md` §14 already covers this family ("The lock and
queue suites ran inside a budget smaller than their own work"), including the `60_000` declaration
this test carries. What `TEST-FLAKES.md` does **not** record is the part unique to this entry: the
cost scales with the **operator's** fleet rather than with the repository's content, so the knife
edge moves when a sweep grows the fleet and not when a commit does. That is the sentence to add
there — it belongs in this file only as its routed home while it is being written, and this entry
should go when the addition lands.

**Files.** `scripts/__tests__/worktree-inventory.test.mjs:1863-1891,1983-2014`, `TEST-FLAKES.md` §14

## 132. The shape's three document-frame conversions are correct, and no test pins that

**This entry is a guard against a future "simplification", plus a missing tripwire.** An earlier
reading of this code claimed the frame offset is applied twice to a shape and lands it 2x from
where it was dragged. **That reading was wrong.** The arithmetic is worth writing down so nobody
derives it again. Three conversions, in order:

| where                                                                                    | conversion        | sign   |
| ---------------------------------------------------------------------------------------- | ----------------- | ------ |
| `ShapeToolArea.tsx:177-178`, `canvasToDocumentPoint(..., documentFrame)`                 | canvas → document | **+1** |
| `useLayer.ts:306`, `createLayerFromTool`, `pos: canvasToDocumentPos(pos, documentFrame)` | canvas → document | **+1** |
| `layer-renderer.ts:78-79`, `position.x - (documentFrame?.x ?? 0)`                        | document → canvas | **−1** |

`document-frame.ts:44-47` — `canvasToDocumentPos` adds. `:40-41` — `documentToCanvasPos`
subtracts. The renderer's inline subtraction is that same conversion. **Net +1**, which is
correct: a shape in a cropped document belongs one frame down and right of the origin.

The two "+1"s are not redundant. The first converts the _gesture_ from canvas to document space.
The second is `createLayerFromTool`'s unconditional conversion, which exists because a caller may
supply a `pos` already in layer space and a caller may not. `useLayer.ts:286` skips only the
_derivation_ when `pos` is supplied; the conversion at `:306` is not conditional, and that is
deliberate rather than an oversight.

**Do not "fix" this by dropping either conversion.**

**The tripwire this names is not on `main`, and two documents claim it is.** An earlier revision of
this entry said a test already pinned the cancellation, and `docs/ARCHITECTURE.md:332` repeats that
claim. Both are false: `grep -rn "cancels the commit's" src/ e2e/` returns nothing, and the four
`ShapeToolArea.test.tsx` cases naming a `documentFrame` are about the `currentFrame === null`
fallback (`:1064`), not about the offset cancelling. The nearest analogue lives on the unlanded
branch `fix/shape-truth`, and it is about the Draw tool
(`DrawToolArea.test.tsx:450`). **Two corrections, in one change:** add the test, and strike the
sentence from `docs/ARCHITECTURE.md` that says one exists.

The test to add: a shape committed into a non-zero `documentFrame`, asserting the committed bounds
equal the preview bounds plus the frame — the same relation `ShapeToolArea.test.tsx:766-775` already
checks between preview and commit, extended to the renderer's subtraction.

**Files.** `src/components/Main/ShapeToolArea.tsx:177-200`, `src/contexts/useLayer.ts:278-309`,
`src/contexts/layer-renderer.ts:78-79`, `src/contexts/document-frame.ts:40-47`,
`docs/ARCHITECTURE.md:332`

## 133. The e2e stroke analysis cannot see a spray pixel, so a darker Airbrush silently fails its own wait

**Problem.** `getStrokeAnalysis` counts only pixels that are **dark** (`STROKE_ANALYSIS.DARK_THRESHOLD`)
**or** a **spray** pixel — and the spray arm is `luminance > SPRAY_LUMINANCE_THRESHOLD` (200),
`saturation < 30`, and not near-white. Every pixel in between is invisible to it. The spray renderer
is now denser than it was (it was fixed to give a real dab rather than a grey blur), so a mid-tone
spray falls into exactly that blind band, and `waitForSprayPixels` then fails on a **timeout** with a
message about a null analysis rather than about missing ink.

**Reproduce.** Spray at a mid luminance and call `getStrokeAnalysis`. The pixel count does not include
it, so the wait times out. The measurement on the branch: the landed renderer drops the analysis from
26,040 counted pixels to 8,144.

**Why it matters beyond this suite:** the threshold is not a test detail, it is the definition of
"there is ink here". Anything that reasons about spray coverage inherits it, and the unit suite
hard-codes the same threshold at `e2e/helpers/__tests__/canvas-stroke-analysis.unit.test.ts:48`, so
changing the rule has to change that too — it is a gate on the gate.

**Fix.** Either widen the classifier to a real "is this an ink pixel for the tool that drew it"
predicate, or make it tool-parameterised so a spray's expected luminance comes from the tool's own
`settings` rather than a constant. Then fix the failure MESSAGE: a timeout caused by an empty analysis
must say so, because "timed out waiting for pixels" sends the next reader to widen a timeout instead
of looking at the classifier.

**Platform contract.** Photoshop's Airbrush is a density-building tool: it deposits colour while the
pointer is held, and Flow controls how fast
(https://helpx.adobe.com/photoshop/using/airbrush-tool-options.html). A single visible tap depositing
one dab is the correct order of operations — the pre-fix `alpha / 4` peak of 0.125 made the tool dark
on a drag and invisible on a tap. The flow accumulation itself is not reachable in this renderer; that
is a separate known limit, and it belongs in this file rather than in a comment on the renderer.

**Where this came from.** The abandoned branch `fix/spray` (`60590a25`, anchored at
`refs/keep/harvested/fix-spray`). The _code_ half of that branch is already on main as `1a26dfe5` —
same subject, rebuilt on a different base, which is why `git cherry` reported it unabsorbed. Only the
defect record was missing, and it is recorded nowhere on main
(`git show main:e2e/OPEN_PROBLEMS.md | grep -i spray` → empty).

**Files.** `e2e/helpers/canvas-helpers.ts:242`, `e2e/helpers/__tests__/canvas-stroke-analysis.unit.test.ts:48`

## 134. Three tool descriptions promise a scrubby slider that does not exist

**Problem.** `main:src/tools/descriptions/paint.ts` promises the same thing three times — at `:37`
(Opacity, Brush), `:44` (Flow) and `:170` (Opacity, Pencil):

> "A label with a numeric field, **scrubbable by dragging the label**, 0 to 100 percent."

There is no such behaviour. `git cat-file -e main:src/components/ToolbarHorizontal/ScrubbableField.tsx`
fails, and a `git grep -il scrub main -- src/**` returns only the descriptions themselves plus
unrelated hits (`AppKeyboardShortcuts`, `SharpenToolArea`, `useKeyboardEvents` — none a scrub
handler). Nothing reads a drag on a label.

**Why this class of gap matters more than a missing feature.** These description files are read by
agents as ground truth about how the app works, and the repository already treats a description that
outruns the product as a defect rather than a wish — see the other entries about false claims. An
agent that trusts this sentence will write a test asserting a drag works, or will explain a user's
"the slider doesn't scrub" report as the user being wrong.

**The contract to implement, and it is small.** Adobe documents scrubby sliders in _Enter values in
panels, dialog boxes, and the options bar_ (https://helpx.adobe.com/photoshop/using/panels-menus.html):
the control is **hidden until the pointer is over the title**, the cursor becomes a **Hand**, and
**holding Shift while dragging accelerates the scrub by a factor of 10**. A worked implementation
exists on the abandoned `wip/ps-ux-chrome` branch (180-line `ScrubbableField.tsx` plus a
`fieldPrecision.ts` carrying `SCRUB_SPEED_MULTIPLIER = 10`).

That branch implements **only half** the contract, and the missing half is worth naming before anyone
rebuilds from it: Adobe documents no Option/Alt modifier, but third-party documentation of the same
control records _"Hold down the Option (PC: Alt) key as you drag and the sliders change at 1/10
speed"_. So the Shift-10× rule is documented by Adobe and the Option-0.1× rule is documented
elsewhere; do not treat the first as the whole contract without deciding about the second.

**Do not land that branch as a whole.** It targets a **schema-driven single options bar**
(`optionsBarSchema.ts`, 352 lines, plus `OptionsBar.tsx`) while `main` renders per-tool
`ToolbarsRight/*` panels, and its `src/index.scss` is 817 lines against main's 164. It is a different
architecture, so the `ScrubbableField` component and `fieldPrecision` are worth taking and the
options-bar rewrite is not. Its `railPanelIcons.tsx` and ten icon edits are unexplained in any of its
commit messages — read them before assuming they belong to this work.

**Files.** `src/tools/descriptions/paint.ts:37,44,170`,
`src/components/ToolbarHorizontal/` (no `ScrubbableField` on main)

## 135. Symlinking a worktree's `node_modules` to the root's makes `tsc` resolve through the ROOT checkout

**Problem.** The standard shortcut for a worktree with no `node_modules` is
`ln -s /Users/bkalynovskyi/ph/node_modules .kilo/worktrees/<name>/node_modules`. It appears to work —
`tsc` and `vitest` both run. It is also how you get a gate that silently tests the wrong tree.

`node_modules/.bin/tsc` is itself a **relative** symlink:

```
$ readlink node_modules/.bin/tsc
../../scripts/tsc-guard.mjs
```

So the resolution is `<root>/node_modules/.bin/../../scripts/tsc-guard.mjs` — and `realpathSync` on it
lands in the **root checkout's** `scripts/`, not the worktree's. The tsc guard then guards main.

**Observed.** A landing in this worktree failed 3 cases in
`scripts/__tests__/tsc-guard.test.mjs:392,424` for no reason connected to its change. The cause was
this symlink, not the work. The fix is a real `npm ci` in the worktree — and the order matters:
`rm` the symlink **first**, because a real directory at that path makes `npm ci` delete the contents
of the directory it is pointed at, which is main's `node_modules`.

**Fix / convention.** Either run `npm ci` in the worktree, or accept the symlink and know that
`tsc-guard`'s three cases are measuring main. If you use the symlink, verify before blaming a change:

```
ls -l node_modules/.bin/tsc | awk '{print $NF}'     # a relative path means it escapes
```

`AGENTS.md` already warns that a worktree's missing `node_modules` "is exactly what makes it
misleading", because `tsc` and `vitest` mostly work by walking up to the parent. This is the sharper
form of the same trap: they not only work, they work on the wrong files.

**Files.** `node_modules/.bin/tsc`, `scripts/tsc-guard.mjs`, `scripts/__tests__/tsc-guard.test.mjs`
---

## 138. Two tool options bars justify their clamping with a `localStorage` round trip that no code performs

`src/components/ToolbarsRight/Sharpen/Sharpen.tsx:111-112` and
`src/components/ToolbarsRight/Smudge/Smudge.tsx:114` both carry the same comment:

> A persisted args object can hold a value outside Photoshop's range — settings are round-tripped
> through `localStorage` and restored before anything clamps them — and a controlled `<input
type="range">` whose `value` is out of its own `min`/`max` pins the thumb to the bound while
> reporting the raw value, so the readout and the thumb disagree.

The reasoning is sound and the clamping is correct. **The premise is false.** `saveLastSettings`
(`src/contexts/useCurrentTool.tsx:62`) writes to `src/tools/settings.ts:343`, a module-level
singleton, seeded from `defaultSettings` (`src/tools/settings.ts:51-314`). Grepping `localStorage`
across `src/` returns exactly two keys — `panelLayout` (`src/contexts/PanelLayout.tsx:229`, `:304`)
and `theme` (`src/contexts/ThemeContext.tsx:14`, `:28`). Nothing reaches the disk.

So the comment's stated scenario cannot occur, and a reader who believes it will reason about a
restore path that does not exist when changing the clamping. It is worse than a harmless lie for a
second reason: if tool settings _were_ persisted, `settings.ts` would be the wrong home for them,
because it is a module singleton a reload discards by construction. The comment describes the
architecture the code should have and does not.

**Fix.** Correct the comment to say settings are per-session module state, which is the fact, and
keep the clamping — it is right for a different reason: `defaultSettings` is `satisfies
ToolArgsByName`, so a hand-edited default outside Photoshop's range would produce exactly the
disagreeing readout. If cross-reload persistence is wanted, that is a feature, it belongs in a
`localStorage` layer with a versioned schema, and the two comments become true. Neither is a
cleanup; pick deliberately.

**Files.** `src/components/ToolbarsRight/Sharpen/Sharpen.tsx:111-112`,
`src/components/ToolbarsRight/Smudge/Smudge.tsx:114`, `src/contexts/useCurrentTool.tsx:62`,
`src/util/settings.ts:22-155`, `src/tools/settings.ts:343`

---

## 139. The superseded point-in-time reports cannot be moved without editing a data file

`AUDIT-STASHED-DOCS.md`, `FOCUSED-REVIEW-2026-09-28.md`, `MIGRATION_NEXT_STEPS_SUNDAY.md`,
`TEST_ISSUES.md` and `CANVAS-RESOLUTION-PLAN.md` sit at the repository root and are not part of any
documentation hierarchy: all five are point-in-time reports, and two carry banners saying they are
obsolete (`TEST_ISSUES.md:3-8`, `docs/save-settings-inconsistency.md:3-11`, `docs/next-target-useLayer.md:3-8`).
`docs/README.md` now names all seven — those five plus the two recovered `docs/*.md` subjects — and
excludes them explicitly.

The obvious cleanup — move them to `docs/archive/` — **breaks `curated.mjs`**, which is why it has
not happened. `scripts/lib/worktree-inventory/curated.mjs` keys `ref:` values on these exact
paths, 9 references in all: `TEST_ISSUES.md` at `:300,313,324`, `AUDIT-STASHED-DOCS.md` at
`:299,315,326`, `FOCUSED-REVIEW-2026-09-28.md` at `:244,254`, and `MIGRATION_NEXT_STEPS_SUNDAY.md`
at `:341`. Beyond
that, `TEST_ISSUES.md` and `AUDIT-STASHED-DOCS.md` reference each other, and the two obsolete
`docs/*.md` files each point at `AUDIT-STASHED-DOCS.md`. `git ls-files '*.md' | xargs grep -c`
over the tracked markdown names 43 further occurrences: 16 in this file, 15 in
`AUDIT-STASHED-DOCS.md`, 8 in `docs/README.md`, one each in `TEST_ISSUES.md`,
`docs/next-target-useLayer.md`, `docs/save-settings-inconsistency.md` and `e2e/OPEN_PROBLEMS.md`.
**`.skills/` names none of them** — an earlier draft of this entry put "roughly twenty prose
references across `.skills/`" here, and `grep -rl` over `.skills/*.md` returns zero for all four
names, so the migration touches no skill file at all.

Two of the seven are genuinely dead and can go without ceremony: `TEST_ISSUES.md` says "do not add to
it", and `docs/next-target-useLayer.md` says "do not work from it" — both contradict their own
bodies, which still read as open plans, which is the residue the lifecycle rule exists to prevent.
A third is worse: `docs/save-settings-inconsistency.md:3-9` carries a "Superseded" banner and then
`:11` heads a `## Status: Open` section underneath it, so the file contradicts itself eleven lines
down. Deleting it is part of the same change.

**Fix.** Do it as its own change, not inside a documentation change: delete `TEST_ISSUES.md`,
`docs/next-target-useLayer.md` and `docs/save-settings-inconsistency.md`, then move the remaining
root reports to `docs/archive/` and update the four `ref:` key sets in `curated.mjs` plus the prose
references — including `docs/README.md`, whose "Not maintained here" table currently lists the two
deleted files as rows. `CANVAS-RESOLUTION-PLAN.md` has no `ref:` key, so it moves on prose
references alone. Verify by grepping for each old path afterwards, and by running
`npm run test:e2e:unit` — `scripts/__tests__/worktree-inventory.test.mjs` parses `curated.mjs` and
would catch a stale key.

**Files.** `scripts/lib/worktree-inventory/curated.mjs:244,254,299-341`,
`docs/README.md:78-94`, `TEST_ISSUES.md:3-8`, `CANVAS-RESOLUTION-PLAN.md:1-4`,
`docs/next-target-useLayer.md:3-8`, `docs/save-settings-inconsistency.md:3-11`,
`e2e/OPEN_PROBLEMS.md`
---

## 140. `index.html` loads a Google Tag Manager container, so every e2e run beacons to Google

`index.html:18` and `index.html:35` load the Google Tag Manager container `GTM-WBWSB9XS` (the id is
declared at `index.html:20`) from `googletagmanager.com`. Nothing in `e2e/` stubs, blocks or
asserts on it.

Three consequences, in increasing order of how much they matter:

1. **The suite is not hermetic.** `e2e/helpers/console-police.ts:34-40` is where this is now
   recorded, in the "reported but not failed" list — the container "beacons to
   `region1.google-analytics.com` on every page — including every e2e run, which makes the suite
   non-hermetic and would otherwise fail ~36 times over a network call no test controls". That is
   the accurate figure; the "1-8 per test" this entry used to quote is not stated anywhere in the
   tree and should not be re-derived by guess.
2. **Every CI run contacts a third party.** A build gate that depends on Google's reachability
   to stay green is a build gate with an extra failure mode it does not own.
3. **Local development leaks to a production analytics property.** A developer's stroke, tool
   switch and undo are reported to that container with no opt-in. (The measurement id this entry
   used to name, `G-7F5V72YQ4K`, is **gone** — `grep -rn 'G-7F5V72YQ4K' index.html e2e/ src/`
   returns nothing, so only the container remains.)

Whether analytics belongs in a local editor at all is an operator decision and is not made here.

**Fix.** Decide the policy first — absent, or opt-in behind an env flag that `e2e/` sets to
nothing. Then either drop the two script tags from `index.html` or make them conditional on that
flag, and have `e2e/global-setup.ts` route `*.google-analytics.com` and `*.googletagmanager.com`
to `abort()` so the suite stops depending on them. The third point is the one worth resolving
regardless of which policy is chosen.

**Files.** `index.html:18,20,35`, `e2e/global-setup.ts:237`, `e2e/helpers/console-police.ts:34-40`

---

## 142. `classify` reports the main worktree as `keep` while it holds the only copy of uncommitted work

`scripts/lib/worktree-inventory/classify.mjs:236-243` returns for the primary worktree before any
tree-state check runs:

```js
if (wt.isPrimary) {
  recommendation = live ? RECOMMENDATION.IN_USE : RECOMMENDATION.KEEP;
  reasons.push('the main worktree is never a deletion candidate');
}
```

`KEEP` maps to `ACTION.KEEP` in the one-decision switch (`:334`), never `AT_RISK`. The
`STATUS.UNMERGED_WORK`-with-`uncommitted` arm that produces `SALVAGE` → `AT_RISK` (`:294-299`) is
downstream and never reached for the main checkout.

**Observed, not inferred.** While correcting the §117 decision record, `npm run test` failed with:

```
ph (curated: NONE): ahead=0 onMain=true dirty=3 untracked=0
  -> status=landed recommendation=keep action=keep prunable=false
  — readable, so this must be reported as at-risk, not as anything else
```

Three modified files in main, in no commit on any branch, classified as **keep**. The guard at
`scripts/__tests__/worktree-inventory.test.mjs:2326-2331` caught it and the suite went green the
moment the files were committed — which is the correct behaviour of the guard and the defect in
`classify` at the same time.

**Why it matters.** The inventory's stated purpose is to point an operator at work that exists in no
commit and can therefore be lost. Main is the **most** likely place for that, not the least:
`docs/ORCHESTRATION.md:118-120` records that other sessions commit into it concurrently, and
`:122-130` documents a merge that silently reverted 17 files through it. A `keep` verdict is read as
"this checkout is fine" by anything consuming the inventory, and the one checkout whose loss is
catastrophic gets the verdict that says nothing needs attention. The `isPrimary` exemption is
correct for **deletion** — the comment at `:237-240` is right that main is the landing site — but
the branch conflates "not a deletion candidate" with "nothing to report".

**Fix.** Keep the primary worktree out of every prune and dispose verdict, and make the dirty case
fall through to the salvage path rather than short-circuiting it. The narrowest correct shape is to
compute `uncommitted` first and let a primary worktree with a dirty tree reach the same
`AT_RISK` verdict a secondary one gets, while a clean primary still reports `keep` for the reason it
already gives. `wt.isPrimary` then needs to gate the _prune_ decision rather than the whole
recommendation.

**This entry is not a request to weaken a test.** The failing assertion is the guard working. Do not
touch `worktree-inventory.test.mjs:2326`; fix `classify`. Reproduce by editing any tracked file in
main and running `npx vitest run scripts/__tests__/worktree-inventory.test.mjs`.

**Files.** `scripts/lib/worktree-inventory/classify.mjs:236-243`, `:294-299`, `:314-338`,
`scripts/__tests__/worktree-inventory.test.mjs:2300-2336`

    docs(handoff): the AVIF timeout is a symlink artefact, and main's entry is correct

    Two audits disagreed about e2e/OPEN_PROBLEMS.md:704. The second measured the AVIF
    pair failing on a detached worktree of committed main and concluded the entry was
    falsified. The measurement was made through a symlinked node_modules, so Vite
    refused to serve the @jsquash avif_enc.wasm - the run's own [WebServer] log says so
    in one line - and the encoder never finished. With a real npm ci in the worktree the
    same specs pass on the same commit.

    Acting on the wrong conclusion would have replaced a correct entry with a wrong
    one, so the finding is recorded as a non-finding.

diff --git a/HANDOFF.md b/HANDOFF.md
index 772cc328..d599aa82 100644
--- a/HANDOFF.md
++ b/HANDOFF.md
@@ -4471,3 +4471,47 @@ misleading", because `tsc` and `vitest` mostly work by walking up to the parent.
form of the same trap: they not only work, they work on the wrong files.

**Files.** `node_modules/.bin/tsc`, `scripts/tsc-guard.mjs`, `scripts/__tests__/tsc-guard.test.mjs`

## 143. The AVIF export timeout is NOT a defect, and `e2e/OPEN_PROBLEMS.md`'s entry is correct — do not "correct" it

**Problem.** Two audits of this sweep disagreed about the same thing, and the second one was wrong.
Main's `e2e/OPEN_PROBLEMS.md:704` records the AVIF download timeout and states that **both specs pass
on `main`**, calling load "an explanation rather than a measurement". One audit measured the AVIF pair
failing on a detached worktree of committed `main` and concluded that entry was falsified. That
conclusion is wrong, and acting on it would replace a correct entry with a wrong one.

**What actually happened.** The "measurement on main" was made in a worktree whose `node_modules`
was a symlink to the root checkout. Vite does not walk up — it serves only what `server.fs.allow`
permits — so the run's own log says:

```
[WebServer] The request id "/Users/bkalynovskyi/ph/node_modules/@jsquash/avif/codec/enc/avif_enc.wasm"
            is outside of Vite serving allow list.
```

The wasm never loads, the encoder never finishes, and no download event fires. That is the symlinked
\-`node_modules` trap, hitting through the _verification recipe_ rather than the product. With the
symlink removed and a real `npm ci` in the worktree, the same two specs on the same `main` commit:

```
✓ raster-formats.spec.ts:8 › exports to AVIF (.avif) with pixel verification (1.1s)
✓ visual-regression.spec.ts:58 › exports to AVIF (.avif) matches visual baseline (1.2s)
13 passed (16.7s)
```

**Reproduce the trap rather than the defect.**

```bash
git worktree add --detach /tmp/avif-check main
rm -rf /tmp/avif-check/node_modules          # or simply do NOT symlink it
(cd /tmp/avif-check && npm ci)                # and rm BEFORE npm ci, or npm ci deletes the root's
(cd /tmp/avif-check && npm run test:e2e -- e2e/export/raster-formats.spec.ts)
```

**Fix / convention.** A measurement taken through a symlinked `node_modules` is not a measurement of
`main`. When an audit reports that a documented flake reproduces on `main`, the first thing to check is
whether the reproduction was itself broken — and the run's own `[WebServer]` log usually says so in one
line. **The entry at `:704` stands.** Do not edit it, and do not add a second AVIF entry.

**Files.** `e2e/OPEN_PROBLEMS.md:704`, `e2e/export/helpers.ts:408`,
`node_modules/@jsquash/avif/codec/enc/avif_enc.wasm`

---

## 144. The uncommitted-work guard misses the main worktree, and only the main worktree

`scripts/__tests__/worktree-inventory.test.mjs` asserts that any worktree holding work git
cannot see is classified `at-risk`. Run with a dirty main checkout it fails, and it names the main
worktree:

```
ph (curated: NONE): ahead=0 onMain=true dirty=7 untracked=1 -> status=landed
   recommendation=keep action=keep prunable=false — readable, so this must be
   reported as at-risk, not as anything else
```

`status=landed` and `recommendation=keep` are the answers for a worktree with **nothing
uncommitted in it**. The guard read `dirty=7 untracked=1` correctly, on the line above, and then
classified a different shape. Verified by isolating `classify` with the shape the test hands it:
`workingTree.modified: 7` returns `status=uncommitted-only recommendation=salvage action=at-risk`,
which is what the test demands. So `classify` is right and **the facts object the guard passes it
is not the one whose `workingTree` was counted**.

The likely cause is the name join at `worktree-inventory.test.mjs:2302` —
`worktrees.find((x) => x.name === r.name)` — against the shape `liveWorktreeFacts` builds at
`:344-357`, which sets `mergedIntoBase` and `commitsAhead` rather than the `mergedIntoMain` the
predicate at `:307` reads. A join that misses returns `undefined` and throws; one that matches a
_different_ worktree with the same display name returns a clean shape and reads `landed`, which is
the failure above.

**Why it matters beyond the red.** This is the property `scripts/dispose-worktree.mjs` leans on: it is
`git worktree remove --force` after git has already refused, and it is that a clean tree is not
evidence a worktree is abandoned. The guard exists so uncommitted work is never classified as
safe. A miss on the main checkout is the one place uncommitted work is guaranteed to exist,
because that is where agents work.

Reproducible and deterministic: it passes on a clean tree and fails on any dirty one, so it is
**not** flaky and not a pool artifact — it is red for every session with uncommitted work, which is
every session until it commits.

**Fix.** Compare the two shapes field by field at the join and assert they are the same object, so
the failure names which field is missing rather than reporting a verdict. Then classify `r` itself
rather than a name-matched lookup, since `buildInventory` already produced `r`. Add a case that
constructs a dirty-mainworktree shape directly, so the guard does not depend on the developer's
working tree to have anything to assert.

**Files.** `scripts/__tests__/worktree-inventory.test.mjs:307`, `:329-357`, `:2300-2336`,
`scripts/lib/worktree-inventory/classify.mjs:105`, `:159`

## 145. The Dodge's and the Burn's tonal-range shortcuts are described as working, and are bound to nothing

**Problem.** `src/tools/descriptions/focus.ts` carries six `shortcuts` rows that state, as fact, what
`Shift+Alt+S`, `Shift+Alt+M` and `Shift+Alt+H` do to the Dodge and to the Burn — "Sets the stroke to
the Shadows range while the Dodge tool is active" (`:275`, `:379` and its two siblings at `:280`,
`:284`, `:384`, `:388`). **No keyboard handler anywhere in the app binds them.** The only two
`alt: true` registrations in `src/components/Common/AppKeyboardShortcuts.tsx` are the Sponge's own
mode keys, at `:596` and `:606`. The Range select is the only thing that writes
`DodgeBurnToolArgs.range`, and it writes it from the user's click
(`src/components/ToolbarsRight/Tonal/Tonal.tsx:107`).

**Why it is a defect and not a gap.** A missing capability is filed `missing` per control. These rows
are in the `shortcuts` array, which has **no status field at all** — a row there reads as a statement
about what the app does, so a reader of the tooltip, of the generated `docs/TOOLS.md`, and of this
file's own `implementationRefs` is told six keys work. The Dodge and the Burn are both filed
`partial`, and their `appNotes` names the missing `Protect Tones` and `Airbrush` controls without
once mentioning that three of their documented keys are inert.

**How it became visible.** Building the Sponge forced the question. Adobe gives the Sponge
`Shift+Alt+D` and `Shift+Alt+S` and gives the Dodge and the Burn `Shift+Alt+S/M/H` **on the same page
of the same table** — Julieanne Kost's Adobe-blog post states both sets, and the Adobe-branded CS2
sheet carries all five rows
(<http://www.cheat-sheets.org/saved-copy/PSCS2_Shortcuts_Windows.pdf>). Photoshop resolves the
`Shift+Alt+S` collision by which tool is active, and the Sponge now does too
(`enabled: toolName === 'sponge'`). That asymmetry is correct and is the whole point of the gate, but
it leaves the pair's three keys as the only rows in the family describing something that does not
happen.

**Fix.** Bind all three for both tools in `selectTonalTool`'s neighbourhood, each gated on the active
tool being `dodge` or `burn`, using `patchToolArgs(tool, { range })` — the same `alt`/`shift`
registration shape the Sponge's two mode keys use. The three values already exist as
`DODGE_BURN_RANGES`, so this is three registrations and a small table, with no new args field. Until
then, either delete the six rows or add a `status` field to `ToolShortcut`
(`src/tools/descriptions/types.ts:58-63`) so a documented key can be recorded as unbound; the second
is the durable fix, because the field is the reason this could not be caught mechanically.

**Files.** `src/tools/descriptions/focus.ts:275`, `:280`, `:284`, `:379`, `:384`, `:388`;
`src/components/Common/AppKeyboardShortcuts.tsx:596`, `:606`;
`src/components/ToolbarsRight/Tonal/Tonal.tsx:107`;
`src/tools/descriptions/types.ts:58`

## 146. Two of the Sponge's seeded defaults are choices Adobe never documents, and one is destructive if wrong

**Problem.** The Sponge shipped with `mode: 'desaturate'` and `vibrance: true`
(`src/tools/settings.ts:269`). **Neither is an Adobe default, because Adobe documents neither.** A
dedicated search of Adobe's desktop Sponge page, its tool-techniques page, the CS4 manual and the
CS2 Bible found no statement of which `Mode` the bar opens on and no statement of whether `Vibrance`
ships checked. The app's two seeds rest on arguments, recorded at `SPONGE_MODE_DEFAULT`
(`src/tools/sponge.ts:60`) and in the tool's `appNotes`:

- `Desaturate` was chosen because it is the non-destructive direction, since a saturated stroke that
  clips a channel cannot be painted back. **One non-Adobe source asserts it** and no second was found.
- `Vibrance` **on** was chosen because Adobe documents the control as the thing that prevents
  clipping. Against that: Adobe's sentence is an _action_ ("Select the Vibrance option to minimize
  clipping"), which reads as an instruction to enable it and so points at **unchecked**, and one
  2026 tutorial is consistent with unchecked.

**Why it is filed rather than settled.** `docs/OVERRIDES.md` may not be edited by an agent, and there
is nothing to override here in any case: **the source is silent, not contradicted**, so neither seed
is a deviation from Adobe. That leaves an unverifiable default in shipped code, which is exactly the
kind of thing a reviewer cannot check and an operator can settle in about ten seconds against a live
Photoshop. If `Vibrance` is really unchecked, the tool's Saturate direction clips channel values that
`Vibrance` was on precisely to protect; if `Mode` really opens on Saturate, a first stroke out of the
box can clip.

**Fix.** Confirm both against a live Photoshop and change `src/tools/settings.ts:269` if either is
inverted. Nothing else needs to move — both are single values, both are already isolated as named
constants, and both are already the subject of pinned unit tests. If the defaults cannot be
confirmed, the alternative is to stop asserting either: render the `Mode` select unseeded and refuse
the commit until the user chooses, which is worse and is not recommended.

**Files.** `src/tools/settings.ts:269`; `src/tools/sponge.ts:60`, `:87`;
`src/tools/descriptions/focus.ts` §sponge `appNotes`;
`src/tools/descriptions/focus.notes.md` §Sponge Tool and items 15-16

## 147. The app has no document colour modes, so every Photoshop rule scoped to one is unimplementable

**Problem.** Adobe scopes behaviour to `Image > Mode` in several places, and this app has no such
surface — a `grep -rni grayscale src` finds only `colors.ts`'s `grayscale` **filter amount**
(`src/tools/colors.ts:5`, applied as a canvas `ctx.filter` at `:15`), the `color` tool's own
`Grayscale` slider (`src/components/ToolbarsRight/Colors/Color.tsx:130`), a PSD-import warning
(`src/contexts/psd-utils.ts:80`, "Grayscale PSD converted to RGB") and the Sponge's own prose.

The Sponge is the case that surfaced it. Adobe: "When an image is in Grayscale mode, the tool
increases or decreases contrast by moving gray levels away from or toward the middle gray"
(<https://helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html>), and Photoshop
Elements splits the direction — "In grayscale, Saturate increases contrast … In grayscale,
Desaturate decreases contrast" (<https://helpx.adobe.com/photoshop-elements/using/adjusting-color-saturation-hue-vibrance.html>).
That rule is **deliberately not implemented** (`SPONGE_MIDDLE_GREY`, `src/tools/sponge.ts:110`), and
the reasoning is sound: the rule is scoped to a document MODE, and on an RGB pixel with no chroma the
chroma scale is already an exact no-op, so adding the pivot would make the tool behave the way
Photoshop behaves in a mode this app cannot reach.

**Why it is filed anyway.** The same trap is waiting for any future mode-scoped rule, and there is
more than one: `Image > Mode` also governs what the Channels panel lists, what a Lab-document's
`Image > Adjustments` behaves like, and how Photoshop's own Histogram reads a merged channel. An
agent that finds one of those will read the Sponge's `appNotes` and conclude "no mode, so skip it",
which is right here and would be wrong elsewhere — a greyscale document imported from a PSD is
**already converted to RGB on import** (`psd-utils.ts:80`), so the pixels a mode-scoped rule would
read as grey exist in the app today, as RGB pixels, and the mode-scoped rule would then be the
Photoshop-correct answer for them. That inversion is the trap.

**Fix.** Decide whether the app has document modes at all. If it does not, say so once in
`docs/FEATURES.md` against the capability and treat mode-scoped Photoshop behaviour as unimplementable
rather than absent — and change the Sponge's `appNotes` to say which way that reasoning runs, since it
currently reads as "no mode, so nothing to do" when the imported-greyscale case is the opposite. If it
should, `Image > Mode` is a document-level property with a PSD round trip attached, and the Sponge's
grayscale branch is a small consumer of it rather than the reason to build it.

**Files.** `src/tools/sponge.ts:110`; `src/tools/colors.ts:5`, `:15`;
`src/components/ToolbarsRight/Colors/Color.tsx:130`; `src/contexts/psd-utils.ts:80`
=======

## 148. The rail's fit depends on React flushing passive effects before the first paint, and the fix is refused by a lint rule

**Problem.** `useToolbarOverflow` (`src/components/SidebarLeft/use-toolbar-overflow.ts`) measures the
rail from a ref callback, which runs during commit. React subscribes to an external store in a
**passive** effect, so at that moment there is no listener to notify, and the `setSlots` layout
effect publishes into the same empty set. The committed tree therefore holds the plan from _before_
the measurement, and `planToolbarOverflow`'s own answer to an unmeasurable rail is
`everythingVisible` — so the first committed rail is **every tool on screen**, sixteen tiles in a
slot that fits eight at 1280x720, corrected on a later commit. `SidebarLeft` returns above the
`<aside>` when there is no document while this hook sits above that check, so the hook survives and
the sequence repeats on **every document close and open**, not only on the first page load.

**It has not been observed failing, and that is measured rather than assumed.** A
`MutationObserver` installed by `page.addInitScript` — before the app's own script, and with
microtask callbacks, which run before the paint the mutation enables — recorded the first rail it
ever saw as already fitted: eight tiles at 720. Chrome flushes React's passive effects inside the
mounting task, so the refit lands before the first frame in practice. **In practice is not a
promise**, and the promise is what a load-time flash of a full rail would rest on.

**The obvious fix is refused by the repository's own rule.** A layout effect that re-renders when
the snapshot has moved ahead of the render is exactly what closes the window, and
`react-hooks/set-state-in-effect` rejects it: _"Calling setState synchronously within an effect can
trigger cascading renders"_. That rule is right in general and the effect is a cascading render, so
it was **not** suppressed to make the warning disappear. No gate was weakened and the rail behaves
as it is measured to behave.

**What would close it.** A decision, and this entry is the finding rather than the decision:
either an `OVERRIDES.md` entry accepting one `set-state-in-effect` suppression on this file with
the measurement above as its justification, or a design that does not need a pre-paint refit at all
— a CSS-driven fit (`@container` queries, or the tile count derived from the slot's height with
`overflow` doing the arithmetic) so there is no measurement to be late with. The second is the
better answer and is a rewrite of this subsystem, not a patch.

**Why there is no test.** A pin that could not fail was written, measured, and removed: the
`MutationObserver` assertion above passes identically with and without the fix, because the browser
never paints the unrefitted tree here. `e2e/toolbar-fit.spec.ts` deliberately has **no** test for
this, and that absence is the honest state — if one is added it must be able to go red when the
scheduling changes, or it is a tripwire for a defect that cannot occur.

**Files.** `src/components/SidebarLeft/use-toolbar-overflow.ts`, `src/components/SidebarLeft/SidebarLeft.tsx:1010`,
`react-dom` `mountSyncExternalStore` (a **passive** `mountEffect`, and a consistency check that only
runs on a concurrent render that yielded — neither is a pre-paint refit).

---

## 149. The three-dots flyout reopens itself after the window crosses the edge where nothing collapses

**Problem.** `openGroup` is reset when its tile is swallowed by a collapse, but only against
`collapsedGroups` (`src/components/SidebarLeft/SidebarLeft.tsx:388`), and that set can only ever
contain GROUP keys — `0-0`, `two-column-N`. The three-dots tile is keyed `OVERFLOW_GROUP_KEY`, the
string `'overflow'` (`:133`), which no group key can equal. So `collapsedGroups.has('overflow')` is
always false, the reset never fires for that tile, and `openGroup` outlives the unmount.

**Reproduced.** Open the three-dots menu at 1280x700, grow the window to 1400 — the tile unmounts,
because at 1400 all sixteen groups fit and nothing collapses — then shrink back to 700. The tile
remounts with the flyout **already open**, and nothing was clicked in between:

```
AFTER GROW:   overflow tile count = 0
AFTER SHRINK: the flyout is in the DOM with nothing clicked = 1
```

The user is shown a tool menu they did not open, over the tool they were reaching for.

**Why the `lg`-crossing fix at `:388` does not cover it**, and is worth reading as the same class
rather than the same bug: the two crossings both unmount tiles, and both leave `openGroup` naming a
tile that is no longer rendered. The desktop↔tablet crossing is handled by deriving the adjustment
from the layout; a COLLAPSE is handled by the `collapsedGroups` membership test; and the
collapse↔no-collapse crossing belongs to a third condition that nothing checks — the fit going
from `showOverflowTile: true` to `false` while `openGroup` is `'overflow'`.

**Reachability moved with the fit's budget, which is why it is filed now.** Nothing collapses from a
1094px window up, where before the budget change nothing collapsed from about 1300. The window has to
be dragged 206px less far to reach the state, and the drag is the natural gesture a user performs
while looking at an open flyout — to give the rail more room.

**What would close it.** Reset `openGroup` when `overflowPlan.showOverflowTile` goes false, the same
way the `lg` crossing does: derived from the state that changed, adjusted during render rather than
in an effect. A test belongs with it — open the menu, resize past the edge, resize back, and assert
the menu is not there — and **the height has to come from the rail's own arithmetic** (or from the
edge `e2e/toolbar-fit.spec.ts` already pins at 1094/1093), not from a hardcoded window, or the next
tile to be added moves it.

**Do not fix it by clearing `openGroup` on every `ResizeObserver` publication.** The store publishes
on plan changes only, and that is the point of the throttle; a subscriber that reset state on every
version bump would re-open the same class of problem as the one the throttle closed.

**Files.** `src/components/SidebarLeft/SidebarLeft.tsx:133,211,383-391,1227,1236`,
`src/components/SidebarLeft/toolbar-fit-store.ts` (the fit whose `showOverflowTile` edge moved),
`e2e/toolbar-fit.spec.ts:317-322` (the 1094/1093 edge).

## 150. A marquee drag that leaves the canvas is dropped rather than clamped, and the two families disagree about it

**Problem.** `SingleRowColumnMarqueeToolArea.tsx` wires both `onPointerLeave` and
`onPointerCancel` to `abortDrag` (`:424`-`:425`), so a drag that leaves the tool element ends as
a cancelled gesture that commits nothing. The geometry module documents the opposite behaviour
three files away: `singleRowColumnMarquee.ts:65-73` advertises that an out-of-document pointer
clamps to the first or last row, and cites Adobe's scripting API as the reason. Both statements
cannot stand. Only the PRESS clamps. A drag past the canvas edge is discarded.

`EllipticalSelectionToolArea.tsx:301`-`:302` wires the same pair, so this is house convention
rather than something these two tools introduced — but `RectangularSelectionToolArea.tsx:154`-`:160`
wires `pointercancel` ALONE, so the rectangular marquee keeps tracking a drag off the edge. Three
selection tools, two behaviours, and one of the two is undocumented.

**Why it is reachable and not theoretical.** The tool element is the canvas area, so the abort
fires as soon as the pointer crosses it. At zoom 1 with letterboxing that is the document edge;
zoomed in past the fit, the document edge _is_ the container edge, so dragging toward a document
boundary — which is exactly how a user aims at the last row — is dragging toward the abort.

**What Photoshop does.** It keeps tracking. There is no published Adobe page for the GUI case,
which is why this is filed as a defect in this repository's own consistency rather than as a
deviation from Adobe: `docs/FEATURES.md` should record that the app drops the gesture.

**What would close it.** Narrow the abort to `onPointerCancel` in
`SingleRowColumnMarqueeToolArea.tsx` and `EllipticalSelectionToolArea.tsx`, so a leave ends the
gesture only if the pointer capture has already been lost. That is one wiring change in each
file, and it is deliberately NOT done here: `usePointerPosition`'s capture is what keeps `pointermove`
delivered outside the element, so the abort is currently the only thing stopping an unbounded
stream of moves from a pointer the user has visually left the tool. Decide it for the selection
family at once, and add the case that pins whichever way it goes — press, move outside the
element, move back, release — asserting the band lands where the release was.

**Do not fix it by clearing the drag on `pointerleave` without also releasing the capture.**
That was the wedge fixed in `usePointerPosition.ts` (the `releasePointer` export): a surviving
`activePointerId` refuses every later press, so the tool stops responding until it unmounts.
`abortDrag` calls `releasePointer()` for that reason and must keep doing so.

**Files.** `src/components/Main/SingleRowColumnMarqueeToolArea.tsx:424-425,390`,
`src/components/Main/EllipticalSelectionToolArea.tsx:265-276,301-302`,
`src/components/Main/RectangularSelectionToolArea.tsx:176`,
`src/tools/singleRowColumnMarquee.ts:65-82`.
