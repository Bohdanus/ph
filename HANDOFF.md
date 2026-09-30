## 0. Branch state — read before the problem list

**Most recent:** the reorder append-boundary slice (`history/reorder-durable-append`, base
`da5f719`, merged with `main` at `5bd2bdf`) publishes `reorder-layers` through the single-writer
decision and found one real defect on the way, recorded in §15. It grew both `history-append.ts`
and `StoreContext.tsx`, and merging `main` moved `useLayer.ts` as well, so every citation into those
three files was re-derived twice — once for the slice and once for the merge. §16 and §17 had
citations re-derived in the same branch.

**A standing defect in this file that is not an item: most of its line-numbered citations are
stale.** An audit of all 210 of them found 60 resolving to the wrong code and 30 resolving to a
blank line, a comment, a closing brace or an import — the drift is mechanical (whole clusters are a
uniform `+1` in `useHistory.ts` and a uniform `+6` in `toolProcessors.ts`) and the prose at a stale
line still reads plausibly, which is exactly why a `grep` sweep does not catch it. Two claims are
wrong at the claim level rather than the line level, and both are fixed above: §16's "the boundary
does warn" (there is no `console.warn` in `history-append.ts`), and §15's row for a deleted
`addHistoryEntry`. **Re-derive a citation from the sentence that contains it, never from the old
number**, and treat every citation in a file you have not just read as unverified.

**A second audit, of the two highest-churn files only, at `f7757cf`.** _Owner: GPT model
(history-migration)._ All 18 line targets into `StoreContext.tsx` (1181 lines) and
`history-adapter.ts` were re-derived from their prose: **16 confirmed, 2 wrong at the claim level
rather than the line level, 0 resolving to a blank or degenerate line.** That is a much better
result than the sweep above and is not in tension with it: the 60 wrong there are dominated by
low-churn files, while these two are the ones that move. Both survivors are the dangerous kind —
they resolve, and they carry the identifier they name:

- **§15's `StoreContext.tsx:386 layerOrderBottomFirst` is the declaration, not the boundary read.**
  The prose claims the reorder pre-state is `state.layers` read at the boundary. Line 386 is a
  three-line pure helper whose whole body is `getSortedLayersArray(layers).map(...)`
  (`StoreContext.tsx:386-388`); it holds no boundary, no state and no `state.layers`. The read is
  `StoreContext.tsx:885`. A `grep` for `layerOrderBottomFirst` confirms 386 is "the right place".
  The code at both locations is correct — only the citation is wrong, so fixing it is a re-derivation
  from the sentence, not an edit to `StoreContext.tsx`. **Closed 2026-09-28:** §15 now cites
  `StoreContext.tsx:890 layerOrderBottomFirst(currentState.layers)`, the boundary read. Note that
  rotating the citation to the _declaration_ would have been the wrong fix and a second audit caught
  it — the declaration moved 386 → 396 in the same change, so a line-tracking rotation would have
  looked correct and pointed at the helper again.
- **§1's `StoreContext.tsx:659-696` is the right function at the wrong layer.** 659-696 is
  `buildDurableDocument`, which does derive the shadow, but it returns `{ status, document,
diagnostics }`. None of the three `StoreData` field names occurs in the range except a read of the
  previous revision (`StoreContext.tsx:670`). §1 has been rewritten to say so.

That audit also found one claim-level error in §1, now fixed in place: it said the shadow fields are
"read by nothing outside that file", which is false — `DevStatusStrip.tsx:18` and
`ErrorBoundary.tsx:48` both read them — though neither runs on a normal production load, so §1's
conclusion that the deliverable is unwired still stands. Worth knowing while auditing the reader
set: `DevStatusStrip.tsx` contradicts itself, claiming at `:12-15` that a production bundle keeps
the call, and at `:58-60` that it never subscribes in production. `:58-60` is the correct one.

Verified on `fix/handoff-2026-09-28`, branched from `main` at `80eb207` and merged to `main` with
it. Items 6, 15, 18, 19 and 20 were closed here or landed from the migration while this branch was
in review; 6 and 15 are `2dfc18e`, 20 is `2d985d4`, and 18/19 and the encoder half of 20 were done
here independently and are deleted.

**Read this before working on any item below.** Items 1, 2, 4, 10, 11, 12, 16, 17, 31 and 32 all
live in `history-adapter.ts`, `history-append.ts`, `history-timeline.ts`, `selection-baseline.ts`,
`useSelectionHistory.ts`, `useHistory.ts` **or `StoreContext.tsx`** — the files the
history-migration roadmap edits. Fixing them outside the migration duplicated work and produced a
`useHistory.ts` conflict the first time it was attempted. **Read the migration's own handoffs
first:** `.kilo/plans/history-migration-consolidated-handoff.md` and
`.kilo/plans/history-migration-08-phase1-writer-readiness.md`. Those live under `.kilo/`, which
`AGENTS.md` says is gitignored and machine-local, so they are a pointer and not a durable location:
the reasoning in them has to be re-derived if the machine is lost.

`StoreContext.tsx` was missing from that list until 2026-09-28, which made the list read as
complete when it was not: item 1's own `**Files.**` line names it, so the item this paragraph
claims "lives in" a six-file set was in fact seven. A finding whose fix lands in
`StoreContext.tsx`'s `APPLY_HISTORY_REPLAY` dispatch is therefore migration-owned — the
`APPLY_HISTORY_REPLAY` arm is the entry point for undo, redo and `toggleDisabled`, all of which the
roadmap is reshaping.

**Ownership label: `[OWNED — history-migration roadmap, GPT-model session]`.** Everything matching
that label is worked by a GPT-model session running the migration, and a free-model session must not
pick it up. The repo's convention is a bracketed suffix on the entry heading naming the OWNING
WORK, not a per-finding model field — `FOCUSED-REVIEW-2026-09-28.md:13` uses the same shape
(`[FREE]`, `[OWNED — report only]`), and `assigned to` returns zero hits in every root `*.md`. Apply
it to any item whose fix lands in a file the list above names.

Two questions the plan answers, recorded so they are not re-litigated:

- **Item 4's status semantics are the plan's, not a judgement call.**
  `DurableConversionStatus` is `'current' | 'unavailable'`, and
  `history-migration-05-safety-correctness-next-steps.md` defines `unavailable` as "conversion
  failed and **no safe durable result exists**". A document that converts cleanly minus a few
  unsupported entries _is_ a safe durable result, so it stays `current` with error diagnostics and
  only a structural failure is `unavailable`. The plan's fourth state, `converting`, was never
  implemented, so that part of item 4 is still open.
- **Item 1 is the cutover the plan gates, not a wiring task.** The plan's own status table marks the
  interleaved-affine fix (item 2) a Phase 3 blocker, and Phase 3 _is_ the cutover. So the fix for
  item 1 is to wait for Phase 3, not to mount `ReplayCoordinator` early — and the two pins in
  `StoreContext.durable-boundary.test.tsx` are the last thing standing between it and a
  half-wired render path: the one `it.fails` at `:441` and the plain `it` at `:573` that asserts
  the replay surface is still absent. Any recommendation to delete those pins is wrong for that
  reason.

**`fix/unit-tests` (`b027de3`) is preserved as the tag `archive/fix-unit-tests` and is deliberately
NOT merged — it is not a merge candidate.** Merging it deletes test blocks `main` now owns: across
the 8 test files it touches the block count falls by 17, and `history-append.test.ts` alone goes
from 43 blocks and 16 `it.each` tables to 21 and 3. It also carries 11 `it.fails` pins `main` has
since retired, and it predates the `selection-baseline.ts` extraction, so a merge reverts that
refactor too. Its two diagnostics were re-implemented here against current `main` rather than
ported. Of the four items it claimed, 18 and 19 landed elsewhere and are deleted; the two it still
owed are **§16** and **§17**, whose conversion halves are done and whose append-boundary halves are
the remaining work in each.

### Two efforts, one set of files

The migration session's uncommitted work in
`.kilo/worktrees/history-append-layer-ops-afb2990dacc9df33` became `2dfc18e` and `2d985d4` while
this branch was in review, so the rebase needed manual resolution in `StoreContext.tsx`,
`avif-utils.ts`, `tiff-utils.ts` and `HANDOFF.md`. **The codec conflicts were resolved in favour of
the operator's decisions, not in favour of this branch** — see item 65. A second concurrent effort
(the responsive tranche, `e2087bf` onward) touched `App.tsx`, `DesktopHeader.tsx`,
`SidebarRight.tsx` and `FontSelect.tsx`, the same four files, and merged cleanly only because the
overlapping lines happened to differ. Two efforts on one file set is the normal failure mode here,
not a coincidence.

### Items 5, 7, 9, 13, 14, 18, 19, 21-29, 33-35, 37-42, 44 — deleted

These were open in the previous revision of this file and are fixed on this branch. They are deleted
rather than marked, per the lifecycle rule in this file's own header: verification was another agent,
an adversarial review, or a test, not the fixer's claim. Two of them are worth remembering for what
they _were_, because both were silent-corruption classes rather than visible breakage:

- **Item 18** and **item 19** turned a dropped runtime publication from a `console.debug` into an
  `error` that names the invariant, and deleted a dead `saveLayerCanvas`.
- **Item 7** was the dangerous one. The presentation scope owned only the rasters the store
  materialised, so an imported, merged or document-imported raster had no owner at all — and
  `ADOPT_LAYER_BITMAPS` had to come with the _other_ half, because a raster adopted for a merge is
  named by `layer.bitmap`, by the `source` object stored verbatim on the layer, and by the
  `layerSource`/`args` reference a history entry retains. Retiring on `layer.bitmap` alone closed a
  bitmap `history-replay` was about to read. Item 63 is the invariant that fix still leans on.

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

## Known defects that are PINNED — do not "fix" them casually

An `it.fails(...)` is a tripwire: it passes today and **fails the moment the defect is fixed**, so a
fix must remove the pin in the same change. There are 33, counted as `it.fails(...)` blocks:
`grep -rn 'it.fails(' src e2e` returns 33 and every one is in `src/`. (Re-derive the count rather than
trusting it — it moves as pins land, and it was already one high when this line was last written.)
The migration-relevant ones:

| Location                                          | What it pins                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `materialization.ordering.test.ts:415`            | interleaved affine/filter grouping (§2)                                                                                                                                                                                                                                                                                                                                                                |
| `StoreContext.durable-boundary.test.tsx:441`      | `REPLACE_DOCUMENT` retains the prior frame crop                                                                                                                                                                                                                                                                                                                                                        |
| `useSelectionClipboard.layerViaCopy.test.tsx:203` | canvas→document position translation. **Its diagnosis is stale**: it blames a `documentToCanvasPos` call at `useSelectionClipboard.ts:100` that now calls `canvasToDocumentPos` (correct). The expectation matches neither the correct value nor the described bug. The polygon `points` array is still never frame-converted — a real unfixed clipboard bug under the plan's own coordinate contract. |
| `text.test.ts:282`                                | replaying text from a durable vector source without re-rasterizing                                                                                                                                                                                                                                                                                                                                     |

One more pin is **not** an `it.fails` and is listed here so it is not mistaken for a count member:
`StoreContext.durable-boundary.test.tsx:573` is a plain `it` that asserts the durable cutover surface
is **absent** (item 1). It is a pin in the same sense — it fails the moment the cutover lands — but
it is an ordinary passing test, so it must be rewritten rather than removed when item 1 is done.

Three more are plain `it` blocks in one `describe`, and they are **KNOWN-GAP** pins: each asserts
the CURRENT behaviour of a publication precondition the boundary does not have, so each goes **red
the moment its defect is fixed**. The fix must re-point or delete its pin in the same change, and
the pin must never be relaxed to keep the suite green.

| Location                      | What it pins                                                      |
| ----------------------------- | ----------------------------------------------------------------- |
| `history-append.test.ts:1182` | §86 — publication onto a base that is not at its own tip          |
| `history-append.test.ts:1221` | §87 — a planned frame's `next` is never re-validated              |
| `history-append.test.ts:1300` | §17 — uniqueness is checked against the legacy list, not the base |

The e2e suite pins nothing. `grep -rn 'it.fails(' e2e` returns 0, there is no `test.fixme` and no
`describe.skip`, and the only skips are the two `test.skip` declarations
(`e2e/export/photopea.spec.ts:12`, `e2e/sidebar-flyout.spec.ts:171`). So a failure on the default
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

## 45. The AVIF encoder enforces the raster budget on save, and the codecs' ceilings still disagree

**What is fixed.** `encodeAvif` (`avif-utils.ts:33`) called the codec on an unbounded canvas while
`loadAvifFile` (`:21`) refused anything over `MAX_AVIF_PIXELS`, so `New ▸ A3 @ 1200 dpi` followed by
`Save as AVIF` wrote a file this build then refused to reopen. Both sides now share one
`assertPixelBudget(width, height, 'open' | 'save')` (`:15`), called on the encode path at `:38`
before the pixels are read, on the same rationale `tiff-utils.ts:168-174` already uses for TIFF:
whatever this build writes it has to be able to read back. Pinned by three new cases in
`src/contexts/__tests__/avif-utils.test.ts` plus the pre-existing load-side pin — over-budget
rejection, the guard running before `getImageData`, the exact-budget boundary (`10000 × 8000`
encodes, `10000 × 8001` does not), and the load-side string preserved byte for byte. The stale
`NewImageDialog.tsx:77-78` / `:158` / `:178` citation in `tiff-utils.ts:8-9` names the dialog's
clamps, which are at `NewImageDialog.tsx:111-112` (a preset is chosen) and `:144-145` (the DPI
changes), with `max="10000"` on the two inputs at `:198` and `:217`.

**Remaining verification — a ceiling decision that belongs to the operator, not to a fix branch.**
Three numbers still disagree, and enforcing the budget on the encoder made the disagreement a
capability loss rather than a latent trap:

| ceiling                             | value       | where                                                |
| ----------------------------------- | ----------- | ---------------------------------------------------- |
| largest document the app can create | 100,000,000 | `tiff-utils.ts:13` (`MAX_CREATABLE_DOCUMENT_PIXELS`) |
| AVIF, open and save                 | 80,000,000  | `avif-utils.ts:13`                                   |
| TIFF, open and save                 | 200,000,000 | `tiff-utils.ts:24`                                   |

So a document between 80 MP and 100 MP **cannot be saved as AVIF at all** — `saveImageToDisk` throws
with the budget message, and `useFile.tsx:118-136` catches it, logs it and resolves `null`. Before the
guard it saved and then failed to reopen, which is the worse failure, so the change is right; the cost
is real and the number was not chosen by whoever added the guard.

**Decided 2026-09-28: the 80 MP ceiling stands.** The operator was asked to choose between raising
`MAX_AVIF_PIXELS` to TIFF's `MAX_CREATABLE_DOCUMENT_PIXELS` derivation and accepting the export loss,
and chose to keep 80 MP. So **New ▸ A3 @ 1200 dpi is not AVIF-exportable in this build, by
decision** — do not "fix" that by raising the number without asking again. The remaining work on this
entry is the other-format gap below, not the ceiling.

**The rule that must survive.** Above a ceiling the file is **rejected with an error, never clamped
or downscaled**: a clamp silently hands the user a smaller image than the one they opened, and a
rejected file loses nothing. The TIFF byte ceiling also has a recorded provenance worth keeping —
`MAX_TIFF_BYTES` is the app's largest creatable document at 16 bytes per pixel, the largest buffer
`UTIF.decodeImage` can build for a 4-sample page (`Math.min(32, t258[0])` bits per sample,
`UTIF.js:116`, times 4 samples) — and `MAX_TIFF_PIXELS` is that same budget read at 8 bytes per
pixel, so the two agree by construction rather than by coincidence. That derivation is what makes a
different number defensible if the ceiling is ever revisited.

**Also unfixed, and the same drift, larger than item 45 first claimed.** Four ceilings exist and two
are below what the dialog can create:

| ceiling                             | value       | where                                                |
| ----------------------------------- | ----------- | ---------------------------------------------------- |
| largest document the app can create | 100,000,000 | `tiff-utils.ts:13` (`MAX_CREATABLE_DOCUMENT_PIXELS`) |
| affine transform                    | 67,108,864  | `affine-transform.ts:34`                             |
| PSD                                 | 67,108,864  | `psd-utils.ts:36`                                    |
| AVIF, open and save                 | 80,000,000  | `avif-utils.ts:13`                                   |
| TIFF, open and save                 | 200,000,000 | `tiff-utils.ts:12-24`                                |

The two 64 MP constants are the same number written twice, independently, in files that do not
import each other. A 100 MP document can be saved as BMP, GIF, SVG and TIFF, but not as AVIF and not
as PSD — and the PSD cap is recorded nowhere. "One exported `MAX_RASTER_PIXELS`" would have to
reconcile **four** constants, not one.

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

**Files.** `src/contexts/avif-utils.ts`, `src/contexts/tiff-utils.ts:8-9,73-104,176`,
`src/contexts/bmp-utils.ts:45-47`, `src/contexts/gif-utils.ts:10-16`, `src/contexts/ico-utils.ts:18-23,84-85,113-118`,
`src/contexts/__tests__/avif-utils.test.ts`, `src/contexts/image-load-save-utils.ts:150-172`,
`src/contexts/affine-transform.ts:34`, `src/contexts/psd-utils.ts:36`

**Files.** `src/contexts/avif-utils.ts`, `src/contexts/tiff-utils.ts:8-9`,
`src/contexts/__tests__/avif-utils.test.ts`, `src/contexts/image-load-save-utils.ts:150-172`

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

## 48. The eraser is hard-edged by construction, and three of Photoshop's controls are therefore dead

**Problem.** Photoshop's Eraser options bar offers `Mode` (Brush / Pencil / Block), `Size`,
`Opacity`, `Flow`, `Airbrush`, a Pressure control and `Erase to History`. This build renders four of
them, so the bar is two-thirds Photoshop-shaped. Of the three it cannot honour, two are rendered
`disabled` and one is **absent entirely**: `Brush` mode
(`src/components/ToolbarsRight/Eraser/Eraser.tsx:56`) and `Flow` (`:96-110`) are `disabled`, while
`Airbrush` has no DOM node at all — `grep -rni airbrush src` matches nothing under
`src/components/ToolbarsRight/Eraser/`, and its remaining hits are the tool-description prose that
records the control as missing (`src/tools/descriptions/paint.ts:53-57`), a comment in
`src/util/draw.ts:164`, and the Paint toolbar's own test. So a reader counting dead controls from
this bar will over-count the `disabled` ones by one.

**Why it is not a wiring bug.** The painter issues exactly one `beginPath`, one
`moveTo` and one `stroke()` per stroke (`src/util/draw.ts:151-154`; `drawLine` picks the renderer
at `:99-103`, and the call-count pins are `src/tools/__tests__/paint-tools.test.ts:226,228`). A canvas
`stroke()` has no falloff, so the result is always hard-edged, and it has no dab
loop, so there is nothing for a per-dab alpha ramp (Flow) or a build-up
accumulator (Airbrush) to vary. `Flow` therefore renders disabled rather than
changing a readout, and the seeded `EraserMode` is `'pencil'`
(`src/tools/settings.ts:183`; the type itself is `src/tools/eraser.ts:16`) rather than Photoshop's
`Brush`, because offering
`Brush` as a selected value would ship a mode that silently renders as Pencil.

**Fix.** Replace the single-path stroke with a stamp loop: build a tip bitmap
(falloff from Hardness, affine from Angle/Roundness), walk the path by `Spacing`,
and composite each dab with Flow accumulating into a per-stroke buffer. Do it in a
new module beside `src/util/draw.ts` rather than inside `drawPen`, and leave the
legacy `draw` path calling `drawPen` unchanged.

**Tripwires that must be removed in the same change, not weakened.**
`src/tools/__tests__/paint-tools.test.ts:226,228` pin `beginPath` called exactly
once and `stroke()` called exactly once for a brush or pencil stroke, and `:405`
pins `createRadialGradient` once per sample on the spray path. A stamp loop for
the eraser family fails the first two only if the pins are extended to the eraser
rather than rewritten; scope them by tool name so the legacy `draw` pins survive.
`e2e/export/visual-regression.spec.ts` baselines were recorded through `draw` and
are unaffected as long as `draw` is left alone.

**Files.** `src/components/ToolbarsRight/Eraser/Eraser.tsx:56,96-110`,
`src/tools/eraser.ts:16`, `src/tools/settings.ts:183`, `src/util/draw.ts:151-154`,
`src/tools/__tests__/paint-tools.test.ts:226,228,405`

---

## 49. The bucket and the magic eraser leave a hard edge, because the mask is a threshold

**Problem.** Both `Anti-aliased` (bucket) and `Anti-aliased` (magic eraser) are
rendered `disabled` (`src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:19,79`).
A fill or an erase that ends on a one-pixel stair-step is visibly wrong on a
photograph, and Photoshop feathers it.

**Why it is not a wiring bug.** `createFloodFillMask` returns a `Uint8Array` of
`0`/`1` (`src/util/floodFill.ts`), and a boolean mask cannot carry a coverage
fraction. The boundary test in that module is a single `distance <= tolerance`
comparison, so the pixel is either in or out.

**Fix.** Return partial coverage instead of a byte: for each masked-boundary
pixel, compute a coverage value in `[0,1]` from how far its neighbour exceeded the
threshold, and store it in a `Uint8ClampedArray` alongside the mask. The canonical
treatment is a ramp of `1.5 - (distance / tolerance)` clamped to `[0,1]`. Then
`fillLayer` (`src/tools/fill.ts:95`) multiplies its write alpha by that coverage,
and the existing `alpha` (Opacity) term composes with it. The magic eraser needs
the same, on the subtraction side.

**Note.** The module is new, so this is additive and no test pins the current
behaviour — the disabled control is the only place it is recorded, which is the
point of the entry.

**Files.** `src/util/floodFill.ts`, `src/tools/fill.ts:95`,
`src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:19,79`

---

## 50. The bucket has no blend mode

**Problem.** Photoshop's Paint Bucket `Mode` is a full blend-mode list. It is not
rendered here at all, so a bucket fill always composites `source-over`. The
`Fill` control that does exist (`src/components/ToolbarsRight/MagicEraser/PaintBucket.tsx:46-57`)
offers `Foreground` enabled and `Pattern` disabled, which is correct and complete
for what the app supports — the gap is the blend mode, not the fill source.

**The seam this entry used to be blocked on has landed.** The eight-tool tranche
brought `toolLayerBlendMode` into `src/contexts/layer-utils.ts`, so an options-bar
`Mode` now reaches a committed layer for the paint tools. There is one seam and it
is in `main`, which removes the two-seams hazard this entry previously described.
`ps/brush-engine` and `ps-tools-spine` also carry a copy of that seam; they are now
redundant with `main` and should be dropped rather than merged.

**What remains.** The gate (`src/contexts/layer-utils.ts:148`) is deliberately scoped to `brush`,
`pencil` and
`color-replacement`, so `paint-bucket` is still excluded and its fill composites
Normal. Widening the gate is a one-line change, but it needs the blend control
added to the shared fill bar first, and the gate is load-bearing: it exists so a
stray `blendMode` key on a text or shape args object cannot decide how that layer
composites. Widening it to every tool name would silently let that happen.

**Files.** `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx`,
`src/contexts/layer-utils.ts:146-153,230`

---

## 51. The eyedropper reads the composite for itself: no per-layer sampling, no ring, no Color Sampler

**Problem.** The eyedropper's `Sample All Layers` renders `disabled`
(`src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:38`) and
`sampleAllLayers: true` in the args is refused with a named error rather than
silently ignored (`src/components/Main/EyedropperToolArea.tsx:64`). Photoshop's
`Sample` dropdown has five values (Current Layer, Current & Below, All Layers, and
the two No-Adjustments variants) and its `Show Sampling Ring` is a cursor. The
Color Sampler Tool — numbered annotations in the Info panel — is absent entirely,
as are Ruler, Note and Count.

**Why it is not a wiring bug.** `sampleAllLayers` needs a composite read that
excludes adjustment-layer corrections, which means reading layers individually and
applying their blend modes and adjustments — a render pipeline the tool does not
have. The ring is a cursor, and `SidebarLeft` has no cursor registry.

**Fix.** For the dropdown, add the layer-iteration read in the same place the
composited read already happens (`EyedropperToolArea.tsx`), iterating
`store.layers` in order and honouring each layer's `blendMode` — which is the same
walk `drawLayersToCanvas` performs, so extract rather than duplicate it. The
ring and the Color Sampler are overlay work and belong with the navigation cluster
(item 52), not here.

**Files.** `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:38`,
`src/components/Main/EyedropperToolArea.tsx:64`,
`src/components/SidebarLeft/SidebarLeft.tsx`

---

## 52. Hand, Zoom and Rotate View are absent because the view transform is commented out

**Problem.** Three of Photoshop's twenty toolbar slots have no implementation, and
the placeholder is a commented-out JSX line: `src/components/SidebarLeft/SidebarLeft.tsx:690`
is `{/*<Zoom />*/}`.

**Why it is not a wiring bug.** There is no view transform to wire. The store's
zoom data is entirely commented out — `src/contexts/StoreContext.tsx:1166-1172` is
`// const zoomDataRef = useRef<ZoomData>({ dx: 0, dy: 0, zoom: 1 });` and the rest
of that block — and `usePointerPosition` maps client coordinates to image pixels
through a `scale` supplied by the host rather than owning a view transform itself.
`Main.tsx:61` initialises `interactionMode = 'zoom'` and nothing ever sets it to
that string, so the name is currently a dead default rather than a feature.

**Fix.** Decide whether the canvas has a view transform at all, because three
different features want one and it should be one: pan/zoom, the space-drag
temporary-pan behaviour every tool inherits, and the tool cursors that must track
the view (a brush tip circle is a screen-space circle). A `DocumentViewScope`
owning `{ dx, dy, zoom }`, with `usePointerPosition` and every pointer-to-image
conversion reading from it, is the shape the commented-out code was reaching for.
Do not start with a Hand tool; start with the scope, and the three tools fall out.

**Files.** `src/components/SidebarLeft/SidebarLeft.tsx:690`,
`src/contexts/StoreContext.tsx:1166-1172`, `src/hooks/usePointerPosition.ts`,
`src/components/Main/Main.tsx:61`

---

## 53. Six selectable tools do nothing at all, and the honest fix is five lines

**Problem.** `pen`, `freeform-pen`, `curvature-pen`, `add-anchor-point`,
`delete-anchor-point`, `convert-point` and `custom-shape` are all in `toolbar-mapping.ts`'s
`availableTools` (`:123-134`) and all render a button. Each is
`commit: 'unimplemented'` with `imageProcessor: unimplemented`
(`src/tools/toolProcessors.ts:300` for `pen`, `:331-335` for `custom-shape`), and the
processor returns `[null]`. Each has no `interactionMode` arm in
`src/components/Main/Main.tsx`, so each falls through to `else EventHandler =
DummyToolArea` (`:226`) — a `display: none` div with no handlers. **They do not
consume a history entry**, which is the thing an earlier inventory of this repo
got wrong and which is worth stating because it changes the severity: the defect
is a dead button, not a corrupted document.

**Why it is not a wiring bug.** These are the pen family and custom shapes, and
they need a bezier path model with subpaths and holes, a fill rule, and a CPU
scanline rasterizer because boolean path operations cannot go through `Path2D`.
That is a phase of work, not a wiring fix.

**Fix — needs a call, not a patch.** Two honest options, and the choice is the
operator's. Either hide the six from `toolbarMap` until they work, or make
`unimplemented` throw a named error at `toolProcessors.ts:110` so selecting one
fails loudly instead of silently doing nothing. Throwing is the smaller diff and
converts a silent no-op into a visible one, but it changes seven existing tools'
behaviour, which is a product decision rather than a cleanup. Whatever is chosen,
do it before the next tool tranche: every new tool inherits the same silent
failure, and the four added here would have shipped the same way had the spine
agent not checked `Main.tsx:61`.

**Files.** `src/tools/toolProcessors.ts:110,300,331-335`,
`src/components/Main/Main.tsx:61,226`, `toolbar-mapping.ts:123-134`

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
whitelist, so the entry never gets a durable translation. `history-replay.ts:146`
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
- `src/contexts/history-replay.ts:112-121` — the legacy arm beside the
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
`src/contexts/history-replay.ts:112,146`, `src/contexts/useHistory.ts:14,22`,
`src/contexts/psd-utils.ts:159,229`

## 57. The mobile shell has no colour control at all

**Problem.** The desktop rail carries the foreground and background swatches, a swap
and two native colour inputs (`src/components/SidebarLeft/SidebarLeft.tsx:1080-1097,1098-1113`).
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

**Files.** `src/components/SidebarLeft/SidebarLeft.tsx:1080-1097,1098-1113`,
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

## 59. Three selection tools claim `creator: true` and cannot create anything

**Problem.** `materializeLayer` trusts the `creator` flag as its only gate
(`materialization.ts:167-168`). All three `commit: 'selection'` entries claim it —
`polygonal-lasso` (`toolProcessors.ts:167-173`), `freehand-lasso` (`:174-180`) and
`rectangular-selection` (`:193-199`) — and all three processors are pass-throughs over a `bitmap`
that is `undefined` on a creator call:

```ts
export const rectangularSelection =
  ({ bitmap }: ProcessorToolParams) =>
  () => [bitmap];
```

- `rectangular-selection` → `[undefined]`, caught by `if (!created) throw` (`:172`), message blames
  the tool.
- `polygonal-lasso` / `freehand-lasso` with empty `points` → `copyPolygonToCanvas` returns a **1×1
  canvas**, which is truthy, so the guard **accepts it** and the layer silently materializes blank.
  With non-empty points it throws an unrelated `SelectionCanvasContextError`.

**Why this is a landmine rather than a typo.** The flag is currently unreachable from production
precisely _because_ item 58's throw fires first. So the lie is invisible today and becomes live the
moment item 58 or item 1 is fixed — which makes it a trap laid for whoever does that work.

**Fix.** Drop `creator: true` from all three. They are `commit: 'selection'` mutators, not creators.
Every genuine creator was checked and honours its curried `params.size`; a repo-wide grep for
`Math.random|Date.now|new Date(|performance.now|crypto.` across `src/tools/` returns **zero**, so the
flag is a sound determinism signal wherever it is honestly set.

**Test that fails without the fix.** For every entry claiming `creator: true`, call
`imageProcessor({ size: { width: 8, height: 8 } })(args)` and assert a returned bitmap with finite
`width`/`height` ≥ 1. Fails today for the two lasso tools.

**Files.** `src/tools/toolProcessors.ts:167-199`, `src/tools/selection.ts:15-19`,
`src/tools/rectangularSelection.ts:9-13`, `src/contexts/materialization.ts:167-172`

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

## 62. The error boundary's fallback is auto-placed, not placed where the region was

`ErrorBoundary`'s fallback renders a bare `div` with no `grid-area`, while the regions it replaces
are `[grid-area:main]` (`Main.tsx`) and `[grid-area:right]` (`SidebarRight.tsx`). On the error path
the fallback is auto-placed into the first free grid cell — the `toolbar` row — so a crash in the
canvas puts the message under the toolbar instead of in the canvas's cell.

It cannot be fixed from `ErrorBoundary.tsx`: its props are a human-readable `label` and the
`children` it has already replaced, so it does not know which region it wrapped. It needs a new
optional `gridArea` prop **plus** the two `App.tsx` call sites. Do not add the prop without them — an
always-`undefined` prop is worse than the current honest auto-placement.

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

## 65. Two codec budgets were decided in different sessions, and one decision was discarded

Recorded because it is a process fact, not a defect, and because the losing side is a plausible
proposal someone will make again. Item 45's original fix on this branch raised the AVIF ceiling to a
shared 200 MP derived from the New Image dialog's clamp, in a new `src/contexts/raster-budget.ts`
that both codecs imported. The operator had separately decided to **keep** 80 MP and to accept that
`New ▸ A3 @ 1200 dpi` is not exportable as AVIF. The rebase resolved the codec conflicts in favour
of that decision: `raster-budget.ts` and its test were deleted, and `avif-utils.ts`,
`tiff-utils.ts` and `avif-utils.test.ts` kept `main`'s version. **The ceiling stays at 80 MP. Do not
raise it to "fix" item 45** — item 45's remaining work is BMP, GIF, ICO and SVG, which have no
budget on either side.

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

## 68. A committed shape is painted twice, and its preview and its commit use different coordinate spaces

**Problem.** `src/components/Main/ShapeToolArea.tsx` never clears the tool overlay during a gesture,
not even on a successful commit. `handlePointerUp` (`:140`) ends with a `flushDrawingFrame()`
(`:174`) that redraws the shape, and `createLayerFromTool(fullArgs)` (`:200`) then commits it as a
layer while the overlay keeps the painted shape. For as long as the shape tool stays selected the
same shape exists twice: once in the document, once on the overlay above it. Unmount now clears it,
so it disappears on a tool switch, which is not the same thing as not painting it.

**The second half is the one that will bite a test.** `flushDrawingFrame` (`:70`) draws in CANVAS
coordinates, while `handlePointerUp` translates the commit into DOCUMENT coordinates. Under a
non-zero `documentFrame` the two can disagree, so the preview the user watches and the layer that
lands are not necessarily in the same place. Every `ShapeToolArea` test runs with
`documentFrame: null`, so nothing in the suite covers it.

**Fix.** Clear the overlay as part of the commit, so the committed layer is the only copy; and draw
the preview in the same space the commit uses, or convert the preview's geometry before drawing.

**Files.** `src/components/Main/ShapeToolArea.tsx:70,140,174,200`

---

## 69. An eraser gesture abandoned by switching tools leaves its preview on the layer, with no history entry

**Problem.** `EraserToolArea` previews through `tempUpdateLayer`, the sanctioned live-pixel writer,
rather than the shared overlay — deliberately, and for a documented reason
(`src/components/Main/EraserToolArea.tsx:20-31`): the overlay starts every frame empty and
transparent, and `destination-out` computes `da' = da * (1 - sa)`, so with `da = 0` an overlay
preview is arithmetically incapable of drawing a pixel. The consequence is that the preview IS the
document. If the gesture is abandoned by switching tools mid-drag, the partial erase is left on the
layer's pixels and no `TOOL_ACTION` is ever dispatched, so there is no history entry to undo. The
same applies to any tool that previews by mutating the active layer.

**Fix.** Roll the live pixels back on an abandoned gesture. That needs a pre-gesture pixel snapshot
to restore from, which is a materially larger change than an overlay clear and should be decided
deliberately rather than bolted on.

**EraserToolArea owns no overlay canvas** — its props are `{ className?: string }`
(`src/components/Main/EraserToolArea.tsx:11-13`); it ignores the `overlayCtxRef` that `Main.tsx`
passes. The overlay-teardown fix deliberately leaves it alone, because clearing there would be
clearing a canvas this area never painted.

**Files.** `src/components/Main/EraserToolArea.tsx:11-13,20-31`

---

## 70. A tool whose settings do not fit a shared arm must not be in that arm

`src/util/settings.ts:64-82`

`color-replacement` was persisted by the bare-`{ toolName }` group further down the same
function, which writes no settings at all. It therefore had a real options bar whose
Tolerance, Limits and Sampling controls existed nowhere: the sliders the user could see were
not the settings the tool read, and `defaultSettings` was the whole of its state. It now has
its own typed arm, which persists its controls and omits `points` and `sampleColor` on the
precedent the draw and fill arms set.

**The rule this establishes, because the bug was a silent data loss rather than a crash:** a
group that persists one key may not absorb a tool that has more than one. The two `else if`
arms are now mutually exclusive, and a third tool needing real settings must get a third arm
rather than being added to either. The visible symptom — a bar full of controls that change
nothing — reads as a UI bug and is actually a persistence bug, so it is worth checking
`src/util/settings.ts` before checking the component.

---

## 71. A clean merge is not a correct one

`src/tools/settings.ts:164-181`

`defaultSettings['color-replacement']` acquired `smoothing` and `blendMode` by merge. Both
belong to the paint panel, this file merged **without a single conflict marker**, and the
result was wrong: the entry was typed against `ColorReplacementToolArgs`, which has neither
key, and the only thing that noticed was the `satisfies` excess-property check.

**That is the whole content of this item.** A textual merge reports what it reconciled, which
is not the same question as whether the result is right, and the two answers diverged here
with no marker, no warning and a green `tsc` had the `satisfies` not been there. Both keys
are now gone and their absence is documented in place rather than left as an omission, so a
later merge that reintroduces them has something to contradict.

The defence is the `satisfies` clause on every `defaultSettings` entry, and it is the reason
to keep it: it is the only check standing between a merge and a defaults table that
compiles. **Keep it on every entry, and treat a defaults entry that typechecks against a type
it does not belong to as a merge bug, not a style question.**

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
deleted, not kept.** Separately: `SidebarLeft.tsx:54` does `toolbarMap.flat()`, which discards the
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
Row and Single Column Marquee (two lines of geometry reusing `rectangularSelection`), Sponge, Red
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

## 75. `git stash` is not just shared in this repo — an empty push makes `pop` a coin toss

**Do not use `git stash` in this repository. Use a worktree.** `AGENTS.md` already says the stash
lives in the common git dir and is therefore shared across every worktree; §194. What that does not
say is the part that actually bites, and it cost a real recovery this session.

`git stash push` **exits 0 and prints nothing when the working tree is clean**, and creates no
entry. The `pop` that follows is therefore not paired with the `push` that made it safe: it takes
`stash@{0}`, which belongs to whoever pushed last.

Measured here. A `git stash push -u -m "verify-baseline"` in the main worktree found nothing to
stash, so it silently did nothing. The `git stash pop` two commands later popped **another agent's**
stash — `fix/flyout-longpress-race`, left on `e2e/helpers/toolbar-helpers.ts` — into the main
worktree, where it conflicted, and left the shared checkout in a merge-conflict state that another
session could have walked into. `AGENTS.md` also says never to repair a conflict in the main
worktree, and the cheapest correct repair here was `git reset --hard HEAD`, which is safe **only**
because `git status --porcelain` showed exactly one path, the conflicted one. That check is the
reason the recovery was one command instead of an archaeology project, and it is not a check to
skip.

**The work was not lost**, and that is worth stating precisely rather than as reassurance. The
stashed file was already committed at `07c1cf1`; `git diff stash@{0} 07c1cf1 -- <file>` differs by
exactly one doc comment, and the committed version is the _better_ one — it names the element and
explains why a bare line number rots. The stash entry was intact afterwards and the owning
worktree was clean. Had it not been committed, the entry itself would still have been recoverable,
because a conflicted `pop` does not drop the entry.

**The general rule, and the part worth not generalising from the happy ending:** a stash is a
_shared, unordered stack_, and a `pop` is a **destructive operation on another session's work**.
`git stash list` is global, so its top entry is not yours by default. If a worktree needs to be set
aside, create a worktree or a branch — that costs one command and holds nothing but your own files.
The escape hatch remains `HUSKY=0 git commit`; there is no reason in this repository that reaches
for a stash at all.

**What the operator asked for on top of this**: a standing rule in `AGENTS.md` that `git stash` is
not to be used here, because it is shared. That edit is **not landed** — `AGENTS.md` is held by
`audit/chat-audit` with a live lease, and `npm run swarm -- hold AGENTS.md` is correctly refused
while it is. The rule is recorded here until the hold clears, and the AGENTS.md paragraph should
be folded into the existing "Worktrees and dev servers" section at §194 rather than added as a
new section, because the failure is an intensification of what that section already says.

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

This is the same shape as §0's standing note about stale citations, one layer up: there, a citation
moved and still read plausibly; here, a _verdict_ moved and was credited to the wrong commit. A
plausible reading is not evidence of when it became true.

## 77. `## 15a.` yields no item, and a suffixed retirement retires its PARENT

`scripts/lib/agent-board/handoff-import.mjs` — `NUMBERED`

Found while fixing §70's defect, and deliberately **not** fixed with it. The end-anchored
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
(`SidebarLeft.tsx:539`), so the user is told the Draw Tool answers to `B`; and
`AppKeyboardShortcuts.tsx:18` puts `b` on `brushGroup = ['brush','pencil','color-replacement','eraser']`,
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
which line 203 then **advances** to the current pointer position, and it is applied to
`drag.baseline`, which **never** advances. The running displacement is therefore the last frame's
delta alone, and every earlier frame is discarded. Take a selection 60px right and 40px down,
retract the pointer to the point you pressed from, and release: the commit lands the selection at
`(-60, -40)` on a document that starts at the origin. One frame's worth of history, applied twice,
in opposite directions — and the preview overlay shows the same wrong position for the whole
gesture, because `drag.preview` feeds `redrawOverlay` at `:205-207`.

The fix is already written elsewhere in the same directory. `PolygonClickToolArea.tsx:817-819`
applies the same delta to `selectionDrag.selection` and advances **both** accumulators into the
next ref record in one statement; that is the correct shape and it is what line 202 should be.
`moveSelectionByDelta(drag.preview, delta)` puts this arm on the same footing, and the first
frame needs no special case because `drag.preview` is already seeded with `activeSelection` at
`:161`. The release gate at `:222` then does the rest for free: a net displacement of zero lands
the preview back on the baseline's own geometry, `hasSameSelectionGeometry` reports them equal,
and the gesture commits nothing.

**Why nothing saw it, and why that is a gap rather than a blessing.** Every move-drag case in
`EllipticalSelectionToolArea.test.tsx` issued exactly one `pointerMove`, and with a single frame
the last delta _is_ the whole delta — so `moveSelectionByDelta(baseline, delta)` and
`moveSelectionByDelta(preview, delta)` return the same selection. The suite was blind to the
difference by construction rather than by accident. Verified by mutation: changing line 202 to
`drag.preview` leaves all five pre-existing cases green.

The half of that which was sound: no assertion in the file pins the drifted position, so nothing
enshrines the bug. It was uncovered, not endorsed — and it was recorded in no handoff entry while
a suite named for this component sat beside it, so the next reader of that file would reasonably
conclude the move arm was covered.

Pinned as `it.fails` in `EllipticalSelectionToolArea.test.tsx`, "commits nothing for a move drag
that went out and came back to the press point". A zero net displacement is observed through the
absence of a commit rather than through a committed position, which is the same observable the
neighbouring zero-delta case pins for the one-frame shape of the same gesture; the case carries
its own control — a second, single-frame drag on the same mount, which is independent of the
defect — so the empty assertion cannot pass by the arm never having run. **Delete the `it.fails`
in the same change that fixes line 202**, per `AGENTS.md`: it is a tripwire for broken behaviour,
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

## 84. A review of §83 found four defects, and three of them are the same shape: a test that could not fail

A hostile review of `feat/panel-docks` found four blockers. Each is a trap worth writing down
because the tests either pinned the defect or could not see it.

**1. A stored dock width below the label floor is a one-way door, and the persistence guard let it
through.** `readStoredLayout` clamped `dockWidth` to `[40, 640]` and never reconciled it with
`isCollapsed`, so a stored `{"dockWidth":45,"isCollapsed":false}` produced a 45px column with both
panel groups, their labels, and a control reading "Collapse panels to icons" — on a dock already
under the floor. With `isCollapsed: true` it was worse: the icon strip's only expand control calls
`setDockWidth(layout.dockWidth)`, which re-collapses on a width that is still under the floor, and
the double-arrow is not rendered while collapsed, so `Window > Reset Workspace` was the only way out.
Only a hand-edited, stale or cross-version record reaches it — which is exactly the threat model
`readStoredLayout` documents itself as defending against, and the test that "covered" it only used
`99_999`, which `[40, 640]` happens to catch. The read path now collapses on the same rule
`setDockWidth` uses, and remembers the label floor so the dock is recoverable. **The general
shape: a clamp and an invariant are different things, and a guard that only clamps has not
enforced the invariant.**

**2. Two of the half-parts of the width state were measured, and the drag read the wrong one.** The
resize handle is rendered on the collapsed 40px strip too, and `onColumnResizeStart` recorded
`layout.dockWidth` — the width to come _back_ to (250) — rather than `effectiveDockWidth`, the 40
on screen. One pixel of movement opened a 250px dock and overwrote the 250 with 251: a 211px jump,
and the user's chosen width gone. Cancelling that drag called `setDockWidth(250)`, which
_un-collapses_, so Escape changed the value rather than restoring it. Neither the e2e nor the unit
test dragged the handle while collapsed. **A drag has to be measured from what is on screen.**

**3. The cancel flag was dropped one layer down, so Escape committed the gesture.** `useDockDrag`
reports `onEnd(cancelled)`, and `PanelGroup` passed it through as `onDragEnd()` with the argument
discarded — so an Escape on a tab drag reordered the panels anyway, and a cancelled resize left the
column wherever the last `pointermove` put it. The flag is now plumbed through, a cancelled drag
clears its preview state without committing, and a cancelled resize is restored to where the
divider started.

**4. The cursor lock was shared and unguarded.** The grabbing cursor and the selection lock live on
`document.body`, because they have to survive the pointer leaving the handle. The guard against two
gestures at once is _per hook instance_, so a second finger on a second handle started a second
gesture that had not taken the lock — and the first one to end took it away from the one still
running. Counting is now at module scope.

**Three tests in the same change could not fail, and each is a shape worth recognising:**

- `expect(Number.isNaN(parseFloat(style.flex))).toBe(false)` — true of every string `flex` can
  hold, and of a divider drag that did nothing. The replacement reads the grow factor back and
  asserts the share moved by the dragged fraction.
- `expect(top + (1 - top)).toBeCloseTo(1)` for a loop of ratios — an arithmetic identity. It holds
  for a no-op setter, an inverted one, and a clamp to the wrong bound.
- The flyout test asserted `left` to name which tile a menu belonged to. Horizontal placement
  became the rail's when `xAnchor` landed, so `left` is now identical for every group and the
  assertion passed for the _previous_ group as readily as the current one. It asserts `top` now.

**One claim in the code was false and a test was pinning it.** The module header said the resize
handle sat "half outside the column" at `left: -4px`, and the test asserted the aside's
`overflow: hidden` was therefore load-bearing. No rule ever set a negative offset: the handle is
`absolute` with `left-0`/`right-0` and lies wholly within the padding box, which the e2e
measurement says directly — 1px inside the 1px border. The clipping moved inward anyway, for a
different reason, and both the comment and the test now say what is actually true.

**`role="separator"` with `tabIndex={0}` and no `aria-value*` is a promise the control does not
keep.** A focusable separator is the window-splitter widget and must carry `aria-valuenow`/`min`/
`max` and answer arrow keys; these carried none and had no key handler, so a keyboard user could
Tab onto them and do nothing. Photoshop offers no keyboard path for resizing a dock either. The
handles are `aria-hidden` and not focusable, and the re-dock grip — a real `<button>` that
announced a button and activated nothing on Enter — got the one non-pointer action it can offer,
a swap. **A focus stop with no behaviour is worse than no focus stop: it costs a keyboard user a
tab press to learn nothing.**

That grip was dead for a MOUSE user too, and the reason is the one to remember: `onRailDragEnd`
only commits once `reDockTargetRef` is set, and that happens in `onRailDrag` — so a press with no
movement produced no drop target and no swap. "It needs a drag, so it is a drag control" is not
the same as "it is a control", and a `<button>` beside a sibling that works on click is read by
every user as clickable. A movement guard is also required in the other direction: a `<button>`
synthesises a click from any pointerdown+pointerup, including one that travelled to the opposite
edge, so an unguarded `onClick` swaps on the release and then swaps again on the click.

**`aria-controls` has to name an element that holds something.** It named an empty
`display: contents` div beside the real body, and while the group was rolled up the guarded render
removed the id and left the reference dangling — the same "a promise the control does not keep"
argument used to justify `aria-hidden` on the handles, applied to a control that was left
focusable. The body moved inside `PanelGroup` so the id and the element cannot drift apart.

**A module-scope counter is only correct if every writer shares it.** The first fix reference-
counted the grabbing cursor inside `useDockDrag` alone, while `LayersTab` — the layer-row
reorder, which predates it — still added and removed the same `document.body` class itself. A
layer drag that ended while a dock divider was still being dragged took the cursor and the
selection lock away from it, which is the defect the counter existed to fix, reintroduced through
the other door. The lock now lives in `src/hooks/dragCursorLock.ts` and both writers call it.

**And a counter can still leak, because an effect that never ran has no cleanup.** The lock was
released only from inside the listener effect, which is gated on `isDragging`. If the hook's owner
unmounted in the SAME batch that set `isDragging(true)` — which is what a gesture whose `onStart`
drops its own subtree does — that effect never registered, no cleanup existed, and the lock was
held for the rest of the session: a grabbing cursor, no text selection, and a count left one high
so every later gesture's lock short-circuited. A `[]`-deps effect whose cleanup finishes a live
gesture always has an unmount cleanup, which is the point of using one.

**The two docks are not keyboard-reachable at all**, and that is a real gap rather than a
non-issue: a rail or a dock cannot be moved with the keyboard, and nothing in `Window` lists the
panels. The honest cost of that is recorded here rather than hidden behind `aria-hidden`.

## 85. Two agents shipped overlapping features in two branches, and the conflict was the cheap part

**The defect.** On 2026-09-29 two root agents implemented the same surfaces in separate branches.
`feat/toolbar-overflow-collapse` (session "Implement collapsible left toolbar") and
`feat/panel-docks` (session "+++++ draggable Photoshop-like panels +++++") both rewrote
`src/components/SidebarLeft/SidebarLeft.tsx`, and both shipped a different answer to the same
unwritten question: what the tools rail does when it does not fit. The panel work landed first as
`1eb275a1`; the toolbar branch then merged `main` into itself as `e473a45f` and met **8 real
conflicts across 11 files** — 15 candidates, of which 6 merged cleanly.

**Why it is not a merge that could have been avoided.** `git range-diff` between the two branch
tips returns **every line `-` / `>`: zero corresponding commits**. Four panel commits against nine
toolbar commits, not one pair. These were not two attempts at one change; they were two different
changes to the same files, so a merge was the only available tool and the conflict volume was
intrinsic. The mistake was upstream of the merge — nothing stopped the second agent from choosing
the same surfaces — and it was made once, before a single line conflicted.

**The signal existed, on the board, twice, and was reasoned past.** The panel agent's first tool
call showed it the toolbar agent's live lock on `SidebarLeft.tsx`; its second, `swarm ready`, named
the same file as held. Its own recorded reasoning two minutes later was: _"Wait — `swarm check`
says free. But the ready listing earlier said `SidebarLeft.tsx — feat/toolbar-overflow-collapse ·
2m left`. That lease has now expired or been released. Let me be careful: I'll claim the files
before editing."_ It then asked the board the one question the board could answer — **is the lease
live?** — instead of the one that mattered, **is somebody working in this file right now?** A
45-minute lease had lapsed at 08:19:56 and the worktree was on disk and fully populated until
12:25:34, over four hours in which the branch was invisible to every other agent. `swarm check`
returned `free`, which is exactly what it is built to return.

**And the board has no axis for this.** Identity is the git branch and the lock test is
foreign-vs-self by agent id, so arbitration happens on **paths**, and only between agents the board
considers different. Two root sessions on two branches are correctly two agents; there is no second
axis on which "we are both working on the left rail" could be expressed. `issues.scope` is a `TEXT`
column defaulting to `'prod'`, read by one `list` filter and one display line and absent from
`ready`'s ranking — and the live pair proves it cannot work: `ph-66` is `--scope e2e`, `ph-72` is
`--scope prod`, so no `list --scope` returns both. `new`'s only dedup is `--origin`, so filing the
same feature twice creates two unrelated rows with no warning. The curated inventory knows what
each worktree is _for_, but only as prose written at land time — four hours too late — and the two
overlap records that exist are human `note` strings no code compares.

**The retrieval failure worth recording separately.** The toolbar agent DID run
`npm run swarm -- watch` — and piped it through a `grep` of its own keywords. The panel agent's
`note` ("starting feat/panel-docks: Photoshop-style draggable panel docks…") matched none of them,
so the one agent that could have learned of the overlap filtered the message out. **A log that must
be grepped is not a notification.**

**What a hard merge now costs.** `.skills/hard-merge.md` is the procedure. The parts of it that
exist because of this incident are: recover the requirements from the chat transcripts _before_
opening a diff (the operator's turn-3 "get ready to this (but dont implement it)" and the panel
agent's "must become draggable" are 28m59s apart and neither message mentions the other, so neither
transcript alone contains the collision); arbitrate against Adobe and the web platform rather than
against the hunk; and run four post-merge sweeps, because a clean merge is not a correct one.

**That last clause happened here.** `e473a45f` was flagged
`remerge CONFLICT: Merge conflict in AGENTS.md`, the commit landed, and the committed file still
carried **six** live marker lines — `<<<<<<< HEAD` at :57, `=======` at :759 and :1001, an
**indented** `<<<<<<<` at :848, and two space-separated `> > > > > > > main` label lines at :818
and :1003. They passed through three further commits before `ef85d3ab` repaired them. Neither
`--remerge-diff` nor `--cc` nor the existence of a merge commit catches a committed marker, and
`--cc` under-reports on the same merge in a way that is easy to misread as clean: it names 9 files
where `--remerge-diff` names 11, missing two genuine conflicts.

**The sweep that finds it took three attempts, and the third is the one that shipped.** The first,
`'^[[:space:]]*(<{7}|={7}|>)'`, finds only **3 of the 6** markers — it misses the indented one and
both space-separated `diff3` labels — and it fires **171 times** across that merge's own changed
files on ordinary `>` lines. A gate that reports clean files as broken teaches its reader to ignore
it, which is worse than no gate at all. The second was right about the pattern and wrong about the
input: it grepped the _working tree_, where `ef85d3ab` has since repaired those markers, so the
retrospective run found **zero** in the commit it was written to check. The third searches the
merge's own tree and reads a single `git grep` exit code:

```bash
git grep -nIE '^[[:space:]]*(<{7}|={7}|>([[:space:]]*>){6,})' <merge> -- \
  $(git diff --name-only --diff-filter=ACMR <merge>^1 <merge>)
```

A third trap lives in the `|| echo "clean"` that version carried: **`xargs` exits 123 when any of
its batches finds nothing**, so a pipeline over a dozen-plus files ends non-zero even when one
matched, and the `||` prints `clean` on the line below the marker it just printed.

**Test that fails without the fix.** None, and deliberately: this section records a process, not a
defect, and there is no assertion to add. The measurement that the sweep is not optional is that
same `git grep` on `e473a45f` — **exit 0**, naming all six markers — against `ef85d3ab` and against
`HANDOFF.md`, `AGENTS.md`, `docs/TESTING.md` and `e2e/OPEN_PROBLEMS.md` on `main`, where it returns
**exit 1**.

The class-5 detector the skill adds in the same phase earned its place immediately: comparing each
side's _newly added_ keys against the base and intersecting the two lists prints exactly one key
for this incident, `'toolbar-overflow':`, which the merged tree then holds once instead of twice.

**Files.** `.skills/hard-merge.md`, the `hard-merge-skill` entry in
`scripts/lib/worktree-inventory/curated.mjs`, and the skill registry rows in `AGENTS.md`. The
loader lives at `.kilo/skills/hard-merge/SKILL.md` and is gitignored, so it is not a durable copy.

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
diagnostic at all.

**Latent today.** No `ToolArgs` field is an array, so nothing in production builds the shape that
trips it. It matters for the **next** array-valued arg, which is why the asymmetry is a defect now
rather than a cleanup later: the array arm is the only place in the file where an ordinary
un-populated field is fatal, and the call sites are the ones that carry whole tool args —
`convertSource:165` and `operationForTool:449`, `:470` and `:500`.

**Fix.** Drop `undefined` elements in the array arm the way the object arm drops `undefined`
properties, and document that a sparse tool arg is normalised rather than rejected. If a future arg
genuinely must not be sparse, that is a per-arg rule with a named error, not a property of the
value copier.

**Files.** `src/contexts/history-adapter.ts`

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
  transition (`src/contexts/StoreContext.tsx:510-515`), and `history-replay.ts:180` rebuilds
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

## 96. `docs/LAYERS-PANEL.md` §20 item 6 undercounts a filename defect, by line numbers that no longer point at it

`docs/LAYERS-PANEL.md:825-835` reports the hyphen form `e2e/OPEN-PROBLEMS.md` is "written in
**only two files, five lines**: `AGENTS.md:15`, `:165`, `:172` and `TEST-FLAKES.md:391`, `:657`",
and argues from `AGENTS.md:170-173` that the typo "has no home among the three routed files". The
census is four, the cited lines have drifted, and the "no home" premise is false.

**Verified against `c23d036e` by re-deriving, tree-wide — not by reading the cited lines.** The
ref is pinned on purpose: `main` moves, and an auditor re-running a bare `main` gets lines that
have drifted. Once this entry lands, re-run excluding it — it quotes the occurrences, and
`git grep <ref> -- .` prefixes every line with the ref, so the filter has to match the prefix:

```
$ git grep -n 'e2e/OPEN-PROBLEMS' c23d036e -- . | grep -vE '^c23d036e:HANDOFF\.md:29'
c23d036e:AGENTS.md:15:| `HANDOFF.md`, `TEST-FLAKES.md`, `e2e/OPEN-PROBLEMS.md` | filing or checking a known defect |
c23d036e:TEST-FLAKES.md:712:(`e2e/OPEN-PROBLEMS.md`, the CDP-capture P2), and it prints both bounding boxes when it fires.
c23d036e:docs/LAYERS-PANEL.md:825:6. **The `e2e/OPEN-PROBLEMS.md` filename mismatch — a _docs_ defect with no routed home.** The file
c23d036e:e2e/viewport-drawing.spec.ts:228:   * that drift is a filed defect (`e2e/OPEN-PROBLEMS.md`, the CDP-capture P2). The
$ git ls-files e2e/ | grep -i open
e2e/OPEN_PROBLEMS.md
$ git show c23d036e:AGENTS.md | sed -n '165p;170p;171p;173p'
5. **Reviewed by someone else** — a code review subagent on the prompt in

- **A green gate is the floor, not the review** — `gate:commit`/`gate:push` are
- **Only step 6 writes to `main`** (plus an operator-requested hotfix on `main`).
```

**Four lines in four files, and most of the citations the source names are not filename references
at all.** Of the five it enumerates, only `AGENTS.md:15` is one: `AGENTS.md:165` and `:172` are
Definition-of-Done steps, and `TEST-FLAKES.md:391` and `:657` are a port note and a
marker-bounding-box note. `HANDOFF.md:593` and `:2471`, cited in the same breath as "uses the
correct underscore form", are unrelated prose, and `:2471` is blank. The `AGENTS.md:170-173`
premise is the same drift: the routing rule is at the two `AGENTS.md` lines that already use the
**underscore** form, so "a cross-scope entry has no home" is argued from a line saying the
opposite.

**The defect is live on all four, and the two prose ones route differently from the Playwright
one.** Every one of the four names a path that does not resolve on any platform, case-insensitive
volumes included. `AGENTS.md:15` and `TEST-FLAKES.md:712` are prose, so this entry is their routed
home. `e2e/viewport-drawing.spec.ts:228` is a comment inside a Playwright spec, and `AGENTS.md`'s
own route-by-scope rule sends that one to `e2e/OPEN_PROBLEMS.md` — which is precisely the
cross-scope gap the source diagnosed, and it is why a fix confined to the two prose files would
leave half of it standing.

**Fix.** Correct all four to the underscore form, filing the `e2e/viewport-drawing.spec.ts:228`
occurrence in `e2e/OPEN_PROBLEMS.md` rather than here. Then delete or rewrite §20 item 6 so it
asserts neither a five-line census nor the `AGENTS.md:170-173` premise. Re-derive the remaining
line numbers from the prose at the time of the fix: `AGENTS.md` is the file every agent reads
first, so a citation into it silently rots, and its own rule says as much.

**Not caused by the `docs/subagent-provider` model-policy change**, which edited the Model policy
section and, with `main` merged in, left the two routing lines at `AGENTS.md:205` and `:212` — the
numbers above are re-derived against that file. Re-derive again when fixing; do not assume they
survive another edit to `AGENTS.md`.

---

## 97. The fit charges a section separator it never measured, and the grid overflows its own budget at 703–709px

**Problem.** `readRowMetrics` derives `sectionBreakHeight` from the **previously rendered** DOM, and
returns `0` when that layout has only one non-empty section
(`src/components/SidebarLeft/toolbar-fit-store.ts:109-121` — the `between > 0` guard needs a second
non-empty `<ul>` and finds none). With `sectionBreakHeight` at 0 the planner accepts one row too many
(`toolbar-overflow.ts:122-149`), that extra row is the first of `toolbarMap` section 1, and the
section separator is then rendered for real. The plan is short by exactly the separator, which is
`mt-1.5 border-t pt-1.5` = 13px over the 6px row gap = **7px**.

**Measured in Chrome**, `1280` wide, one page resized 1px at a time, replicating
`e2e/toolbar-fit.spec.ts`'s own `measure()` verbatim:

```
H=709 slot=437 budget=349.6 content=351 over=+1.4 tiles=7
H=707 slot=435 budget=348.0 content=351 over=+3.0 tiles=7
H=705 slot=433 budget=346.4 content=351 over=+4.6 tiles=7
H=703 slot=431 budget=344.8 content=351 over=+6.2 tiles=7
```

Nothing else in `H=1000..380` exceeds the budget, and the degenerate band is never entered.

**The app's own assertion already fails here; the sweep just does not look.** `e2e/toolbar-fit.spec.ts:165`
is `expect(m.over).toBeLessThanOrEqual(0)`, and the `HEIGHTS` list at `:43` samples twelve heights,
none of which lands in 703–709. This is the same class the file was written for — its own header
(`:10-19`) records the previous separator bug as the 16-row rail modelled at 794px and measured
822px — and the 20% headroom hid it a second time. The non-vacuity check at `:179`,
`expect(any).toContain('sep=7')`, cannot catch it either: `any` is `rows.find('H=1400')` (`:173`),
the one height where nothing collapses and every section is non-empty, so the measurement cannot
read 0 there.

**The documented invariant is false, and the test that claims it cannot see it.**
`toolbar-fit-store.ts:21-25` states the plan "is a function of the slot and of nothing else".
`SidebarLeft.overflow.test.tsx:329` pins exactly that. But the plan is a function of the slot **and
of the previous render**: at `H=705` one run rendered 6 tiles (`content=294`) and another 7
(`content=351`), same slot height, 433. jsdom cannot observe it — `getBoundingClientRect` is 0 for
every box and `src/test/setup.ts:28-34` installs a no-op `ResizeObserver`, so the feedback loop is
stubbed out and the measurement reads "unmeasurable", which `planToolbarOverflow` resolves to
"show everything" (`toolbar-overflow.ts:116`).

**Confirmed by re-deriving the planner, not by reading it.** At the violating heights the render
reports `nonEmptySections=2/5` and 7 tiles, which is the plan computed with `sectionBreakHeight=0`
(7 tiles); the plan computed with `sectionBreakHeight=7` gives 6. At the non-violating neighbours
the render has `nonEmptySections=1/5` and 6 tiles, matching the `sep=7` plan. The planner therefore
committed to a row count using a separator it could not see, and the DOM then charged it.

**No user-visible harm, and that is why it is an entry and not a hotfix.** At the worst height the
grid is 351px in a 433px slot, so nothing is clipped, the rail does not scroll, and every collapsed
tool is still reachable under the three-dots tile. What is broken is the stated contract and the
claim that the fit is settled.

**Fix.** Stop deriving the separator from a layout that may not contain one. Either carry it forward
once measured — the rail knows statically, from `ToolbarSlot.sectionIndex`, which rows open a new
section, so the separator is needed exactly where the plan says it is and the measurement is only
missing when the previous render had nothing to measure — or keep a section `<ul>` non-empty so the
measurement is always available. Measuring it from computed style off a section list is the same fix
as for `rowGap` and `tileHeight` and needs no new constant.

**Test that fails without the fix.** Add `705` to `HEIGHTS` in `e2e/toolbar-fit.spec.ts:43`; `:165`
then fails with `the grid overflowed its own budget`. A jsdom test cannot express this at all —
it is the same reason that file exists, and the reason the rail's own `overflow` unit suite passes
green over the defect.

**Files.** `src/components/SidebarLeft/toolbar-fit-store.ts:109-121`,
`src/components/SidebarLeft/toolbar-overflow.ts:122-149`,
`src/components/SidebarLeft/SidebarLeft.tsx:869-898` (where the three-dots tile is placed in the
section of the last visible row), `e2e/toolbar-fit.spec.ts:43` and `:165` and `:173-179`.

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
call, including the non-`Error` cases. There is no e2e coverage: no Playwright spec drives a failed
open, save, export or copy, and none asserts on `console.error` or `pageerror`. That follows from the
decision rather than overlooking it, but it does mean the e2e suite cannot distinguish a logged
failure from a silent one.

**Files.** `src/contexts/useFile.tsx:118-136`, `src/hooks/useApp.ts:67-71`,
`src/contexts/useSelectionClipboard.ts:41-62`, `src/components/Main/Main.tsx:183,355,369`,
`src/components/DesktopHeader/DesktopHeader.tsx` (File > Save handler),
`src/components/Mobile/MobileMenuDrawer.tsx:49,60,82,110`,
`src/components/Mobile/MobileHeader.tsx:81,107`, `src/App.tsx:92,96`,
`src/util/selection.ts:430-442`.

---

## 99. Every `history-replay.ts` line citation past `:89` is off by eight

**Problem.** §91's fix wrapped the bedrock-frame assignment in `if (index === 0)` (`history-replay.ts:91-97`),
which turned a five-line block into a thirteen-line one. Every cited line below 89 still points where it
did; **every cited line above it is now eight lines early.** The citations were all correct before the fix
and are all wrong after it, so nothing here is pre-existing rot — it is drift this change introduced.

**Why it matters.** These are references a session follows instead of reading, and `history-replay.ts`
ends at 215, so an eight-line miss usually lands inside the neighbouring arm rather than past the file:
`docs/LAYERS-PANEL.md:39` sends the reader to the rename arm when it means the new-layer arm,
`.skills/photoshop-tool-creation.md` cites the `document-operation` `continue` at `:195` when it is `:203`,
and `MIGRATION_NEXT_STEPS_SUNDAY.md:457` cites the crop arm at `:91-97` when it is `:99-105`. Entry 96 in
this file is the same genre of defect for the same reason.

**Fix.** Mechanical: add eight to every cited line above 89, and re-verify each against the file rather
than by arithmetic — the citations name arms, so `:152` (now `:160`) is the `layer-operation` test and
`:195` (now `:203`) is the `document-operation` `continue`. Already re-pointed, because §91 made their
own claims false rather than merely late: `src/contexts/history-adapter.ts:676-688`, and the bedrock-frame
blocks in both §91 test files. Sites still stale:

- `src/contexts/history-adapter.ts:273` (`:102`) and `:639` (`:127`)
- `src/contexts/history-append.ts:179` (`:138`) and `:464` (`:102`)
- `docs/TOOLS.md:2100` and `:2167` (`:152`)
- `docs/LAYERS-PANEL.md:39` (`:106-141`, `:91`, `:99`)
- `MIGRATION_NEXT_STEPS_SUNDAY.md:457` (`:91-97`) and `:467` (`:195`)
- `.skills/photoshop-tool-creation.md:1611,1612,1626,1633,1639,1693,1777,1863,4270`
- `src/tools/descriptions/transform.ts:406` and `:490` (`:152`)
- `src/tools/descriptions/transform.notes.md:151` and `:632` (`:152-160`)
- `HANDOFF.md:1275` (`:146`), `:1299` (`:112-121`), `:1319` (`:112,146`), `:2871` (`:180`)

**Files.** `src/contexts/history-replay.ts`

---

## 100. The main worktree is polluted by `task` subagents, which have no worktree to pollute

**Problem.** `docs/ORCHESTRATION.md:9-15` states the hard rule — 100% of tracked-file changes happen in
a worktree, the main worktree is for reading and merging only — and nothing enforces it. The measured
cause is not agent carelessness: **`task` subagents inherit the calling session's working directory,
so every subagent a main-rooted chat fans out is a writer in main.** Measured 2026-09-30 14:24Z
against `~/.local/share/kilo/kilo.db`: of the 60 most recently updated sessions, **59 have
`directory = /Users/bkalynovskyi/ph`**, and the 7-day split is **220 roots and 1398 subagents** at that
path, 312 of them in the last 24 hours. `task` creates no session and no worktree, and `AGENTS.md`'s
headline instruction is "LAUNCH AS MANY SUBAGENTS AS THE TASK NEEDS" — so the mandated fan-out is
mechanically a write into whatever checkout the root chat occupies, and the root chat is almost always
main. The live proof: `ses_f0dc7819` ("Fix save dialog closing on failure", a `@general` subagent of
root `ses_f0e21021`) wrote `src/contexts/useFile.tsx` at 14:11:32, and the hunk it produced is still
uncommitted in main at 14:24Z.

Three further doors into the same checkout, all of them ordinary tool use rather than mistakes:

- **`agent_manager` `mode: 'local'`** starts sessions in the caller's directory, which by
  construction cannot be assigned to a section. `action: "list"` currently reports **22** of them
  under `local` on branch `main`, and their titles are edit-shaped: "Add `act()` wrappers to LayersTab
  test clicks", "Fix unsafe casts in paint-tools.test.ts", "Remove global mocking in useAnts tests". A
  worktree is one `mode: 'worktree'` argument away.
- **Commits made directly in main.** `main` is 71 commits ahead of `origin/main`, and today's are
  `155ba7b8`, `c00ad7ff` ("cleaned main"), `ad858367`, `926e8a30` ("fix"), `307b77f7` ("fix provider
  name"). A commit in main is the end state of a session that treated main as its workspace;
  `c00ad7ff` is residue swept in bulk rather than prevented.
- **Main used as a branch switcher.** `git reflog` at 12:41:33 shows `checkout: moving from main to
fix/rail-overflow-citations` and back at 12:42:13. Uncommitted files follow a checkout across
  branches, so one session's dirt can be carried onto a feature branch.

**Why the coordination layer does not catch it.** Board identity is the **branch**
(`scripts/lib/agent-board/identity.mjs:43-47`), so every session in main resolves to the single agent
id `main`: all 140 all-time `file_locks` rows for `worktree='/Users/bkalynovskyi/ph'` are `agent_id =
'main'` (the other 35 are the e2e runner's pid-suffixed ids). `holdFiles` refuses only a _foreign_
lock, so two writers in main are the same agent to the board, both holds are granted, and the file
reads as uncontended — the mechanism `docs/ORCHESTRATION.md:36-41` already describes. The visible
consequence at 14:24Z: ten files under active edit (mtimes 14:11-14:23, seconds old) and **zero**
unreleased, unexpired rows in `file_locks`. The same sharing is why `refs/stash` is a hazard here and
not a nuisance.

**Fix, part one — landed.** The commit arm is now a program rather than a paragraph.
`scripts/main-worktree-guard.mjs` runs first in `.husky/pre-commit` and refuses to record a commit
made from the main worktree, naming the worktree recipe and the single override `ALLOW_MAIN_COMMIT=1`.
`kilo.jsonc` cannot express the rule (tool permissions match a path glob and have no term for the
working directory) and Kilo has no lifecycle hook that could veto a write, so the commit is the last
point git itself guarantees to run code in. A landing is untouched — `git merge` into `main` runs
`pre-merge-commit`, and a fast-forward runs no hook. Pinned by
`scripts/__tests__/main-worktree-guard.test.mjs`: the decision table, the refusal text carrying a
way forward, the real-repository check that a linked worktree is not reported as the main one, and the
installation — the guard has to be wired into the hook and the shared dispatcher has to exist, because
a guard that is written and never invoked does not exist.

**Fix, part two — still open, and it is the larger half.** The guard runs _after_ the edit, so a
session that writes into the main worktree and never commits is not stopped by it: it converts "71
rogue commits nobody can attribute" into "a dirty tree the next `git status` names", and the write
side is still the process rule in `docs/ORCHESTRATION.md`. Isolation has to happen at the root,
because a `task` subagent cannot create a worktree of its own. What is still missing is a
mechanism for the two root-level defaults: nothing creates the worktree before the first edit, and
nothing stops `agent_manager` `mode: 'local'` from putting an editing session in the root checkout.
Both are defaults in a tool, not a rule in a document, which is the whole of this entry.

**Files.** `scripts/lib/agent-board/identity.mjs:43-47`, `docs/ORCHESTRATION.md:9-22`,
`AGENTS.md` (delegation section), `kilo.jsonc`, `.git/hooks-gate/pre-commit`
