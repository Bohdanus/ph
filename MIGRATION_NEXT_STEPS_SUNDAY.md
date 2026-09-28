# HISTORY MIGRATION — STATE OF PLAY

**The current map of the history-machinery migration: what is in production, what is still a
shadow, what is broken, and what must not be "fixed".**

- Audited at: `main` @ `f7757cf` (2026-09-28)
- Previous audit: `eb2160e` (2026-09-27). **226 commits have landed since**; most of that
  document was wrong and has been replaced.
- Every `file:line`, commit hash and count below was re-derived from the tree on the date above.
  Line numbers drift — **re-verify from the sentence that makes the claim, never from the old
  number.**
- The previous version of this file also carried a 256-session Kilo chat inventory for a two-day
  window. It has been dropped: a session census is a snapshot of a closed window, and the part
  that mattered — what the work _was_ — is now in the commit narrative in §2.6.

---

## How to use this document

| If you want…                                            | Read |
| ------------------------------------------------------- | ---- |
| Where the migration stands right now                    | §1   |
| What is being migrated, structurally                    | §2   |
| What is verifiably running in production today          | §3   |
| What is broken, and what is pinned                      | §4   |
| **The crop contract — the non-destructive requirement** | §5   |
| What must NOT be "fixed"                                | §4.5 |
| The next slice                                          | §6   |
| Per-plan status                                         | §7   |

### Companion documents

- **`HANDOFF.md`** (repo root, 1360 lines, items numbered to 65) is the **actionable** list. Use it
  to pick the next task. This document is the **map**: structure, state, and reasoning.
  The migration-relevant open items there are §1, §2, §4, §10, §11, §12, §15, §15a, §16, §17,
  §31, §32, §54, §56, §58, §63, §65.
- **`.kilo/plans/history-migration-*.md`** — every one of these now carries a `## Status` section at
  its end, re-derived against `f7757cf`. See §7. **These files are gitignored and machine-local**
  (`.gitignore:34`); they are a pointer, not a durable location. `HANDOFF.md` §0 says so too.

### How much to trust this document

| Confidence                   | Which claims                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Verified directly, by me** | every `file:line` in §3–§5, all module importer counts, the writer inventory, the pin list, the `it.fails` count, the AGENTS.md finding |
| **Measured today**           | all gate numbers in §3                                                                                                                  |
| **Audit + my re-check**      | the per-plan status in §7. The load-bearing claims behind each were independently re-verified against the tree; ~8 were corrected       |
| **Judgement, not finding**   | §6                                                                                                                                      |

Three claims in the previous version of this document were **wrong**, not merely stale, and are
now corrected: `durable-replay.ts` was not dead; `materialization.ts` never duplicated
`getLayerAffineTransform`; and `SET_TOOL_DIRTY` no longer exists. Details in §4.

---

## 1. Executive state

**The durable document is still a shadow. Three of its five modules are still unwired. But the
migration is much further along than "0% switched on" used to suggest, and the single-writer
boundary is now real and exercised by ordinary UI flows.**

> **The durable replay path is not in production.** `materialization.ts`, `replay-coordinator.ts`
> and `replay-checkpoints.ts` have **zero non-test importers**. `durable-replay.ts` is now imported
> by `StoreContext.tsx:28` — but it is called once, at `StoreContext.tsx:887`, to read the shadow's
> layer _order_ for a reorder precondition. It is not a render, navigation or export input.
> Production still runs legacy `HistoryItem[]` → `replayHistory` → runtime `Layer` →
> `layer-renderer` → canvas.

**What changed since `eb2160e` — the substance, not the counts:**

- **The single-writer append boundary is real.** `history-append.ts:120-173` now translates four
  action families — document frame, selection, and show/hide/rename layer properties — plus
  reorder, which the store plans out-of-band (`history-append.ts:256`). **5 of 10 history-appending
  sites publish through it**; 5 still reconvert the whole timeline.
- **Selection state is decoupled from durable validity.** `887cdcc` stopped ~20 reducer actions
  from marking the shadow stale. Only **4** do now, and 3 of those have **zero production dispatch
  sites**. The published path is reachable in ordinary UI.
- **The two divergent commit implementations are one.** `projectPublishedTimeline`
  (`StoreContext.tsx:332-360`) is now the single post-transition projection, shared by 6 call
  sites (`hasUnsavedChanges: true` lives in exactly one place, `:358`).
- **Both escape hatches are deleted, not merely documented.** `UPDATE_LAYERS` is gone from the
  `Action` union. `addHistoryEntry` / `setHistoryIndex` are gone from `useHistory`. `saveLayerCanvas`
  is gone from `layer-utils.ts`.
- **An error boundary exists** (`src/components/Common/ErrorBoundary.tsx:82-99`, mounted at
  `App.tsx:80-86`). It was the one fully-undone Phase 0 item.
- **The presentation-bitmap leak is fixed** — `retireUnreferenced` runs on all four publication
  paths, liveness-vetoed.
- **The pin that asserted the cutover is _absent_ is gone.**
  `StoreContext.durable-boundary.test.tsx:441` still exists, but the `:602-633` "no replay
  coordinator in the store" block moved to `:572-603` and is now a _deliberate_ green regression
  guard on a decision, not a pin against unfinished work.

**What has not moved at all:**

- `materialization.ts` is still unmounted. **226 commits, zero importers.**
- The interleaved affine/filter ordering bug is still there (`materialization.ts:239-252`).
- One `error`-severity diagnostic still voids the entire durable shadow
  (`history-adapter.ts:732-741`).
- `ReplayRevisionToken` still has no `frameRevision` (`replay-coordinator.ts:1-10`).
- `materialization.ts` still applies no blend mode.
- `rasterize-layer` still has no writer anywhere.

---

## 2. The migration map

### 2.1 What is being migrated

The app is a browser-based Photoshop clone. Its undo/history system is the thing being rebuilt.

**Before** — a flat, mutable list of `HistoryItem`s. Each names an action and its args. Replay
means "run every item again, in order, onto an empty canvas." Problems: replay is O(history
length) in the main thread; an item that cannot be replayed loses information silently; raster
state is baked in early, so a vector layer cannot be resized after the fact; and there is nowhere
to put a diagnostic — the model either applied or it didn't.

**After** — an immutable, normalized **durable document**: a frozen layer tree with explicit
geometry (`DocumentFrame`), retained affine transforms separated from rasterization boundaries, a
content-addressed **asset registry** owning every `ImageBitmap` by lease and generation, and a
**durable replay** reducer that is a pure function from document + cursor to a materialized
presentation.

The point of the durable model is that it can be _validated_ — a conversion either produces a
faithful document or a diagnostic, never a silently-wrong one. That is the deliverable. Performance
was never the driver.

### 2.2 The two paths, side by side

| Concern         | Legacy path (**in production**)                                | Durable path (**shadow only**)                 |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Source of truth | `HistoryItem[]` in store state                                 | `DurableDocument` in store state               |
| Replay          | `useHistory.ts:81` → `replayHistory`                           | `replayDurableDocument` in `durable-replay.ts` |
| Output          | runtime `Layer[]` with `tmpCanvas`                             | materialized presentation bitmaps              |
| Render          | `layer-renderer.ts:65-95`                                      | `materialization.ts` — **unwired**             |
| PSD export      | `psd-utils.ts:241-251`, `layer.tmpCanvas ?? layer.bitmap`      | not reached                                    |
| Clipboard       | reads the visible canvas (`useSelectionClipboard.ts:45,93`)    | not reached                                    |
| Merge           | `useLayer.ts:647`, bare `createImageBitmap(canvasRef.current)` | not reached                                    |
| Validation      | none                                                           | `legacyHistoryToDurable` + diagnostics         |
| Authority       | **authoritative**                                              | shadow, write-only, never read for pixels      |

`StoreContext.durable-boundary.test.tsx:572-603` and `StoreContext.test.tsx:201-204` both **assert**
that `replayCoordinator`, `presentationMaterialization` and `getReplayRevisionToken` are absent from
the store, and both are green. This is now a deliberate guard on a decision that was taken — not a
pin against unfinished work.

### 2.3 Module inventory and wiring status

Derived from actual non-test importers at `f7757cf`. **Note the import form: this repo's imports end
in `.ts'` — `from './history-append.ts'`. Grepping `history-append'` returns nothing and is a false
negative.** That mistake produced two wrong readings during this audit.

| Module                                | Production importers                                                     | Verdict                     |
| ------------------------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `src/contexts/affine-transform.ts`    | renderer, hit-test, overlay, handles, `replayHistory`, PSD export        | **live**                    |
| `src/contexts/history-replay.ts`      | `useHistory.ts:81`, StoreContext                                         | **live** (legacy authority) |
| `src/contexts/history-model.ts`       | StoreContext, adapter, append, tests                                     | **live**                    |
| `src/contexts/history-adapter.ts`     | StoreContext, append, materialization                                    | **live**                    |
| `src/contexts/history-append.ts`      | `useLayer.ts`, `useSelectionHistory.ts`, `StoreContext.tsx`              | **live** (3 importers)      |
| `src/contexts/asset-registry.ts`      | `history-adapter.ts`, `materialization.ts`, `StoreContext.tsx`           | **live**                    |
| `src/contexts/layer-presentation.ts`  | `useLayer.ts`, `StoreContext.tsx`                                        | **live**                    |
| `src/contexts/selection-baseline.ts`  | `history-replay.ts`, `history-adapter.ts` — one rule, both sides         | **live**                    |
| `src/contexts/document-frame.ts`      | 32 non-test importers                                                    | **live**                    |
| `src/contexts/durable-replay.ts`      | `StoreContext.tsx:28` — called once at `:887` for layer _order_ only     | **near-dead**               |
| `src/contexts/materialization.ts`     | **none**                                                                 | **dead**                    |
| `src/contexts/replay-coordinator.ts`  | **none**                                                                 | **dead**                    |
| `src/contexts/replay-checkpoints.ts`  | **none**                                                                 | **dead**                    |
| `PUBLISH_DURABLE_REPLAY` action       | deleted in `2f051a0`. `grep -rn PUBLISH_DURABLE_REPLAY src` → **0 hits** | gone                        |
| `UPDATE_LAYERS` action                | deleted in `f6f5475`. Only surviving hit is a test comment               | gone                        |
| `addHistoryEntry` / `setHistoryIndex` | deleted in `f6f5475`                                                     | gone                        |
| `saveLayerCanvas`                     | deleted. `grep -rn saveLayerCanvas src` → **0 hits**                     | gone                        |
| `rasterize-layer` op kind             | declared `history-model.ts:107`, replayed, asset-collected               | **no writer anywhere**      |

### 2.4 Writer inventory — the thing Phase 1 is about

Counted from the tree at `f7757cf`. **"Publishes"** = the site supplies a durable entry (or a
store-side plan) so `decideDurableAppend` can return `published` instead of falling through to
`buildDurableDocument`.

| Writer                                           | Site                                           | Publishes?                  |
| ------------------------------------------------ | ---------------------------------------------- | --------------------------- |
| `REPLACE_DOCUMENT` (blank / upload / PSD import) | `useLayer.ts:180`, `useApp.ts:117`             | no                          |
| add layer (blank / image / tool creator)         | `useLayer.ts:205`                              | no (asset-bearing)          |
| raster flatten commit                            | `useLayer.ts:332`                              | no (asset-bearing)          |
| tool edits (filter / geometry / affine / raster) | `useLayer.ts:332`                              | no (asset-bearing)          |
| pending-preview tool commit sweep                | `useLayer.ts:401`                              | no (asset-bearing)          |
| remove layer                                     | `useLayer.ts:435`                              | no (needs layer retirement) |
| merge document                                   | `useLayer.ts:663`                              | no (asset-bearing)          |
| **rename / show / hide layer**                   | `useLayer.ts:457-477`                          | **yes**                     |
| **reorder layers**                               | `useLayer.ts:485` → `StoreContext.tsx:899-911` | **yes**                     |
| **crop (document frame)**                        | `useLayer.ts:622-636`                          | **yes**                     |
| **selection clear on tool switch**               | `useSelectionHistory.ts:133-143`               | **yes**                     |
| **selection create / move (gesture)**            | `useSelectionHistory.ts:289-299`               | **yes**                     |
| selection append `catch` fallbacks               | `useSelectionHistory.ts:149,305`               | no (planning threw)         |
| `APPLY_HISTORY_REPLAY`                           | `useHistory.ts:117`                            | n/a — replay authority      |

**5 publish, 5 reconvert, plus 2 `REPLACE_DOCUMENT` sites.** The five reconverting writers are all
asset-bearing, and all are blocked on **one** defect: the append fast path does not reconcile asset
ownership (`HANDOFF.md` §54). That is why gate 4 of
`history-migration-07-readiness-next-steps.md` is now realistically reachable.

**`durableStatus` staleness.** Only 4 reducer arms still set `'stale'`: `SET_SIZE`
(`StoreContext.tsx:467`), `SET_LAYERS` (`:481`), `ADD_LAYER` (`:497`), `BATCH_UPDATES` (`:538`).
**The first three have zero production dispatch sites.** The fourth has exactly one
(`useApp.ts:70`, `handleImageSave`). `887cdcc` removed the rest — every selection action, plus
`SET_ACTIVE_LAYER`, `SET_TOOL_NAME`, `SET_COLOR`, `SET_BACKGROUND_COLOR`.

### 2.5 What the append boundary actually does

`planHistoryAppend` is pure — no dispatch, no registry, no canvas, no bitmap
(`history-append.ts:24-316`). It returns one legacy `HistoryItem` plus either one equivalent durable
entry or an explicit diagnostic. `decideDurableAppend` (`:579-661`) then decides three ways:

| Outcome         | When                                                                                                             | Effect                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `published`     | same document, current revision, same branch, at the tip, no redo truncation, entry matches                      | extend the durable document; cursor advances by one and can only lag the legacy cursor |
| `preconditions` | undo-then-edit, replay, moved revision, different branch, `-1` not at the tip                                    | silent fall back to full reconversion                                                  |
| `mismatch`      | foreign id, wrong schema version, flipped `enabled`, wrong operation kind, rewritten frames, reordered layer set | fall back **+** append a `durable-append-mismatch` error                               |

Seven publication preconditions at `:588-606`, plus reorder order/sequence checks at `:623-639`.
The derivation of each durable entry is **shared with whole-timeline conversion** — `history-append`
calls `deriveSetDocumentFrameEntry` (`history-adapter.ts:255`), `deriveSetSelectionEntry` (`:312`)
and `deriveSetLayerPropertiesEntry` (`:387`) — so there is one rule per action name, not two.

Reorder is the deliberate exception: `reorderOrderAfterIntent` (`history-append.ts:229-246`) and the
converter's arm (`history-adapter.ts:604-619`) are **two implementations**, pinned against each other
by a parity test. See `history-migration-09` §Status and `HANDOFF.md` §15.

### 2.6 Commit map — what the migration actually was

Merged to `main` since the durable foundation was laid. Full `git log` in the repo; this is the
narrative.

| commit                          | what it did                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `46f1cb9`                       | `affine-transform.ts` as the single `{a,b,c,d,e,f}` composer; replaced baked-in raster resize with retained affine                                                                               |
| `0f11554`                       | **The foundation.** `history-model`, `history-adapter`, `durable-replay`, `materialization`, `replay-coordinator`, `replay-checkpoints`, `asset-registry`; conversion boundary in `StoreContext` |
| `323d664`                       | fail-closed conversion. **Added** `PUBLISH_DURABLE_REPLAY` and dispatched it from a `latestStateRef` fast path that bypassed React state                                                         |
| `cb1896d`                       | **The rollback, part 1.** `replayHistory` authoritative again                                                                                                                                    |
| `2f051a0`                       | **The rollback, part 2.** Deleted `PUBLISH_DURABLE_REPLAY`; introduced `layer-presentation.ts`                                                                                                   |
| `2d654eb`                       | `history-append.ts` (the boundary) and store-owned presentation promotion — **this is what resolved the gate the rollback chat named**                                                           |
| `de91a83`                       | The first real single-writer slice: crop publishes its planned durable entry                                                                                                                     |
| `f6f5475`                       | Deleted `UPDATE_LAYERS`, `addHistoryEntry`, `setHistoryIndex`, `saveLayerCanvas`; added `ErrorBoundary`; unified the commit projection                                                           |
| `d8f5d03`, `80eb207`, `f7c242c` | 11 Photoshop tools wired in — which is why `materialization.ts:156`'s `legacy-tool` throw is now a bigger problem than it was                                                                    |
| `887cdcc`                       | Stopped invalidating the durable shadow on non-history selection actions                                                                                                                         |
| `2dfc18e`                       | `set-layer-properties` publishes through one projection                                                                                                                                          |
| `7366e0e`, `6ca1ad5`, `c883c63` | `reorder-layers` publishes; dangling-anchor conversion defect found and fixed                                                                                                                    |
| `afc2bca`, `2597e6a`            | Presentation bitmaps retired when their layer leaves the record                                                                                                                                  |

**The rollback was correct engineering, not a failure.** `PUBLISH_DURABLE_REPLAY` was dispatched
from a path that bypassed React state and mutated runtime layers outside the reducer. The session
that found it recommended not proceeding, named the exact gate, and the next session resolved that
gate through the option it named (`2d654eb` + `de91a83`). The cost was documentation debt, not
technical debt — and that debt is now largely cleaned up (§7).

---

## 3. Verified production state at `f7757cf`

Traced from the code, and the gates measured today.

**What renders:** `layer-renderer.ts:65-95`, reading runtime `Layer` objects with `tmpCanvas`. Both
the staging canvas (`:121`) and the visible canvas (`:136`) are sized from `documentFrameSize`; the
frame origin is subtracted at draw time only (`:78-79`).

**What exports PSD:** `psd-utils.ts:241-251` → `drawLayerSource(layer.tmpCanvas ?? layer.bitmap)`.
Frame-translated offsets at `:221-227`, `:245-250`, which keep **full world bounds per layer** — this
is what makes the crop non-destructive through a PSD round trip (§5). No test anywhere passes a
third `documentFrame` argument to `savePsd`; all 15 call sites are two-argument.

**What merges:** `useLayer.ts:647` — a bare `createImageBitmap(canvasRef.current)`. This falsifies
handoff 08's §4.6 claim that "nothing else assumes the global exists." It is now _compensated_ —
`ADOPT_LAYER_BITMAPS` (`useLayer.ts:101-147`) gives the raster an owner and the bypass is documented
at `:89-99` — but the claim itself is still untrue.

**Gates, measured 2026-09-28 at `f7757cf`:**

| Gate                                      | Result                                                              |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `npm run tsc` (`tsc -b`, 3 project refs)  | **exit 0**                                                          |
| `npm run test` (vitest, jsdom)            | **236/236 files, 5816 passed, 0 failed, 32 expected-fail** (5848)   |
| `npm run test:e2e:unit` (vitest, node)    | **12/12 files, 831 passed, 0 failed**                               |
| `npm run lint:check`                      | **0 errors, 1 warning** (`RightPanelVisibility.tsx:51`)             |
| `npm run build`                           | **exit 0**                                                          |
| `npm run test:e2e` (playwright, headless) | **not run.** See `e2e/OPEN_PROBLEMS.md`; `AGENTS.md` forbids headed |

---

## 4. Open problems

### 4.1 P0 — still open

**Blocker 1 — `materialization.ts` has no production caller.** The whole point of the durable
pipeline is that one shared materialization path serves screen, export, clipboard, merge and the
pixel tools. Right now it serves nothing. Until it is wired, the durable model's correctness
guarantees protect no user-visible behaviour. **This is the next slice, and the three sub-claims
the previous version of this document made about it need correcting:**

- _"it duplicates `getLayerAffineTransform`"_ — **false**, and was false at `eb2160e` too. It imports
  and composes with `getAffineBounds` / `IDENTITY_AFFINE_TRANSFORM` / `multiplyAffineTransforms`
  (`materialization.ts:3-7`, `:109-116`).
- _"it duplicates `scaleVectorArgs`"_ — **right duplication, wrong file.** The real twin is
  `materialization.ts:125-145` (`vectorArgsForSize`) against `layer-renderer.ts:38-49`
  (`scaleVectorArgs`) — same `lineWidth * Math.sqrt(Math.abs(scaleX*scaleY))` rule at `:143`/`:42`.
  `materialization.ts` never contained a `scaleVectorArgs`.
- _"`materializePresentationBitmap` is in `materialization.ts`"_ — it is in `layer-presentation.ts:53`,
  and it is wired (`StoreContext.tsx:1121`). The two were conflated.

**Blocker 3 — the interleaved affine/filter ordering bug is pinned, not fixed.**
`materialization.ordering.test.ts:415`. Raster processors are now genuine segment boundaries
(`materialization.ts:264-276`, flush `:275`, tail `:291`), so it is **half-fixed**: within a segment
all affines still collapse into one `ctx.transform` (`:249`) and all filters into one `ctx.filter`
(`:247`).

**Worse: that pin is now _inert_.** It spies `HTMLCanvasElement.prototype.getContext` while
`materialization.ts` short-circuits to `OffscreenCanvas` (from `src/test/setup.ts`), so it observes
**zero canvas calls**. A correct fix to `materializeLayer` would be _forced to leave the pin in
place_ — it would start passing for the wrong reason. `HANDOFF.md` §2 records this.

**Blocker 4 — one `error` diagnostic voids the entire durable shadow.**
`history-adapter.ts:732-741`: `if (converted.diagnostics.some(d => d.severity === 'error')) {
transaction?.rollback(); return { status: 'unavailable', document: null, … } }`. One pen or curve
entry discards a correctly-computed cursor map for the whole document. Fail-closed is correct;
fail-closed this coarsely is not usable at scale. `HANDOFF.md` §4.

**Blocker 7 — `ReplayRevisionToken` has no `frameRevision`** (`replay-coordinator.ts:1-10`;
`grep -rn frameRevision src` → 0 hits), so a frame change cannot invalidate a token.
`DurableLayerSnapshot` likewise still has no `frame` field. Neither file has been touched since
`eb2160e`. `HANDOFF.md` §10.

**Blocker 8 — 5 of 10 history writers still reconvert the whole timeline.** §2.4.

### 4.2 P0 — closed since `eb2160e`

Recorded so nobody redoes them.

| Was                                                                                                             | Now                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Blocker 2** — ~20 reducer actions set `durableStatus:'stale'`, so the published path was inert in ordinary UI | **Fixed.** Only 4 arms stale-mark, 3 with zero dispatch sites. `887cdcc`                       |
| **Blocker 5** — no error boundary anywhere in the repo                                                          | **Fixed.** `ErrorBoundary.tsx:82-99`, mounted `App.tsx:80-86`                                  |
| **Blocker 6** — two implementations of the commit transition, already disagreeing on `hasUnsavedChanges`        | **Fixed.** `projectPublishedTimeline` (`StoreContext.tsx:332-360`), 6 call sites               |
| `UPDATE_LAYERS` — unguarded escape hatch in the public `Action` union                                           | **Deleted.** `f6f5475`                                                                         |
| `addHistoryEntry` — a live second-writer surface on the hook context                                            | **Deleted.** `useHistory.ts:160-167` returns six members, none a writer                        |
| The two false comments (`history-append.ts` "plan only… not published"; `useLayer.ts` "not published yet")      | **Both gone.** `history-append.ts:33-36` and `useLayer.ts:619-621` now state the real contract |
| `toolbar-mapping.ts` typechecked only transitively                                                              | **Fixed.** `tsconfig.app.json:33-39` includes it explicitly, with a rationale                  |
| Presentation bitmaps never released on layer delete                                                             | **Fixed.** `retireUnreferenced` on all four publication paths                                  |

### 4.3 P1 — still open

- **`materialization.ts` does not apply `blendMode`.** Opacity _is_ applied
  (`materialization.ts:162`, `ctx.globalAlpha = source.opacity`). There is **no
  `globalCompositeOperation` anywhere** in `materialization.ts` or `durable-replay.ts`; only the
  legacy renderer sets it (`layer-renderer.ts:101`). So the moment blocker 1 lands, every
  non-normal blend mode renders wrong. The field _is_ carried durably
  (`history-model.ts:60`), so the data is there and only the compositor is missing.
  `HANDOFF.md` §11.
- **`rasterize-layer` has no writer anywhere.** Declared `history-model.ts:107`, asset-collected
  `:166`, cloned `:250`, replayed `durable-replay.ts:122`, never produced. Either wire it or delete
  it. `HANDOFF.md` §12.
- **The append fast path does not reconcile asset ownership.** Full conversion does
  (`history-adapter.ts:742`); the incremental publish path does not
  (`history-append.ts:645-658`). **This is the single defect holding the 5 reconverting writers
  (§2.4) off the boundary.** `HANDOFF.md` §54.
- **An invalid `nextFrame` converts with no diagnostic.** The `SET_DOCUMENT_FRAME_ACTION` arm has no
  `else`, unlike the selection arm which throws deliberately (`history-adapter.ts:625-630`).
  `HANDOFF.md` §16.
- **A duplicate durable entry id has no second line of defence.**
  `validateTimeline` (`history-append.ts:278-298`) rejects an id already in the _legacy_ timeline,
  but nothing checks the _durable_ entry set. `HANDOFF.md` §17.
- **A dangling-anchor reorder still records a history entry.** All three models now agree to skip,
  but `moveLayerAfter` (`useLayer.ts:483-489`) dispatches the raw intent and the store appends the
  entry unconditionally (`StoreContext.tsx:876`) before `reorderLayersFromState` no-ops (`:391-392`)
  — so a move that did not happen still lands a `REORDER_ACTION` entry and sets
  `hasUnsavedChanges`. Not recorded in `HANDOFF.md`; found by the `history-migration-09` re-audit.
- **`materialization.ts` never yields within a single layer.** `materializeDocument` yields
  _between_ layers (`:340-345`); one layer's whole operation chain is uninterrupted.
- **Vector-layer resize under Transform is still wrong.** `transformToolArgsToAffine` keeps scale in
  the matrix (`affine-transform.ts:195-202`) and `Layer.pos` never changes, so
  `layer-renderer.ts:89` bitmap-stretches a re-rendered vector
  (`ctx.drawImage(bitmap, 0, 0, position.width, position.height)`). The plan
  `.kilo/plans/vector-friendly-transform-resize-plan.md` is untouched, and its success criterion
  `vector_resize_behavior` appears in no test.
- **The runtime raster boundary feeds an untransformed bitmap to pixel processors.**
  `useLayer.ts:557` — `const bitmap = layer.tmpCanvas ?? layer.bitmap;` — the _untransformed_
  source. The durable twin at `materialization.ts:270-275` does it correctly. **The two pipelines
  provably disagree on any transform-then-blur sequence.** Whoever wires blocker 1 must reconcile
  this first, or pixel-tool results will change on the day materialization goes live.
- **`psd-utils.ts` `savePsd` does not release materialization leases** — true but vacuous: it never
  acquires one. Lease discipline lives in `materializeDocument` (`materialization.ts:346-359`).
- **The materialization _cache_ has no branch sweep** — only byte/entry LRU eviction
  (`asset-registry.ts:436-444`). `AssetRegistry` exposes no size/stats accessor
  (`:121-130`), so cache ownership is not observable from a test.

### 4.4 A stale gate in `AGENTS.md` itself

**`AGENTS.md:324` is now false.** It reads:

> **DO NOT start single-writer cutover while `saveLayerCanvas()` promotes cached canvases outside
> reducer publication.**

`saveLayerCanvas` **no longer exists anywhere in `src/`** — `grep -rn saveLayerCanvas src` → 0 hits.
Cache promotion is now a reducer publication (`PROMOTE_LAYER_PRESENTATIONS`,
`StoreContext.tsx:506-519`) behind the store. The gate's premise was resolved by `2d654eb`, and
`2f051a0`/the follow-up slices removed the function entirely.

**An agent obeying `AGENTS.md:324` today would refuse to start the cutover for a reason that no
longer holds.** The other half of the same sentence — "the durable document is shadow-only" — _is_
still true. This is a one-line fix and it should be made, but it is the operator's call.

### 4.5 Known defects that are PINNED. Do not "fix" them casually.

An `it.fails(...)` is a tripwire: it passes today and **fails the moment the defect is fixed**, so a
fix must remove the pin in the same change. There are **32** (was 42 at `eb2160e`).

The migration-relevant ones:

| Location                                                                          | What it pins                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `materialization.ordering.test.ts:415`                                            | interleaved affine/filter grouping (blocker 3) — **and the pin is inert; see blocker 3**                                                                                                                                                                      |
| `StoreContext.durable-boundary.test.tsx:441`                                      | `REPLACE_DOCUMENT` retains the prior frame crop. **Real and open**: a replacement that omits both `documentFrame` and `totalSize` keeps the _previous document's_ crop. A cross-document frame leak (`StoreContext.tsx:570`)                                  |
| `tools/__tests__/text.test.ts:282`                                                | replaying text from a durable vector source without re-rasterizing                                                                                                                                                                                            |
| `useSelectionClipboard.layerViaCopy.test.tsx:203`                                 | canvas→document position translation. **Its own comment is stale** — it blames a `documentToCanvasPos` call at `useSelectionClipboard.ts:100` that now calls `canvasToDocumentPos` (correct). The pin expects neither the correct value nor the described bug |
| `StoreContext.durable-boundary.test.tsx:572-603`, `StoreContext.test.tsx:201-204` | **not** a pin against unfinished work — a deliberate green guard that the durable replay surface stays absent. Do not "fix" it by adding the surface without a decision                                                                                       |

`AGENTS.md` forbids every headed Playwright invocation outright. Do not flip the mode to fix a
failure; ask the operator to run `npm run test:e2e:headed` themselves.

### 4.6 Toolchain traps that still stand

- **`npx tsc` and `npx tsc --noEmit` type-check ZERO files** and exit 0. The root `tsconfig.json` is
  a solution stub (`"files": []`, `:6`); `npx tsc -p tsconfig.json --showConfig` prints
  `{"compilerOptions": {}}` plus three `references`. The npm script is still named **`tsc`**, there
  is still no `typecheck` script, and `.claude/settings.local.json` — untracked and globally
  gitignored, so no worktree can see it — still carries `"allow": ["Bash(npx tsc:*)"]`, which
  auto-approves the command that checks nothing. `tsconfig.json:2-6` now documents that this is by
  design and that `tsc -b` is authoritative. **Use `npm run tsc`.**
- **Do not add `tsc --force`.** Confirmed still true: no `tsconfig*.json` sets `composite`, all three
  set `noEmit: true` (`tsconfig.app.json:21`, `tsconfig.node.json:17`, `tsconfig.e2e.json:22`), and
  all three set `tsBuildInfoFile` under `node_modules/.tmp`. `tsc -b` therefore never takes the
  up-to-date skip path. The `tsBuildInfoFile` settings are dead configuration; the build is not
  incremental. Now written down at `tsconfig.app.json:2-7`.

---

## 5. The crop contract — non-destructive by requirement

> **The crop tool must be non-destructive: it is a "window" onto the document that does not delete
> any layer data.**

**Current state: SATISFIED, structurally.** Not incidentally — it is the shape of the code.

| Clause                                                    | Holds? | Evidence                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A crop changes the **frame**, never layer data            | ✅     | `applyDocumentCrop` (`useLayer.ts:612-640`) dispatches `updates: { documentFrame, totalSize }` and **nothing else** (`:634`). History args are exactly `{previousFrame, nextFrame}` (`:626`)              |
| No layer's pixels mutated, discarded, masked or resampled | ✅     | The commit path has **no layer write at all**. `updateLayerByTool` refuses `document-operation` outright (`useLayer.ts:315`)                                                                              |
| No re-rasterization or bitmap resize on crop              | ✅     | `drawLayersToCanvas` resizes only the staging and visible canvases (`layer-renderer.ts:121`, `:136`). The one frame-clipping re-materializer (`materialization.ts:296-318`) has zero production importers |
| Off-frame data stays intact, in the document              | ✅     | Not rendered (clipped at draw time only, `layer-renderer.ts:78-79`) but still in `layers`, still in the Layers panel, still world-space and hit-testable                                                  |
| Undo/redo restores the pre-crop state                     | ✅     | Frame-only entry; `history-replay.ts:91-97` reads `nextFrame` and `continue`s, never touching a layer; `useHistory.ts:112-130` republishes the untouched `layers` record                                  |
| **PSD round trip preserves off-frame pixels**             | ✅     | `psd-utils.ts:221-227` computes per-layer bounds as `presentation − frame` with **full world width/height**; `:245-250` writes each layer at its frame-translated offset                                  |
| Selections are never clamped or deleted by a frame change | ✅     | Selections are world-space and `updates` carries no `selections`. A selection fully outside the new frame stays active; its outline is drawn off-canvas                                                   |

**Positive evidence that this is structural, not accidental:**

- `history-adapter.ts:503` returns `null` for `document-operation` — the durable converter
  **manufactures no raster operation** for a crop.
- `durable-replay.ts:129-131` replays `set-document-frame` as `frame = operation.next` — there is no
  layer branch in the replay.
- `history-replay.ts:195` skips any `document-operation` tool action.
- `StoreContext.tsx:1014` retirement closes only bitmaps absent from `collectLivePresentationBitmaps`
  (`:718-737`); a crop leaves every layer bitmap referenced, so **nothing is closed**.

### Two gaps — neither destroys document data

1. **PNG/JPEG export emits only the cropped window, irreversibly.** `useFile.tsx:126` →
   `image-load-save-utils.ts:138-210` encodes the frame-sized canvas. A flat raster carries neither
   off-frame pixels nor a frame descriptor. **This is the one clause that does not hold**: data
   outside the frame is not recoverable _from an exported PNG/JPEG_. It is a property of the format,
   not a crop bug. Either scope the requirement to "in-document and PSD round-trip", or export a
   full-document composite plus a frame descriptor.

2. **`src/tools/crop.ts` is a destructive raster crop that is still registered.**
   `crop.ts:26-40` sets `canvas.width = width` and draws the sub-rect — a real pixel-destroying
   crop — registered at `toolProcessors.ts:145-149` with `imageProcessor: crop`. It is
   **unreachable today** (all 15 production `tempUpdateLayer` call sites are Move, Eraser, Smudge,
   CloneStamp, Burn, Gradient, Dodge, Sharpen, Colors, Blur, Levels, Transform, Fill — none crop).
   But what keeps it unreachable is _the absence of a caller_, not a check: `tempUpdateLayer`
   (`useLayer.ts:536-556`) guards `layer-operation` and `geometry` and has **no `document-operation`
   branch**. A single future crop call would raster-destroy a layer. **The compliant fix is to
   delete `crop.ts` and its `toolProcessors` entry, or add the same guard `useLayer.ts:315` has.**

### The proof is missing even though the behaviour is right

Seven tests this plan required still do not exist, five of them load-bearing: no test navigates or
branches across crops; no test undoes or redoes more than one; no test covers a non-zero frame
with both raster and vector layers plus clipping; hit-test is still mocked to a stub
(`MoveToolArea.test.tsx:21`); `useLayer.ts:315` — the guard that makes the contract hold — is
untested; **all 15 `savePsd` call sites are two-argument, so frame-translated PSD offsets have zero
coverage**; and there is **no e2e crop spec at all**.

---

## 6. The next slice

Ordered. Each is cheap relative to what it prevents.

1. **Reconcile the two raster boundaries, then wire `materialization.ts`.** This is blocker 1 and
   the whole remaining risk. Order matters: `useLayer.ts:557` feeds pixel processors the
   _untransformed_ source while `materialization.ts:270-275` does it correctly, and
   `materialization.ts` applies no blend mode. Wiring it as-is changes pixel-tool output and breaks
   every non-normal blend mode. Reconcile the composers (`materialization.ts:125-145` vs
   `layer-renderer.ts:38-49`), fix the boundary, add `globalCompositeOperation`, **then** wire.
2. **Fix the inert pin first** (`materialization.ordering.test.ts:415`). It observes zero canvas
   calls, so it will not fail when you fix blocker 3 and will not protect you while you do. Make it
   a real assertion, in the same change that fixes the ordering.
3. **Reconcile asset ownership on the append fast path** (`HANDOFF.md` §54). This one defect is what
   holds the 5 reconverting writers off the boundary. It is the highest leverage item on this list.
4. **Fix `AGENTS.md:324`** (§4.4). One line, and it currently blocks the cutover for a false reason.
5. **Close the crop gaps** (§5): delete the dead destructive `crop.ts` path or guard it; decide
   whether PNG/JPEG export must carry a frame descriptor.
6. **Then decide the cutover question before writing more durable code.** The honest options are
   (a) commit to wiring `materialization.ts` and finish it, or (b) freeze the durable model as a
   documented shadow, delete the dead modules, and spend the effort elsewhere. What is not
   acceptable is the current state: 3 dead modules, 1 dead operation kind, 5 unwired writers, and a
   shadow nothing reads for pixels. That is the most expensive option, because it looks like
   progress.
7. **Write a `WIRING.md`** listing, per module, its production importers — generated, not maintained
   by hand. The fact that three modules were dead was discoverable only by grepping importers, and
   during this audit the naive form of that grep (`history-append'` rather than `history-append.ts'`)
   produced two false "NONE" readings in thirty seconds.

---

## 7. Per-plan status

Every plan document in `.kilo/plans/` now carries a `## Status` section at its end, re-derived
against `main` @ `f7757cf`. **The `## Assessment by Space Bunny` tables inside them are frozen at
`eb2160e` and their `file:line` citations are stale — most resolve to a comment, a closing brace or
an import.** Read the `## Status` section; do not work from the tables.

| Plan file                                                      | Status summary                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history-migration-01-document-frame-crop-handoff.md`          | **In production, and the non-destructive contract holds.** What is missing is proof: 7 required tests, 5 load-bearing, still absent. Contains the full crop trace (§5)                                                                 |
| `history-migration-02-retained-transform-handoff.md`           | Data model in production and finished; **3 live behaviour defects untouched** — vector scale stretch, the untransformed raster boundary, the shared-module violation. All 5 acceptance tests beyond the matrix unit tests still absent |
| `history-migration-03-durable-replay-assets-handoff.md`        | Scaffolding complete and unchanged; **the durable path is still a shadow**. Its own `legacy-tool` blocker is now _bigger_: 11 new tool families landed and `materialization.ts:156` throws for every one                               |
| `history-migration-04-unit-test-hardening-plan.md`             | Coverage exists and still catches neither of the two defects that matter. **P1.10's pin is inert**; P1.13 legacy↔durable equivalence is the one wholly absent area                                                                     |
| `history-migration-05-followup-prompt.md`                      | Scope delivered, by a wider margin than the 90% score claimed. **Its non-goal L77 was overridden** — `saveLayerCanvas` was deleted                                                                                                     |
| `history-migration-05-safety-correctness-next-steps.md`        | Containment nearly done; **the cutover has not started**. Per-phase exit table and a stop-condition table, both re-derived. **Definition of Safe Completion is NOT met** (clauses 1, 5, 6)                                             |
| `history-migration-06-recommendations-lessons-summary.md`      | The 33% score is materially too low; honest re-score ~55–60%. Lesson **A** is now half-wrong; **D6 has been decided by the code** — selections are first-class durable history                                                         |
| `history-migration-07-readiness-next-steps.md`                 | Judgement holds: **all 5 cutover gates unmet**, and gate 1 has not moved a line. Its "Remaining blockers" list lost 2 of 5 entries. §Decision is now _enforced_ by two green tests                                                     |
| `history-migration-08-hardening-handoff.md`                    | The slice is on `main` and two later slices rewrote it. Every item its own audit marked ⛔ has landed. Residual value is historical                                                                                                    |
| `history-migration-08-phase1-writer-readiness.md`              | Substantially delivered, further along than 93% suggested. Contains the **re-derived current writer inventory**                                                                                                                        |
| `history-migration-09-durable-reorder-and-projection-audit.md` | 3 of 4 findings fixed, 1 documented-as-fixed. **Every `file:line` it cites into `StoreContext.tsx` and `history-adapter.ts` is already stale.** Found a real defect this audit missed (§4.3, dangling-anchor entry)                    |
| `HISTORY_MIGRATION_04_COMPLETION_STATUS.md`                    | **Do not read as a completion record.** Its central claim — that `StoreContext.durable-boundary.test.tsx` does not exist — is false; the file is 1075 lines / 30 tests                                                                 |
| `vector-friendly-transform-resize-plan.md`                     | Untouched. Referenced from the 02 status; not a history-migration document in itself                                                                                                                                                   |

**Two of these are self-inconsistent and say so in their own `## Status` section:** the consolidated
handoff asserts `PUBLISH_DURABLE_REPLAY` exists at lines 259, 482 and 578 while lines 797 and 839
correctly record its deletion; and plans 06 and 07 are byte-identical to `eb2160e` and have never
been updated.

---

## Appendix A — verification commands

```bash
# state
git log --oneline -1
git log --oneline origin/main..main
git status --short
git worktree list

# is a module actually wired?
# NOTE: imports end in .ts'  —  grepping "history-append'" is a FALSE NEGATIVE
grep -rln "history-append\.ts'" src --include="*.ts" --include="*.tsx" | grep -v "__tests__\|\.test\."

# the durable shadow's readers
grep -rn "durableDocument\|durableStatus\|durableDiagnostics" src --include="*.tsx" | grep -v __tests__

# pins
grep -rn "it\.fails(" src --include="*.ts" --include="*.tsx" | wc -l     # 32

# does a symbol still exist at all?
grep -rn "saveLayerCanvas\|PUBLISH_DURABLE_REPLAY\|UPDATE_LAYERS\|addHistoryEntry" src

# gates
npm run tsc              # NEVER bare `npx tsc` / `npx tsc --noEmit` — 0 files, exit 0
npm run lint:check
npm run test
npm run build
npm run test:e2e:unit
npm run test:e2e         # headless only. never :headed, --ui, --debug
```

## Appendix B — key file index

| path                                      | what it is                                                            |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `src/contexts/history-model.ts`           | canonical durable types + validation (live)                           |
| `src/contexts/history-adapter.ts`         | `HistoryItem[]` → durable document, with diagnostics (live)           |
| `src/contexts/history-append.ts`          | the single-writer append boundary (live, 3 importers)                 |
| `src/contexts/history-replay.ts`          | legacy replay — **production authority** (live)                       |
| `src/contexts/history-timeline.ts`        | `append` / `cursor` primitives (live)                                 |
| `src/contexts/affine-transform.ts`        | the single `{a,b,c,d,e,f}` composer (live)                            |
| `src/contexts/document-frame.ts`          | the only world↔canvas converter; 32 importers (live)                  |
| `src/contexts/asset-registry.ts`          | `ImageBitmap` leases, generations, budgets (live)                     |
| `src/contexts/layer-presentation.ts`      | `DocumentPresentationScope` — ownership + `retireUnreferenced` (live) |
| `src/contexts/selection-baseline.ts`      | the shared selection BASELINE rule, used by replay _and_ conversion   |
| `src/contexts/materialization.ts`         | shared materialize pipeline (**dead**)                                |
| `src/contexts/durable-replay.ts`          | pure durable replay reducer (**near-dead**: one order read)           |
| `src/contexts/replay-coordinator.ts`      | cooperative scheduling, revision tokens (**dead**)                    |
| `src/contexts/replay-checkpoints.ts`      | bounded checkpoint cache (**dead**)                                   |
| `src/contexts/StoreContext.tsx`           | single writer; owns the shadow; `projectPublishedTimeline` `:332`     |
| `src/contexts/useHistory.ts`              | navigation → `replayHistory`; returns 6 members, **none a writer**    |
| `src/contexts/useLayer.ts`                | tool commits, `applyDocumentCrop` `:612`, `mergeAllLayers` `:642`     |
| `src/contexts/layer-renderer.ts`          | the render path; the only real blend-mode application `:101`          |
| `src/contexts/psd-utils.ts`               | PSD export — **keeps full world bounds per layer** `:221-227`         |
| `src/tools/crop.ts`                       | **destructive raster crop, dead in production** — see §5 gap 2        |
| `src/components/Common/ErrorBoundary.tsx` | editor-level error boundary (live, `App.tsx:80-86`)                   |
| `src/components/DevStatusStrip/`          | the only durable-status reader — **DEV-only** `:62`                   |
| `e2e/OPEN_PROBLEMS.md`                    | pinned e2e defects, with evidence                                     |
| `HANDOFF.md`                              | the actionable problem list — 1360 lines, items to 65                 |
