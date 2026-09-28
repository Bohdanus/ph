## 0. Branch state — read before the problem list

Verified on `fix/handoff-2026-09-28`, branched from `main` at `80eb207` and merged to `main` with
it. Items 6, 15, 18, 19 and 20 were closed here or landed from the migration while this branch was
in review; 6 and 15 are `2dfc18e`, 20 is `2d985d4`, and 18/19 and the encoder half of 20 were done
here independently and are deleted.

**Read this before working on any item below.** Items 1, 2, 4, 10, 11, 12, 16, 17, 31 and 32 all
live in `history-adapter.ts`, `history-append.ts`, `history-timeline.ts`, `selection-baseline.ts`,
`useSelectionHistory.ts` or `useHistory.ts` — the files the history-migration roadmap edits.
Fixing them outside the migration duplicated work and produced a `useHistory.ts` conflict the first
time it was attempted. **Read the migration's own handoffs first:**
`.kilo/plans/history-migration-consolidated-handoff.md` and
`.kilo/plans/history-migration-08-phase1-writer-readiness.md`. Those live under `.kilo/`, which
`AGENTS.md` says is gitignored and machine-local, so they are a pointer and not a durable location:
the reasoning in them has to be re-derived if the machine is lost.

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
  item 1 is to wait for Phase 3, not to mount `ReplayCoordinator` early — and the two `it.fails`
  pins in `StoreContext.durable-boundary.test.tsx` are the last thing standing between it and a
  half-wired render path. Any recommendation to delete those pins is wrong for that reason.

**`fix/unit-tests` (`b027de3`) is still 2 commits unmerged** and is not an ancestor of `main`. It
claimed items 16, 17, 18 and 19; 18 and 19 landed here instead, and 16 and 17 were re-verified as
still open (`history-adapter.ts` has no `else` on the `SET_DOCUMENT_FRAME_ACTION` branch, and
`publishedEntryIds` appears nowhere in the file).

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
`materialization.ts:109-145` duplicates `getLayerAffineTransform` and `scaleVectorArgs` from
`affine-transform.ts`, violating the "never independently approximate in different files" rule.
`materializeLayer` / `materializeDocument` have zero callers, so the first wiring attempt is the
first time that code executes against real state.

**Also wrong at the boundary.** The runtime path feeds an _untransformed_ bitmap to a pixel
processor (`useLayer.ts:526-533`); the durable path materializes the retained presentation first
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
`OffscreenCanvas`, `src/test/setup.ts:53-54` installs a global one unconditionally, and that test
file never stubs it. A probe replicating the pin's instrument recorded **zero** calls on both
`transform` and `drawImage`, so its assertions fail on `0` rather than on the grouping — and
`0 !== 2` before and after a fix alike. A correct fix is forced to leave the pin, or to rewrite
assertions that still measure nothing. `AGENTS.md` counts 34 `it.fails` blocks and treats each as a
live tripwire; this one is not. See `FOCUSED-REVIEW-2026-09-28.md` §1.

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

## 15. `reorder-layers` is the next append-boundary writer, and it is now unblocked

**Problem.** The append boundary translates `set-document-frame`, `set-selection`, and the canonical
`show`/`hide`/`rename` layer-property actions. `REORDER_LAYERS` still rebuilds the shadow through
`buildDurableDocument` on every drag, so a reorder is the next candidate to publish.

It could not be published before, for a reason specific to this action: **the durable operation
cannot be derived from the history item alone.** The item carries intent (`layerToMoveId`,
`afterWhichLayerId`), not the resulting order, so `validatePlannedDurableEntry` has nothing to check
an `orderByLayerId` map against. Two preconditions that the slice has now satisfied:

- **The store owns the pre-state.** `REORDER_LAYERS` takes intent only and the reducer applies the
  move to `state.layers` (`StoreContext.tsx:368`, `reorderLayersFromState`), so the authoritative
  logical order immediately before the append is available at the boundary instead of being carried
  out of a 200 ms-stale hook closure.
- **A missing anchor no longer disagrees.** Legacy replay skips the move
  (`history-replay.ts:127`) and `reorderLayers` refuses it with "Target layer not found"
  (`layer-utils.ts:259-262`); conversion used to be the lone outlier, checking only the _moving_
  layer and computing `remaining.indexOf(anchor) + 1` — which is `0` for an absent anchor, recording
  a move to the bottom the document never performs, and rewriting every layer's `order` so the
  divergence poisoned all later entries. It now skips like the other two, leaving `operation` null,
  which is the "record nothing" path a dropped rename already takes and needs no cursor-map change
  (`legacyCursorToDurableCursor` is appended outside the `if (operation)` push,
  `history-adapter.ts:691-692`).

**Fix.** Take the authoritative layer order from the store at the boundary, recompute the expected
`orderByLayerId` there **independently** of `legacyHistoryToDurable`'s copy, and route the writer
through the existing `published` / `preconditions` / `mismatch` decision. Reusing conversion's own
helper would reproduce a bug in it rather than catching one; an independent copy can drift, so pin
the two against each other in a parity test. On a missing anchor or mover, return `preconditions` and
let conversion run — do not manufacture an order map, and do not collapse the three-way decision to a
boolean.

### The remaining conversion-only writers

Reorder is the _next_ slice, not the last one. These production sites still pass no
`durableEntry`, so each one runs `buildDurableDocument` over the whole timeline. Passing a
`durableEntry` is necessary but not sufficient: the store publishes only on
`outcome === 'published'` and otherwise reconverts.

| Site                                  | Action             | Why                                           |
| ------------------------------------- | ------------------ | --------------------------------------------- |
| `useLayer.ts:165` `_addLayer`         | `NEW_LAYER_ACTION` | asset-bearing; needs the registry transaction |
| `useLayer.ts:295` `updateLayerByTool` | `TOOL_ACTION`      | asset-bearing                                 |
| `useLayer.ts:312` `updateLayerByTool` | `TOOL_ACTION`      | asset-bearing                                 |
| `useLayer.ts:376` `commitDirtyTool`   | `TOOL_ACTION`      | asset-bearing; one commit per pending edit    |
| `useLayer.ts:410` `removeLayer`       | `REMOVE_ACTION`    | needs layer retirement, see §54               |
| `useLayer.ts:639` `mergeAllLayers`    | `MERGE_ACTION`     | asset-bearing, retires layers                 |
| `useLayer.ts:461` `REORDER_LAYERS`    | `REORDER_ACTION`   | this item                                     |
| `useSelectionHistory.ts:149`          | `SELECTION_ACTION` | `catch` fallback when planning throws         |
| `useSelectionHistory.ts:305`          | `SELECTION_ACTION` | `catch` fallback when planning throws         |
| `useHistory.ts:52` `addHistoryEntry`  | any                | no production caller at all, see item 14      |

Three sites have no `durableEntry` concept and reconvert unconditionally: `useHistory.ts:126`
`resetHistoryTo` (`APPLY_HISTORY_REPLAY`), `useLayer.ts:140` and `useApp.ts:116` (both
`REPLACE_DOCUMENT`).

**Fix, in order.** `reorder-layers` first — see this item above; the store now owns its pre-state,
so all that is left is the independent recomputation and the `published` / `preconditions` /
`mismatch` decision. The asset-bearing operations (`create-layer`, `remove-layer`,
`merge-document`, the tool operations) cannot be published at all until §54's registry transaction
exists, and that single gap is what keeps the majority of these writers here.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/history-append.ts`,
`src/contexts/StoreContext.tsx`, `src/contexts/useLayer.ts`, `src/components/SidebarRight/LayersTab.tsx`

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

## Known defects that are PINNED — do not "fix" them casually

An `it.fails(...)` is a tripwire: it passes today and **fails the moment the defect is fixed**, so a
fix must remove the pin in the same change. There are 34, counted as `it.fails(...)` blocks:
`grep -rn 'it.fails(' src e2e` returns 34 and every one is in `src/`, and `npm run test` independently
reports the same 34 as `34 expected fail`. The migration-relevant ones:

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

## 31. The selection baseline lookup must stay unbounded over the whole timeline

**Problem.** `deriveSelectionBaseline` (`selection-baseline.ts:56`) is deliberately unbounded: it
takes the **first** non-disabled `SELECTION_ACTION` on the timeline and seeds from that entry's
`previousSelectionState` (`:57-59`), with no cursor argument at all. Both consumers take the
timeline wholesale — `history-replay.ts:68` and `history-adapter.ts:465` — so the durable baseline
and the legacy replay start from the same snapshot, which is the parity property `0659ce9`
extracted this rule to own.

Bounding the lookup by replay target looks like a correctness fix, and it was a data-loss bug until
every selection-creating gesture recorded its own entry. That precondition now holds, so **this entry
is actionable: the bound is safe to make.** Two tests still pin the unbounded behaviour as
load-bearing, not stale:

- `src/contexts/__tests__/useHistory.test.tsx:439` — "restores a cleared selection when undoing the
  tool-switch history entry". The fixture is a rename entry at index 0 and a selection-clear entry
  at index 1; `undo()` from `historyIndex: 1` replays to index 0, and the only record that the
  selection ever existed is the clear entry at index 1 — after the target. Bound the lookup and
  undoing a tool-switch deselect becomes a silent visual no-op.
- `src/contexts/__tests__/history-replay.test.ts:90` — "uses the first selection action baseline
  before it and its next state at or after it". `replayHistory(history, 0, …)` at `:117` expects the
  baseline, with the `SELECTION_ACTION` at index 1, again after the target index.

**Fix.** Bound the lookup at the replay target, and change those two tests **in the same change**:
they must be re-derived to assert a creation entry that precedes the target, not deleted to make the
bound pass. The unbounded behaviour was a live feature, so a fix that makes one of them fail without
re-deriving it has removed a user-visible capability, not corrected a pin.

Both consumers take the timeline wholesale, so the bound has to reach `deriveSelectionBaseline` (add a
cursor argument) and be threaded through `history-replay.ts:68` and `history-adapter.ts:465`
together — bounding one and not the other re-opens the parity divergence that `selection-baseline.ts`
exists to close.

**Two comments carry the stale rationale, so both must be rewritten in the same change — not one of
them:**

- `selection-baseline.ts:46-55` — the doc comment above `deriveSelectionBaseline`. The claim is at
  `:50-51`, "the first non-disabled `SELECTION_ACTION` entry's `previousSelectionState` is the only
  record that the selection ever existed", with `:52-54` restating it for the durable baseline.
- `history-adapter.ts:460-464` — the comment above the `deriveSelectionBaseline(legacyHistory)` call
  at `:465` repeats it in the adapter's own voice: "It cannot be narrowed to the pre-first-entry state
  **while a selection is created outside history**: the tool-switch clear's `previousSelectionState` is
  the only record that the selection existed." Rewriting only the first leaves the rule's owner
  corrected and its caller still advertising the reason it must not be bounded, so the next reader
  takes the call site as exempt from the bound being introduced at the signature.

**Files.** `src/contexts/selection-baseline.ts:46-59`, `src/contexts/history-replay.ts:68`,
`src/contexts/history-adapter.ts:460-465`, `src/contexts/__tests__/useHistory.test.tsx:439`,
`src/contexts/__tests__/history-replay.test.ts:90,117`

---

## 32. Every selection change now appears as a "Selection" row in the History panel

**Problem.** `getHistoryItemTitle` (`useHistory.ts:15`) special-cases a tool source (`:18-20`),
`TOOL_ACTION` (`:22-24`) and the crop (`:26`), and otherwise **falls through to the raw action
name** (`:28`). `HistoryTab.tsx:22` renders that string, so a `SELECTION_ACTION` entry is labelled
with the constant's own value.

That was invisible while selections wrote no history. It is not any more. Every one of these appends
one real entry through `commitSelection` / `clearSelections` / `appendSelectionClear`:

| gesture                                                          | append site                                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Clear/Deselect control, and the tool switch                      | `useSelectionHistory.ts:212`, `useSelectionHistory.ts:95` (`useApp.ts:172`) |
| magic-wand click                                                 | `MagicWandToolArea.tsx:93`                                                  |
| rectangle drag end                                               | `RectangularSelectionToolArea.tsx:83`                                       |
| polygonal / freehand lasso close, feathered magnetic lasso close | `PolygonClickToolArea.tsx:274`, `FeatherMagneticLassoToolArea.tsx:424`      |
| polygon's committed anchor or body drag                          | `PolygonClickToolArea.tsx:593`                                              |

So every selection change in a session adds a row, and **one gesture can add more than one kind**: a
lasso gesture appends a creation and a later drag appends a separate move, both labelled identically.
Each row is also a navigation target (`resetHistoryTo(originalIndex)` at `HistoryTab.tsx:27`) and
carries a disable toggle (`:45`), so a user can step onto or disable a row whose label says nothing
about what it did — and there is no way to tell a creation from a move from a clear, since all three
carry the same `layerId: 'selection'` and the same action name.

**This is a UX decision, not a defect with one right answer.** The operator chooses between hiding
selection entries from the panel, grouping consecutive ones into a single row, and relabelling them
distinguishably (create / move / clear). Whichever is chosen, the label has to come from
something the entry actually carries; `nextSelectionState` and `previousSelectionState` are already
on the item (`useSelectionHistory.ts:263-273`), so a relabel is derivable without a new history
field. Do not add a history field for presentation alone while the legacy timeline is still the
replay authority.

**Files.** `src/contexts/useHistory.ts:15-29`, `src/components/SidebarRight/HistoryTab.tsx`

---

## 45. The AVIF encoder enforces the raster budget on save, and the codecs' ceilings still disagree

**What is fixed.** `encodeAvif` (`avif-utils.ts:32`) called the codec on an unbounded canvas while
`loadAvifFile` (`:20`) refused anything over `MAX_AVIF_PIXELS`, so `New ▸ A3 @ 1200 dpi` followed by
`Save as AVIF` wrote a file this build then refused to reopen. Both sides now share one
`assertPixelBudget(width, height, 'open' | 'save')` (`:14`), called on the encode path at `:37`
before the pixels are read, on the same rationale `tiff-utils.ts:168-174` already uses for TIFF:
whatever this build writes it has to be able to read back. Pinned by three new cases in
`src/contexts/__tests__/avif-utils.test.ts` plus the pre-existing load-side pin — over-budget
rejection, the guard running before `getImageData`, the exact-budget boundary (`10000 × 8000`
encodes, `10000 × 8001` does not), and the load-side string preserved byte for byte. The stale
`NewImageDialog.tsx:77-78` / `:158` / `:178` citation in `tiff-utils.ts:8-9` now points at the real
`:208-209` / `:289` / `:308`.

**Remaining verification — a ceiling decision that belongs to the operator, not to a fix branch.**
Three numbers still disagree, and enforcing the budget on the encoder made the disagreement a
capability loss rather than a latent trap:

| ceiling                             | value       | where                        |
| ----------------------------------- | ----------- | ---------------------------- |
| largest document the app can create | 100,000,000 | `NewImageDialog.tsx:208-209` |
| AVIF, open and save                 | 80,000,000  | `avif-utils.ts:13`           |
| TIFF, open and save                 | 200,000,000 | `tiff-utils.ts:23`           |

So a document between 80 MP and 100 MP **cannot be saved as AVIF at all** — `saveImageToDisk` throws
with the budget message, and `useFile.tsx:119-135` surfaces it as an alert. Before the guard it saved
and then failed to reopen, which is the worse failure, so the change is right; the cost is real and
the number was not chosen by whoever added the guard.

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

| ceiling                             | value       | where                        |
| ----------------------------------- | ----------- | ---------------------------- |
| largest document the app can create | 100,000,000 | `NewImageDialog.tsx:208-209` |
| affine transform                    | 67,108,864  | `affine-transform.ts:34`     |
| PSD                                 | 67,108,864  | `psd-utils.ts:36`            |
| AVIF, open and save                 | 80,000,000  | `avif-utils.ts:13`           |
| TIFF, open and save                 | 200,000,000 | `tiff-utils.ts:12-23`        |

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

- **TIFF's byte predictor ignores the tiled-allocation branch.** `tiff-utils.ts:102` is the whole
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
absolute pixel ceiling anywhere in the file. `bmp-utils.test.ts`'s largest geometry is 8×8, so no
test can reach an interesting ratio.

**Owned, so recorded not fixed:** `image-load-save-utils.ts:113-136` is the load path for GIF and SVG
and bounds nothing — the whole file is base64-encoded into a data URL and handed to `new Image()`.
That is where a shared load-side ceiling would have to live for those two formats. Separately,
TIFF's save-side byte check at `:175` is provably dead (`MAX_TIFF_PIXELS * 4` is always below
`MAX_TIFF_BYTES`) and its message says "Decoding it" on a save; AVIF's `assertPixelBudget` has no
finite/integer guard, so a decoded `width: -5, height: -3` passes the budget and reaches
`createImageData(-5, -3)`, throwing a DOM `IndexSizeError` instead of an actionable message.

**Files.** `src/contexts/avif-utils.ts`, `src/contexts/tiff-utils.ts:8-9,74-102,175`,
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

`src/components/SidebarLeft/__tests__/harness.tsx:79-115` is a shared render harness, and its
docstring says a suite must import it before `../SidebarLeft.tsx` so its hoisted `vi.mock` calls
apply. **No suite does.** All nine files — `SidebarLeft.cleanup`, `SidebarLeft.color-pickers`,
`SidebarLeft.context-menu`, `SidebarLeft.flyout`, `SidebarLeft.icon-state`, `SidebarLeft.keyboard`,
`SidebarLeft.layout`, `SidebarLeft.primary-selection`, `SidebarLeft.rendering` — re-declare the
whole `storeState` / `toolArgs` / `useApp` / `useCurrentTool` / `toolIcons` fixture inline, so the
harness has no callers and the mock it holds is dead weight that still has to be kept compiling.

The cost is a defect that only appears on the next tool. `toolIcons` is a hand-written object
literal listing every icon name, and `SidebarLeft` renders
`getToolIcon(tool.name)`. Add a tool and the literal is out of date, so `Icon` is `undefined` and
React throws `Element type is invalid` from `createFiberFromTypeAndProps` — in **every** file in the
directory, with a message that names neither the missing icon nor the stale literal. Adding the
four eraser-family icons meant editing the same list ten times.

**Fix.** Delete the inline `vi.mock`/`vi.hoisted` blocks from the nine suites, import
`storeState` / `toolArgs` / `goToTool` / `patchToolArgs` / `toolbarButtonByName` from
`./harness` in each (the import must precede `../SidebarLeft.tsx`, which the harness docstring
already states), and then delete the harness's now-unused duplicates. While in there, replace the
`toolIcons` literal with `import { toolIcons } from '../toolIcons.tsx'` so the list cannot go stale
again — `SidebarLeft.icon-state` needs per-name `data-icon` attributes, so it needs a
`vi.mock` that maps over the real keys rather than a hard-coded array.

**Files.** `src/components/SidebarLeft/__tests__/harness.tsx:79-115` and the nine
`SidebarLeft.*.test.tsx` files listed above.

---

## 47. `FillToolArgs.size` is written by the tool area and read by nothing

`src/tools/fill.ts:38-46` declares `size: { width: number; height: number }` on `FillToolArgs`,
with the comment that a fill needs its layer geometry in the committed args. The seeded default is
`{ width: 1, height: 1 }` (`src/tools/settings.ts`), and the two fill processors take the real size
from the curried `ProcessorToolParams` — `fillLayer` destructures `params.size` and never reads
`args.size`. `pos` is genuinely required, because a durable `apply-raster-processor` op replays from
the stored args alone (`src/contexts/materialization.ts:282`); `size` is not, because the same call
site passes `{ bitmap, size }` separately.

So the field is a write-only trap: a tool area that forgets to write it produces a layer-sized fill
with no error, and a reader that trusts `args.size` gets `1x1`. It is also the only tool args in
the repository that carries a size — every other tool learns it from `params`.

**Fix.** Either drop `size` from `FillToolArgs` and keep only `pos`, or make the processors read
`args.size` and assert in `src/tools/__tests__/fill.test.ts` that a `pos`/`size` pair in the args
governs the raster, so the field cannot be write-only. Do not leave it as it is.

**Files.** `src/tools/fill.ts:38-46`, `src/tools/settings.ts` (the two `size: { width: 1, height: 1 }`
defaults)

---

## 48. The eraser is hard-edged by construction, and three of Photoshop's controls are therefore dead

**Problem.** Photoshop's Eraser options bar has seven live controls: `Mode` (Brush /
Pencil / Block), `Size`, `Opacity`, `Flow`, `Airbrush`, and the panel's Pressure controls,
plus `Erase to History`. Three of them cannot work here and are rendered `disabled`:
`Brush` mode (`src/components/ToolbarsRight/Eraser/Eraser.tsx:56`), `Flow`
(`:96-104`) and `Airbrush`.

**Why it is not a wiring bug.** The painter issues exactly one `beginPath`, one
`moveTo` and one `stroke()` per stroke (`src/util/draw.ts:136` dispatches; the
call-count pins are `src/tools/__tests__/paint-tools.test.ts:227,229`). A canvas
`stroke()` has no falloff, so the result is always hard-edged, and it has no dab
loop, so there is nothing for a per-dab alpha ramp (Flow) or a build-up
accumulator (Airbrush) to vary. `Flow` therefore renders disabled rather than
changing a readout, and the seeded `EraserMode` is `'pencil'`
(`src/tools/eraser.ts:16`) rather than Photoshop's `Brush`, because offering
`Brush` as a selected value would ship a mode that silently renders as Pencil.

**Fix.** Replace the single-path stroke with a stamp loop: build a tip bitmap
(falloff from Hardness, affine from Angle/Roundness), walk the path by `Spacing`,
and composite each dab with Flow accumulating into a per-stroke buffer. Do it in a
new module beside `src/util/draw.ts` rather than inside `drawPen`, and leave the
legacy `draw` path calling `drawPen` unchanged.

**Tripwires that must be removed in the same change, not weakened.**
`src/tools/__tests__/paint-tools.test.ts:227,229` pin `beginPath` called exactly
once and `stroke()` called exactly once for a brush or pencil stroke, and `:222`
pins `createRadialGradient` once per sample on the spray path. A stamp loop for
the eraser family fails the first two only if the pins are extended to the eraser
rather than rewritten; scope them by tool name so the legacy `draw` pins survive.
`e2e/export/visual-regression.spec.ts` baselines were recorded through `draw` and
are unaffected as long as `draw` is left alone.

**Files.** `src/components/ToolbarsRight/Eraser/Eraser.tsx:56,96-104`,
`src/tools/eraser.ts:16`, `src/util/draw.ts:136`,
`src/tools/__tests__/paint-tools.test.ts:222,227,229`

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
`fillLayer` (`src/tools/fill.ts:94`) multiplies its write alpha by that coverage,
and the existing `alpha` (Opacity) term composes with it. The magic eraser needs
the same, on the subtraction side.

**Note.** The module is new, so this is additive and no test pins the current
behaviour — the disabled control is the only place it is recorded, which is the
point of the entry.

**Files.** `src/util/floodFill.ts`, `src/tools/fill.ts:94`,
`src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:19,79`

---

## 50. The bucket has no blend mode

**Problem.** Photoshop's Paint Bucket `Mode` is a full blend-mode list. It is not
rendered here at all, so a bucket fill always composites `source-over`. The
`Fill` control that does exist (`src/components/ToolbarsRight/MagicEraser/PaintBucket.tsx:38-75`)
offers `Foreground` enabled and `Pattern` disabled, which is correct and complete
for what the app supports — the gap is the blend mode, not the fill source.

**The seam this entry used to be blocked on has landed.** The eight-tool tranche
brought `toolLayerBlendMode` into `src/contexts/layer-utils.ts`, so an options-bar
`Mode` now reaches a committed layer for the paint tools. There is one seam and it
is in `main`, which removes the two-seams hazard this entry previously described.
`ps/brush-engine` and `ps-tools-spine` also carry a copy of that seam; they are now
redundant with `main` and should be dropped rather than merged.

**What remains.** The gate is deliberately scoped to `brush`, `pencil` and
`color-replacement`, so `paint-bucket` is still excluded and its fill composites
Normal. Widening the gate is a one-line change, but it needs the blend control
added to the shared fill bar first, and the gate is load-bearing: it exists so a
stray `blendMode` key on a text or shape args object cannot decide how that layer
composites. Widening it to every tool name would silently let that happen.

**Files.** `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx`,
`src/contexts/layer-utils.ts:160-166,244`

---

## 51. The eyedropper reads the composite for itself: no per-layer sampling, no ring, no Color Sampler

**Problem.** The eyedropper's `Sample All Layers` renders `disabled`
(`src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:38`) and
`sampleAllLayers: true` in the args is refused with a named error rather than
silently ignored (`src/components/Main/EyedropperToolArea.tsx:66`). Photoshop's
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
`src/components/Main/EyedropperToolArea.tsx:66`,
`src/components/SidebarLeft/SidebarLeft.tsx`

---

## 52. Hand, Zoom and Rotate View are absent because the view transform is commented out

**Problem.** Three of Photoshop's twenty toolbar slots have no implementation, and
the placeholder is a commented-out JSX line: `src/components/SidebarLeft/SidebarLeft.tsx:412`
is `{/*<Zoom />*/}`.

**Why it is not a wiring bug.** There is no view transform to wire. The store's
zoom data is entirely commented out — `src/contexts/StoreContext.tsx:953-957` is
`// const zoomDataRef = useRef<ZoomData>({ dx: 0, dy: 0, zoom: 1 });` and the rest
of that block — and `usePointerPosition` maps client coordinates to image pixels
through a `scale` supplied by the host rather than owning a view transform itself.
`Main.tsx:53` initialises `interactionMode = 'zoom'` and nothing ever sets it to
that string, so the name is currently a dead default rather than a feature.

**Fix.** Decide whether the canvas has a view transform at all, because three
different features want one and it should be one: pan/zoom, the space-drag
temporary-pan behaviour every tool inherits, and the tool cursors that must track
the view (a brush tip circle is a screen-space circle). A `DocumentViewScope`
owning `{ dx, dy, zoom }`, with `usePointerPosition` and every pointer-to-image
conversion reading from it, is the shape the commented-out code was reaching for.
Do not start with a Hand tool; start with the scope, and the three tools fall out.

**Files.** `src/components/SidebarLeft/SidebarLeft.tsx:412`,
`src/contexts/StoreContext.tsx:953-957`, `src/hooks/usePointerPosition.ts`,
`src/components/Main/Main.tsx:53`

---

## 53. Six selectable tools do nothing at all, and the honest fix is five lines

**Problem.** `pen`, `freeform-pen`, `curvature-pen`, `add-anchor-point`,
`delete-anchor-point`, `convert-point` and `custom-shape` are all in
`toolbar-mapping.ts`'s `availableTools` and all render a button. Each is
`commit: 'unimplemented'` with `imageProcessor: unimplemented`
(`src/tools/toolProcessors.ts:237` for `pen`, `:268` for `custom-shape`), and the
processor returns `[null]`. Each has no `interactionMode` arm in
`src/components/Main/Main.tsx`, so each falls through to `else EventHandler =
DummyToolArea` (`:177`) — a `display: none` div with no handlers. **They do not
consume a history entry**, which is the thing an earlier inventory of this repo
got wrong and which is worth stating because it changes the severity: the defect
is a dead button, not a corrupted document.

**Why it is not a wiring bug.** These are the pen family and custom shapes, and
they need a bezier path model with subpaths and holes, a fill rule, and a CPU
scanline rasterizer because boolean path operations cannot go through `Path2D`.
That is a phase of work, not a wiring fix.

**Fix — needs a call, not a patch.** Two honest options, and the choice is the
operator's. Either hide the six from `toolbarMap` until they work, or make
`unimplemented` throw a named error at `toolProcessors.ts:103` so selecting one
fails loudly instead of silently doing nothing. Throwing is the smaller diff and
converts a silent no-op into a visible one, but it changes seven existing tools'
behaviour, which is a product decision rather than a cleanup. Whatever is chosen,
do it before the next tool tranche: every new tool inherits the same silent
failure, and the four added here would have shipped the same way had the spine
agent not checked `Main.tsx:53`.

**Files.** `src/tools/toolProcessors.ts:103,237,268`,
`src/components/Main/Main.tsx:53,177`, `toolbar-mapping.ts:47-71`

---

## 54. The durable append fast path does not reconcile asset ownership

**Problem.** `decideDurableAppend` publishes a cloned durable document directly, while full
conversion wraps asset-bearing operations in `beginDocumentAssetTransaction` / commit / reconcile
(`history-adapter.ts:676-690`). The current append slice is safe because layer-property operations
carry no assets, but the next asset-bearing operation could publish a document without registering
or retiring its raster ownership.

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

**Problem.** `Layer.opacity` is a required field (`src/contexts/tool-types.ts:93`),
PSD import populates and validates it (`src/contexts/psd-utils.ts:159,229`), and
`materialization.ts:162` applies it to the document frame. Nothing in the app ever
writes it. There is no opacity control in the desktop shell, and the mobile layers
drawer had one that was removed rather than shipped broken.

**Why the obvious implementation is wrong.** A slider would reach for
`updateLayer(id, { opacity }, TOOL_ACTION)`, because that is the signature every
other layer property write uses (`src/contexts/useLayer.ts:431`). It fails three
times, all silently. `updateLayer` only plans a durable append when
`isSetLayerPropertiesAction(actionName)` is true, and `TOOL_ACTION` is not in that
whitelist, so the entry never gets a durable translation. `history-replay.ts:146`
reads `if (!layer || !toolArgs?.toolName) continue;`, and a property patch carries
no `toolName` in its args, so legacy replay skips it and the document after an undo
diverges from the document before. And `getHistoryItemTitle`
(`src/contexts/useHistory.ts:23`) returns `(args as ToolArgs).toolName` for a
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
- `src/contexts/history-adapter.ts:331` and `:340` — add the action to
  `isSetLayerPropertiesAction` and give `deriveSetLayerPropertiesEntry` its branch.
  Adding it to the first without the second makes `updateLayer` plan an append that
  resolves to no durable entry, and it silently falls back to the raw patch.
- `src/contexts/history-replay.ts:112-121` — the legacy arm beside the
  show/hide and rename arms, writing `{ ...layer, opacity }` the way those write
  `visible` and `name`. This is the arm that made the `TOOL_ACTION` route wrong, and
  without it undo/redo leaves the document inconsistent.
- `src/contexts/useHistory.ts:15` — a real title. Not a correctness fix: the
  `return actionName` fallback at `:28` already yields a non-empty string for a
  purpose-built action, so the `undefined` above is specific to `TOOL_ACTION`. It
  matters because `SHOW_LAYER_ACTION` and friends already render their raw constant
  name in the History panel, and a fourth raw constant is a worse answer than a
  fifth proper title.

`updateLayer` itself needs no change: given a whitelisted action it already replaces
the caller's patch with the canonical one from the planned durable entry.

Do not reuse `UPDATE_LAYERS` — item 13 records that it is an unguarded escape hatch.

**Files.** `src/contexts/tool-types.ts:93`, `src/contexts/useLayer.ts:431`,
`src/contexts/history-model.ts:80`, `src/contexts/history-adapter.ts:330,342`,
`src/contexts/history-replay.ts:112,146`, `src/contexts/useHistory.ts:15,23`,
`src/contexts/psd-utils.ts:159,229`

## 57. The mobile shell has no colour control at all

**Problem.** The desktop rail carries the foreground and background swatches, a swap
and two native colour inputs (`src/components/SidebarLeft/SidebarLeft.tsx:380-425`).
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

**Files.** `src/components/SidebarLeft/SidebarLeft.tsx:380-425`,
`src/components/Mobile/MobileBottomBar.tsx`, `src/components/Mobile/MobileShell.tsx`

---

## 58. A single brush stroke makes the durable document un-materializable, and it voids the whole document

**Problem.** `convertSource` (`history-adapter.ts:166-172`) routes a layer source's `args.toolName`
to `text` or `vector` for exactly two cases — `'text'`, and the six shape names — and to
`legacy-tool` for everything else. `materialization.ts:156` throws on `legacy-tool`
**unconditionally**, and `materializeDocument` releases every taken lease and rethrows (`:347-350`),
so a single unconvertible layer voids the entire document rather than itself.

`useLayer.ts:289` writes `args: { ...args }` from the concrete tool, so `args.toolName` is
`'brush' | 'pencil' | 'color-replacement'`, never `'draw'`. **All three painting tools take the
`legacy-tool` route.** The second thing a user does in a session is draw a stroke, so this is not a
latent shape of the cutover — it is what the cutover would do.

The irony worth recording: `toolProcessors.draw` at `toolProcessors.ts:144-150` is a genuine `creator: true`, so a
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

**Files.** `src/contexts/history-adapter.ts:164-183`, `src/contexts/materialization.ts:156,347-350`,
`src/contexts/useLayer.ts:289`, `src/tools/toolProcessors.ts:144-150`

---

## 59. Three selection tools claim `creator: true` and cannot create anything

**Problem.** `materializeLayer` trusts the `creator` flag as its only gate
(`materialization.ts:167-168`). All three `commit: 'selection'` entries claim it —
`polygonal-lasso` (`toolProcessors.ts:160-166`), `freehand-lasso` (`:167-173`) and
`rectangular-selection` (`:186-192`) — and all three processors are pass-throughs over a `bitmap`
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

**Files.** `src/tools/toolProcessors.ts:160-192`, `src/tools/selection.ts:15-21`,
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
away from the same failure. **`claimDocumentGesture` returning `false` must be honoured at every
call site**: take the ref, and any state flag, only when the claim succeeds — as `DrawToolArea`,
`ShapeToolArea`, `EraserToolArea`, `MoveToolArea` and the freehand branch now all do.

## 61. Three overlay painters leave a pending animation frame across unmount

`DrawToolArea`, `ShapeToolArea` and `useRect` each hold a `frameRequested` ref they schedule with
`requestAnimationFrame` and cancel only in `handlePointerUp`. `EraserToolArea` cancels it in its
unmount effect; these three do not. The gap is pre-existing in all of them, so this is defence in
depth rather than a regression, and the worst case is one extra overlay paint after the area
unmounts, which self-heals on the next press. Two lines each.

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
