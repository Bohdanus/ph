# MIGRATION_NEXT_STEPS_SUNDAY

**A complete map of the history-machinery migration, a 2-day chat inventory, and the prompt for
the next agent.**

- Audited at: `main` @ `eb2160e` (2026-09-27)
- Window covered: Kilo sessions 2026-09-24 00:00 → 2026-09-27 23:59 local
- Written: 2026-09-27
- Every `file:line`, commit hash and chat id in this document was read out of the working tree or
  the Kilo database on the date above. Line numbers drift — re-verify before editing.

---

## How to use this document

| If you want…                                                 | Read       |
| ------------------------------------------------------------ | ---------- |
| The short version of where the migration stands              | §1         |
| What the migration is, structurally                          | §2         |
| Which of the 8 handoffs are actually done                    | §2.5       |
| What every commit since 2026-09-24 did                       | §2.6       |
| Which Kilo chats did the work, and which ones mattered       | §3         |
| The step-3 and step-5 chats specifically, with commit hashes | §3.4, §3.5 |
| What is actually running in production right now             | §4         |
| What is broken, and what is already fixed on a branch        | §5         |
| What must NOT be "fixed"                                     | §5.4       |
| What I think is going wrong at a process level               | §6         |
| A ready-to-paste prompt to start the next session            | §8         |

§8 is self-contained. You can paste it into a fresh Kilo session and it will carry everything the
next agent needs.

### Companion document

`HANDOFF.md` (repo root) was rewritten on 2026-09-27 against the same tree and is the
**actionable** document: 22 numbered problems, each with a verified `file:line` and a concrete fix.
This document is the **map**: history, chat inventory, structure, and reasoning. Use `HANDOFF.md` to
pick the next task; use this one to understand why the situation is what it is.

Because `HANDOFF.md` was renumbered, the "HANDOFF.md item" references in §5.1 below use the **old**
numbering (1–6). In the current `HANDOFF.md` those six problems are items **7, 16, 17, 18, 21, 22**
and all six are listed in its §0 merge checklist.

### How much to trust this document

Claims are not equally well-supported. Stated plainly so you can re-check the weak ones first:

| Confidence                                                           | Which claims                                                                                                                                                                                                                                    | How to re-check                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Verified directly**                                                | every `file:line`, every commit hash and subject, the 14-dispatch-site count, the `durableStatus`/`base`-null chain, the 42 `it.fails` pins, the zero-importer findings, the `b027de3` delta, the worktree/branch list, the 3813/42 test counts | `git`, `grep`, `sed` — all reproduced in Appendix A                        |
| **Re-measured in this document**                                     | `npm run test` (173 files, 3813 pass, 42 xfail, 6.05 s)                                                                                                                                                                                         | run it                                                                     |
| **Read from another document, not re-derived**                       | the e2e counts (97 pass, 2 skipped, 0 failing), the `lint:check` 19-warning count, `HISTORY_MIGRATION_04_COMPLETION_STATUS.md`'s contents                                                                                                       | `e2e/OPEN_PROBLEMS.md`                                                     |
| **Derived by a stated method**                                       | the §3.2 thematic split (keyword CASE over session titles)                                                                                                                                                                                      | method and its known bias are in §3.2                                      |
| **Reported by one of the 11 audit subagents, not re-verified by me** | the 598-task completion scores in §2.5 and every per-task table in the plan files                                                                                                                                                               | read the appended `## Assessment by Space Bunny` section in each plan file |
| **Judgement, not finding**                                           | all of §6 and §7                                                                                                                                                                                                                                | argue with it                                                              |

**Two audit claims were wrong and are corrected above**, both caught by re-deriving rather than
relying: an audit said `materialization.ts` never applies `opacity` (it does, at `:155`), and the
writer inventory it produced did not reconcile with its own dispatch-site count (§2.4 is now counted
from the tree). A third, the `durableStatus` staleness chain, was reported by two subagents and I
initially failed to reproduce it — my grep pattern was wrong, not the claim. Treat §6 as arguable
and everything else as checkable.

---

## 1. Executive state

**The migration is roughly 75% built and 0% switched on.**

Five independent audits (one per plan document, run in parallel) scored 598 discrete tasks across
the 11 plan files. Weighted, that is **~75% complete**: 398 done, 105 partial, 56 not started,
25 diverged from plan, 14 unverifiable.

That number is misleading on its own, and the reason is the single most important fact in this
document:

> **The durable replay path is not in production.** Four of its five modules
> (`materialization.ts`, `durable-replay.ts`, `replay-coordinator.ts`, `replay-checkpoints.ts`) have
> **zero non-test importers**. `durableDocument` / `durableStatus` / `durableDiagnostics` are written
> by `StoreContext.tsx:686-786` and read by nothing outside that same file. Production still runs
> legacy `HistoryItem[]` → `replayHistory` → runtime `Layer` → `layer-renderer` → canvas.

So the migration produced two things: a working legacy path (unchanged in behaviour) and a large,
well-tested, entirely unwired durable shadow. The gap between "module exists and its tests pass"
and "the app calls it" is where all the remaining work lives.

**Other headline facts:**

- `main` is **10 commits ahead of `origin/main`**, unpushed. Working tree clean except untracked
  `HANDOFF.md`.
- **An unmerged branch already contains the fixes for 6 of the 9 open problems in `HANDOFF.md`.**
  See §5.1. Do not redo that work.
- 256 Kilo sessions ran in the 2-day window; 175 were subagents. **45% of session wall-clock time
  went to tests/lint/tsc and 29% to the migration itself** (§3.2). 10 git worktrees are checked out;
  7 of them are parked at an obsolete commit and can be deleted.
- The rollback of the durable cutover (commits `323d664` → `cb1896d` → `2f051a0`) was **correct
  engineering**, not a failure. §6.4 explains why.
- `HANDOFF.md` has been rewritten against this same tree into 22 numbered problems, and now leads
  with the `fix/unit-tests` merge. It is the actionable companion to this document.

---

## 2. The migration map

### 2.1 What is being migrated

The app is a browser-based Photoshop clone. Its undo/history system is the thing being rebuilt.

**Before** — a flat, mutable list of `HistoryItem`s. Each item names an action and its args. Replay
means "run every item again, in order, onto an empty canvas." Problems this causes:

- Replay is O(history length) on every undo/redo, in the main thread.
- Any item that cannot be replayed loses information silently.
- Raster state is baked in early, so a vector layer cannot be resized after the fact.
- There is no place to put a diagnostic — the model either applied or it didn't.

**After** — an immutable, normalized **durable document**: a frozen tree of layers with explicit
geometry (`DocumentFrame`), retained affine transforms separated from rasterization boundaries, a
content-addressed **asset registry** owning every `ImageBitmap` by lease and generation, and a
**durable replay** reducer that is a pure function from document + cursor to a materialized
presentation.

The point of the durable model is that it can be _validated_ — a conversion either produces a
faithful document or a diagnostic, never a silently-wrong one. That is the actual deliverable.
Performance was never the driver.

### 2.2 The two paths, side by side

| Concern         | Legacy path (**in production**)                                 | Durable path (**shadow only**)                 |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Source of truth | `HistoryItem[]` in store state                                  | `DurableDocument` in store state               |
| Replay          | `useHistory.ts:90` → `replayHistory`                            | `replayDurableDocument` in `durable-replay.ts` |
| Output          | runtime `Layer[]` with `tmpCanvas`                              | materialized presentation bitmaps              |
| Render          | `layer-renderer.ts:60-141`                                      | `materialization.ts`                           |
| PSD export      | `psd-utils.ts:241-251`, reads `layer.tmpCanvas ?? layer.bitmap` | not reached                                    |
| Clipboard       | reads the visible canvas                                        | not reached                                    |
| Merge           | `useLayer.ts:593`, bare `createImageBitmap(canvasRef.current)`  | not reached                                    |
| Validation      | none                                                            | `legacyHistoryToDurable` + diagnostics         |
| Authority       | **authoritative**                                               | shadow, write-only, never read                 |

`StoreContext.durable-boundary.test.tsx:602-633` actively **pins** this: it asserts that
`replayCoordinator`, `presentationMaterialization` and `getReplayRevisionToken` are _absent_ from
the store. Green tests are guarding the absence of the cutover.

### 2.3 Module inventory and wiring status

Derived from actual non-test importers at `eb2160e`.

| Module                                   | Created in                       | Production importers                                              | Verdict                           |
| ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| `src/contexts/affine-transform.ts`       | `46f1cb9`                        | renderer, hit-test, overlay, handles, `replayHistory`, PSD export | **live**                          |
| `src/contexts/history-replay.ts`         | `46f1cb9`                        | `useHistory`, StoreContext                                        | **live** (legacy authority)       |
| `src/contexts/history-model.ts`          | `0f11554`                        | StoreContext, adapter, append, tests                              | **live** (types + validation)     |
| `src/contexts/history-adapter.ts`        | `0f11554`                        | StoreContext, append, materialization                             | **live** (conversion runs)        |
| `src/contexts/history-append.ts`         | `2d654eb`                        | StoreContext, `useLayer`                                          | **live** (1 writer only)          |
| `src/contexts/asset-registry.ts`         | `0f11554`                        | `history-adapter`, `materialization`, StoreContext                | **live**                          |
| `src/contexts/layer-presentation.ts`     | `2d654eb`                        | StoreContext, `layer-utils`                                       | **live** (leaks, §5.2)            |
| `src/contexts/replay-coordinator.ts`     | `0f11554`                        | **none**                                                          | dead                              |
| `src/contexts/durable-replay.ts`         | `0f11554`                        | only `materialization.ts`                                         | dead                              |
| `src/contexts/materialization.ts`        | `0f11554`                        | **none**                                                          | dead                              |
| `src/contexts/replay-checkpoints.ts`     | `0f11554`                        | **none**                                                          | dead                              |
| `PUBLISH_DURABLE_REPLAY` action          | `323d664`, **deleted** `2f051a0` | —                                                                 | gone from HEAD                    |
| `saveLayerCanvas` (`layer-utils.ts:115`) | pre-existing                     | **none** (test-only)                                              | dead, removed on `fix/unit-tests` |
| `rasterize-layer` op kind                | `history-model.ts:107`           | declared, replayed, asset-collected                               | **no writer anywhere**            |
| `UPDATE_LAYERS` action                   | pre-existing                     | 0 production callers                                              | unguarded escape hatch            |

### 2.4 Writer inventory — the thing Phase 1 is actually about

Counted directly from the tree at `eb2160e`, by grepping for history-appending dispatches outside
`StoreContext.tsx` and outside tests:

| site                                                      | action                 | production caller                                           |
| --------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| `useLayer.ts:161, 279, 296, 360, 394, 418, 438, 578, 609` | `COMMIT_DOCUMENT_EDIT` | yes (9)                                                     |
| `useApp.ts:159`                                           | `COMMIT_DOCUMENT_EDIT` | yes                                                         |
| `useHistory.ts:52`                                        | `COMMIT_DOCUMENT_EDIT` | **no** — this is `addHistoryEntry`, zero production callers |
| `useHistory.ts:122`                                       | `APPLY_HISTORY_REPLAY` | yes                                                         |
| `useLayer.ts:135`, `useApp.ts:110`                        | `REPLACE_DOCUMENT`     | yes (2)                                                     |
| **total**                                                 |                        | **14 sites, 13 with production callers**                    |

Of those 13, exactly **1 is boundary-ready**: `applyDocumentCrop` (`useLayer.ts:556`) is the only
writer going through `planHistoryAppend` / `decideDurableAppend`. The other 12 reconvert the whole
timeline on every append, because `history-append.ts:102-106` returns
`unsupported-history-feature` for every action except `set-document-frame`.

Separately, **6 store actions that are not history writes still invalidate the durable document** by
setting `durableStatus: 'stale'` — `SET_ACTIVE_LAYER`, `COMMIT_SELECTION`, `CLEAR_SELECTIONS`,
`UPDATE_SELECTION`, `MARK_SELECTION_COPIED`, `SET_DURABLE_STATUS` (all present in the reducer). The
plan's writer inventory omits all six. They are the cause of blocker 2 below.

### 2.5 Handoff / plan inventory with audit scores

Every plan file in `.kilo/plans/history-migration-*` now carries an appended
`## Assessment by Space Bunny` section with a per-task table. Use those, not this summary, for
task-level detail.

| Plan file                                                 | Score    | Tasks   | ✅      | 🟡      | ⛔     | 🔀     | ❓     |
| --------------------------------------------------------- | -------- | ------- | ------- | ------- | ------ | ------ | ------ |
| `history-migration-01-document-frame-crop-handoff.md`     | 79%      | 39      | 26      | 6       | 3      | 3      | 1      |
| `history-migration-02-retained-transform-handoff.md`      | 80%      | 45      | 30      | 10      | 3      | 2      | 0      |
| `history-migration-03-durable-replay-assets-handoff.md`   | 74%      | 92      | 57      | 22      | 12     | 0      | 1      |
| `history-migration-04-unit-test-hardening-plan.md`        | 70%      | 28      | 12      | 14      | 1      | 1      | 0      |
| `history-migration-05-followup-prompt.md`                 | 90%      | 53      | 47      | 1       | 0      | 4      | 1      |
| `history-migration-05-safety-correctness-next-steps.md`   | 76%      | 73      | 45      | 20      | 5      | 3      | 0      |
| `history-migration-06-recommendations-lessons-summary.md` | 33%      | 30      | 5       | 10      | 4      | 3      | 8      |
| `history-migration-07-readiness-next-steps.md`            | 55%      | 19      | 9       | 3       | 6      | 1      | 0      |
| `history-migration-08-hardening-handoff.md`               | 90%      | 58      | 50      | 2       | 3      | 2      | 1      |
| `history-migration-08-phase1-writer-readiness.md`         | 93%      | 67      | 59      | 5       | 0      | 3      | 0      |
| `history-migration-consolidated-handoff.md`               | 68%      | 94      | 58      | 12      | 19     | 3      | 2      |
| **Total**                                                 | **~75%** | **598** | **398** | **105** | **56** | **25** | **14** |

Read the scores as a gradient, not a verdict: the 01/02/03 handoffs score 74–80% because they
describe work that _is_ in the production path. The 08 plans score 90–93% because they describe
work that is _module-complete but unwired_. A 93% on an unwired module is worth less than a 74% on
a live one.

Two documents are not in the table because they are not handoffs:
`.kilo/plans/HISTORY_MIGRATION_04_COMPLETION_STATUS.md` (stale — its headline claim that
`StoreContext.durable-boundary.test.tsx` does not exist is false; that file is 1105 lines / 30
tests) and `.kilo/plans/vector-friendly-transform-resize-plan.md` (an open, unimplemented plan).

### 2.6 Commit map — everything since 2026-09-24

23 commits. **10 are unpushed.** Classified by what they actually touched.

#### Production mechanics — replay these to understand the system's evolution

| hash      | when        | subject                                                                             | prod | test | what it did                                                                                                                                                                                                                                                        |
| --------- | ----------- | ----------------------------------------------------------------------------------- | ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `46f1cb9` | 09-24 20:08 | `refactor(transform): switch transform tool to retained affine operations`          | 16   | 0    | Introduced `affine-transform.ts` as the single `{a,b,c,d,e,f}` matrix composer, shared by renderer, hit-test, overlay, handles, `replayHistory` and PSD export. Replaced baked-in raster resize with retained affine. **+625/−90.**                                |
| `0f11554` | 09-24 20:54 | `feat(history): introduce durable document replay and asset registry system`        | 8    | 3    | The step-3 foundation. Created `history-model.ts`, `history-adapter.ts`, `durable-replay.ts`, `materialization.ts`, `replay-coordinator.ts`, `replay-checkpoints.ts`, `asset-registry.ts`; wired an atomic conversion boundary into `StoreContext`. **+2318/−25.** |
| `219fdb3` | 09-24 21:51 | `fix(replay): handle aborted signals and frame cloning in durable document replay`  | 3    | 0    | Abort-signal plumbing and `cloneDocumentFrame` into the coordinator. **+78/−26.**                                                                                                                                                                                  |
| `f11f7e7` | 09-24 22:40 | `fix(text-tool): stabilize text rendering and asset lifecycle during replay`        | 6    | 6    | Text-tool render stabilization; `useRect`/`rect.ts` normalization. **+1911/−32.**                                                                                                                                                                                  |
| `2d888d8` | 09-26 10:50 | `refactor(replay): gate document presentation on live revisions`                    | 0    | 7    | Test-only. Introduced the live-revision gating tests. **+1216.**                                                                                                                                                                                                   |
| `323d664` | 09-26 10:50 | `fix(history): fail closed on unsafe document conversion`                           | 15   | 6    | Fail-closed conversion. **Added** `PUBLISH_DURABLE_REPLAY` to the reducer and dispatched it from a `latestStateRef` fast path that bypassed React state. Tightened `isValidDocumentFrame` in `history-replay.ts`. **+1225/−382.**                                  |
| `cb1896d` | 09-26 18:44 | `fix(history): keep legacy replay authoritative and fail closed`                    | 6    | 0    | **The rollback, part 1.** Reverted `PUBLISH_DURABLE_REPLAY` as the authority; `replayHistory` became the sole replay path again. Pinned `hasUnsavedChanges: true` at the reducer. **+156/−159.**                                                                   |
| `2f051a0` | 09-26 22:56 | `fix(editor): stage replay presentation and drop dedicated circle/square tools`     | 28   | 40   | **The rollback, part 2 — and a large unrelated UI change.** Deleted `PUBLISH_DURABLE_REPLAY` entirely. Added `layer-presentation.ts` / `PUBLISH_RUNTIME_PRESENTATIONS`, dropped the dedicated circle/square tools, split `ShapeToolArea`. **+4767/−2218.**         |
| `2d654eb` | 09-27 09:24 | `fix(history): publish presentation caches through the store and plan appends once` | 9    | 0    | Created `history-append.ts` (the Phase-1 boundary) and `layer-presentation.ts` (the ownership scope). Presentation caches now flow through the store. **+623/−61.**                                                                                                |
| `de91a83` | 09-27 10:12 | `feat(history): publish the planned durable entry for document-frame changes`       | 4    | 2    | **The first real single-writer slice.** `applyDocumentCrop` hands its planned durable entry to `COMMIT_DOCUMENT_EDIT`; the store publishes it via `decideDurableAppend` when preconditions hold, and reconverts otherwise. **+624/−20.**                           |

#### Test-only or test-dominated — 58,549 insertions vs 13,543 for all production work

`58e72f7` (+2505), `a8dc316` (+3010), `0fcdfc3` (+218), `50bb2b8` (+7249), `2b1d4bf` (+11231),
`b3a0cdc` (+21481), `f240515` (+836), `92028a7` (+21), `2548335` (+11241), `2e1b6e4` (+79).

`b3a0cdc` alone added ~21.5k lines across 87 files. `2b1d4bf` added ~11.2k across 39.

#### E2E and infrastructure

`f0b939f` (headless default made enforceable, +306), `c40282f` (docs + CI hardening, +174),
`eb2160e` (locate the workspace canvas by test id, +198/−169).

#### LOC ratio — read this as a signal

| Category               | Insertions  |
| ---------------------- | ----------- |
| All production commits | **13,543**  |
| All test commits       | **58,549**  |
| Ratio                  | **4.3 : 1** |

Roughly 4.3× more test code was written than production code, and the test code is what pinned the
cutover _out_ of production. See §6.1.

---

## 3. Kilo chat inventory — last 2 days

### 3.1 Totals and model distribution

Window: 2026-09-25 14:00 → 2026-09-28 00:00 local, `directory LIKE '%/ph%'`.

|                                                   | count     |
| ------------------------------------------------- | --------- |
| Total sessions                                    | **256**   |
| Subagent sessions (title contains `(@…subagent)`) | 175 (68%) |
| Top-level sessions in the main repo               | 246       |
| Sessions in `.kilo/worktrees/*`                   | 10        |
| Longest single session                            | 628 min   |

| Model                                         | Sessions | Tier     |
| --------------------------------------------- | -------- | -------- |
| `kilo/stealth/space-bunny-alpha`              | 107      | frontier |
| `kilo/nvidia/nemotron-3-ultra-550b-a55b:free` | 74       | **free** |
| `openrouter/stealth/space-bunny-alpha`        | 20       | frontier |
| `kilo/poolside/laguna-s-2.1:free`             | 34       | **free** |
| `kilo/poolside/laguna-s-2.1` (paid)           | 10       | mid      |
| `openai/gpt-5.6-terra-fast`                   | 6        | frontier |
| `openai/gpt-5.6-luna-fast`                    | 1        | frontier |
| `openai/gpt-5.6-sol-fast`                     | 2        | frontier |
| `kilo/cohere/north-mini-code:free`            | 1        | **free** |

**109 of 256 sessions (43%) ran on explicitly free models**, almost all of them test-writing or
audit work. Only 9 sessions ran on a GPT-5.6 variant. The operator's stated preference — free models
in subagents, frontier models on core correctness — was followed, and the split in the transcript
is clean: free models wrote tests, frontier models did architecture.

### 3.2 Thematic inventory

**Method:** every session in the window was classified by a keyword CASE expression over its title,
run against the database. Counts and total wall-clock are therefore derived, not estimated — but
keyword classification is crude, and the caveat is stated below the table. Totals: **256 sessions,
8244 minutes (137 h) of session wall-clock.**

| Theme                     | Parents | Subagents | Worktree | Sessions | Session-minutes | Share of time |
| ------------------------- | ------- | --------- | -------- | -------- | --------------- | ------------- |
| **Tests / lint / tsc**    | 37      | 80        | 3        | **120**  | **3747**        | **45%**       |
| **History migration**     | 18      | 32        | 3        | **53**   | **2370**        | **29%**       |
| Photoshop fidelity        | 4       | 25        | 4        | 33       | 703             | 9%            |
| Review / audit / validate | 3       | 19        | 0        | 22       | 638             | 8%            |
| Other / meta              | 7       | 14        | 0        | 21       | 604             | 7%            |
| Docs / planning           | 1       | 2         | 0        | 3        | 106             | 1%            |
| E2E / Playwright          | 1       | 3         | 0        | 4        | 76              | 1%            |

**Caveat, stated because the table is misleading without it.** The E2E row is badly undercounted: the
Playwright suite was 73 files and +11,241 lines in one commit (`2548335`), but the sessions that
built it are titled things like _"Fix workspace-canvas P1 defect"_ and _"Fix CDP DPR spec defect"_,
which match no e2e keyword. Read the E2E row as 4, not 4. The other six rows are sound, and the
ordering is stable even if the boundaries wobble.

**The number that matters:** 45% of all session time went to tests, lint and tsc; 29% went to the
migration. That is a 1.55 : 1 ratio in _time_, and 4.3 : 1 in _lines committed_ (§2.6). Both point
the same way, and §6.1 argues about what it means.

### 3.3 Longest-running top-level sessions

| mins | session id                       | title                                                      |
| ---- | -------------------------------- | ---------------------------------------------------------- |
| 628  | `ses_f205222efffeUQVJxF4P8OoFX3` | `@@@ Phase 1 Writer Readiness migration`                   |
| 556  | `ses_f258fe418ffeOZR7e6k61J9byM` | `Clean up test coverage gaps doc`                          |
| 542  | `ses_f2580339dffep4wkCS84qdCcxz` | `!!! Improve phase02 durable replay migration issues doc`  |
| 330  | `ses_f212fb59affeW4Pc7UiESyGyix` | `--todo` (parallelised unit-test fix, prod code forbidden) |
| 308  | `ses_f229a7a5dffeDGhGqm6WIehvP9` | `Project infrastructure and build review`                  |
| 295  | `ses_f212cb057ffesstR34g55z4ovY` | `Refactor SidebarLeft tests and standardize timers`        |
| 257  | `ses_f2215e0d4ffe9B4SCT7WsKKFC7` | `Fix 12 failing useHistory tests` (worktree)               |
| 256  | `ses_f216acd68ffeO6tAElJOhn0Qxo` | `History migration durable replay and safety steps`        |
| 178  | `ses_f22c46380ffeBzFzhHhU1ZYZ9V` | `Planning unit test fixes from findings and gaps`          |
| 169  | `ses_f212ce825ffeQexdTHLT7vprvT` | `Add act() wrappers to LayersTab test clicks`              |

Note the shape: the two longest sessions produced documents, not production code.

### 3.4 STEP 3 — the durable replay assets chats

Step 3 = `history-migration-03-durable-replay-assets-handoff.md`. Implemented across four chats.
**Two of them landed as `0f11554`, the single most important commit in the series.**

---

#### `ses_f2b617cfaffen3JXld3HbI3xWP` — "Implement Handoff 3 durable replay assets migration"

- **Started** 2026-09-24 18:12:33 · **ended** 18:37:08 · 25 min · agent `code` · repo root
- **Prompt:** _"you are continuing big complex refactoring/migration of history mechanics. Handoff_01
  and handoff_02 … are implemented already … YOUR TASK is to IMPLEMENT HANDOFF 3 … be careful,
  systemic and thorough. Prioritise deep understanding, solid architecture and clear system design.
  IMPORTANT - deprioritise unit tests. Tests hardening will be done later."_
- **Did:** created the canonical immutable durable document/history model; legacy `HistoryItem`
  conversion with affine normalization, raster boundaries, frame/reposition separation, diagnostics
  and idempotent conversion; registry-owned asset leases with adoption/borrowing, generations, cache
  budgets and disposal; the pure durable replay reducer; a shared materialization pipeline with
  affine-then-filter ordering and frame clipping; a cooperative replay coordinator with stale
  revision guards; an optional bounded checkpoint cache; the `StoreContext` atomic conversion
  boundary; three focused test suites via subagents.
- **Self-reported validation:** `npm test` 65 files / 545 tests, `npm run lint`, `npm run tsc`,
  `npm run build` — all green.
- **Its own closing note:** _"Legacy runtime bitmap/rendering paths remain as compatibility
  projections for the next cutover stage; they were not removed prematurely."_ — this is the correct
  framing and it is the sentence the rest of the migration has been living inside ever since.
- **Commits:** the work landed as **`0f11554`** (8 prod + 3 test files, +2318/−25). The hash is not
  named in this chat's transcript — the commit was made in a nearby session.
- **Subagents:** `ses_f2b562367ffeLhbb6Fv6lSTMrN` (Test asset ownership), `ses_f2b560e08ffe4QJ0K1Ka5GoKvg`
  (Test durable conversion), `ses_f2b523909ffenNgeJm1wuZ7AUR` (Test replay coordinator).

---

#### `ses_f2b3274a5ffeJoUb0l71nkC3R5` — "History machinery migration architecture review"

- **Started** 2026-09-24 19:03:55 · **ended** 19:23:42 · 20 min · agent `code`
- **Role:** the post-hoc architecture review of step 3, and the chat that actually **names
  `0f11554` and `46f1cb9`** in its transcript (2 and 1 mentions respectively). This is where the
  commit was recorded.
- **Subagents:** `ses_f2b321ab0ffeYf9vdmXKsgxqD3` (Review durable model — cites `0f11554`),
  `ses_f2b3219aeffegBD2WQ17dvt04H` (Review replay coordinator — cites `0f11554` ×4, `46f1cb9`),
  `ses_f2b321985ffeHMZm2JZw6NweyP` (Review frame transforms — cites `0f11554` ×3, `46f1cb9` ×3).

---

#### `ses_f25b4c83bffeG38Z1dy60Y7Gx9` — "History migration step 3: durable replay assets"

- **Started** 2026-09-25 20:39:17 · **ended** 20:56:28 · 17 min · agent `code`
- **Prompt:** _"big migration of history machinery is in progress. Previous steps (status completed)
  are described here: `…-01-…`, `…-02-…`. YOUR TASK do step 3: `…-03-durable-replay-assets-handoff.md`
  … focus on system design and architecture. … No perfectionism - machinery must work and be solid.
  Don't address edge cases that are of low value/probability (flag them in todo comments)"_
- **Subagent:** `ses_f25b46f78ffephhoxbD5PWOr1D` (Inventory history seams, explore).
- **Did:** a _second_ pass over handoff 3, ending in a scope decision — the user was offered options
  and **selected "b"**. The chat's final message: _"Updated
  `.kilo/plans/history-migration-04-unit-test-hardening-plan.md` to make the next coding pass
  efficient: P0 only; P1 is explicitly deferred. Coverage-gap driven, extending existing focused
  suites only. Five phase-03 regression targets define the entire implementation scope. No broad
  matrices, duplicate tests, or opportunistic hardening."_
- **Significance:** this is the hinge. This chat converted step 3 from an implementation task into a
  **test-hardening** task, and everything after it is downstream of that decision. §6.1 revisits it.

---

#### `ses_f239bb005ffeL920YsFZZmcc71` — "History migration step 3: durable replay assets implementation"

- **Started** 2026-09-26 06:25:56 · **ended** 06:30:36 · 5 min · agent `code`
- **Prompt:** _"find kilo chat 'History migration step 3: durable replay assets'. read chat context
  and proceed with the task (history migration). don't read the tests or write the tests. Another
  agent is writing tests in the background (limited to just editing tests)"_
- **Did — verbatim from its closing message:**
  > Implemented production-side history migration containment.
  >
  > - Added transactional asset registration rollback for failed durable conversions.
  > - Added explicit durable sidecar status: `current`, `stale`, or `unavailable`.
  > - Prevented unsupported/failed conversion from retaining a stale or partial durable document.
  > - Marked runtime-only mutations as durable-stale and blocked them from replay-token authority.
  > - Fixed `SET_SIZE` so it no longer mutates `documentFrame`.
  > - Cancelled in-flight durable replay on size and tool changes.
  > - Durable navigation now preserves the visible canvas and reports diagnostics when conversion
  >   is unavailable.
  > - Awaited async immutable-raster document imports at UI entry points.
  > - Validation: `git diff --check` passed. No test files were edited; no tests, TypeScript, or
  >   lint commands were run.
- **Commits:** the durable-sidecar status vocabulary (`current` / `stale` / `unavailable`) lands in
  **`323d664`** (`fix(history): fail closed on unsafe document conversion`, 09-26 10:50, 15 prod
  files). This chat ran 06:25; the commit is 10:50. Same morning.
- **Significance:** this is the chat that introduced the `durableStatus` gate — and that gate is
  now the single biggest obstacle to the cutover. See §5.2, blocker 2.

---

### 3.5 STEP 5 — the safety/correctness and Phase-1 writer-readiness chats

Step 5 is split across two plan files: `history-migration-05-safety-correctness-next-steps.md`
(Phases 0–5) and `history-migration-05-followup-prompt.md`. Two chats implemented it.

---

#### `ses_f216acd68ffeO6tAElJOhn0Qxo` — "History migration durable replay and safety steps"

**This is the most consequential chat in the whole 2-day window.** It both repaired step 3 and
executed step 5.

- **Started** 2026-09-26 16:38:34 · **ended** 20:54:14 · **256 min** · agent `code`
- **Prompt:** _"powerful GPT model was doing (maybe finalising) step 3 of history migration, see doc:
  `…-03-durable-replay-assets-handoff.md`; work was done on kilo chat
  `ses_f2333b0b3ffe13RDFLqG2DDyhI`; then Laguna and other weak models did test hardening and maybe
  caused some regression. Ignore test changes since tests are still poor and unreliable. DETAILED
  INFO ON POSSIBLE REGRESSIONS caused by test-writing agents
  `.kilo/prod-code-changes-since-consolidation.md` … **Next steps: 1. fix prod code if needed 2.
  advance to next step: `…-05-safety-correctness-next-steps.md`** … At the end, provide
  recommendation and create a prompt for followup work (save prompt as a file)"_
- **Subagents:** `ses_f216a3045ffe4ynX0uHJDivZc5` (Audit production regressions, explore — cites
  `0f11554`, `219fdb3`, `2d888d8`, `323d664`, `46f1cb9`, `f11f7e7`, `a8dc316`, `0fcdfc3`),
  `ses_f216a3043ffeS4NRsqvbflA185` (Scope Phase zero, explore).

**What it did — verbatim from its closing message:**

> **Completed**
>
> - Restored `StoreContext.tsx` safety state and removed dead durable-publication/coordinator wiring.
> - Added structured durable diagnostics and transactional conversion fallback.
> - Added exact-once asset-scope disposal plus reachable-asset reconciliation.
> - Made runtime rendering stage before replacing the visible canvas.
> - Contained open/new/export/clipboard failures.
> - Fixed immutable durable-history toggling and clipboard layer fallback typing.
> - Contained `saveLayerCanvas()` promise failures.
>
> **Recommendation**
> Do not start the single-writer cutover yet. The remaining gate is `saveLayerCanvas()`
> asynchronous cache promotion mutating runtime layers outside reducer publication. Resolve it
> through document-scoped presentation ownership or a typed presentation action first.
>
> Updated follow-up prompt: `.kilo/plans/history-migration-05-followup-prompt.md`
>
> **Validation** … No unit tests were read, written, or run. Repository-wide `npm run tsc` remains
> blocked by unrelated test-file errors.

- **Commits — this chat produced the rollback:**
  - **`cb1896d`** `fix(history): keep legacy replay authoritative and fail closed`
    (09-26 18:44, 6 prod files, +156/−159) — reverts `PUBLISH_DURABLE_REPLAY` as authority; both
    `0fcdfc3` and `cb1896d` are named in this transcript.
  - **`2f051a0`** `fix(editor): stage replay presentation and drop dedicated circle/square tools`
    (09-26 22:56, 28 prod + 40 test, +4767/−2218) — **deletes `PUBLISH_DURABLE_REPLAY` entirely**
    and introduces `layer-presentation.ts`. Committed later the same evening, after the chat ended
    at 20:54, via `ses_f207f0527ffedf0tOmpIEFcanv` ("Stage prod code changes and commit with husky
    disabled", 09-26 20:56 → 21:28).
- **The `npm run tsc` claim in its closing message is now false.** `tsc` exits 0 today. This is
  recorded as a stale statement in §5.5.

**Its recommendation was correct and it was honoured.** The gate it named —
`saveLayerCanvas()` mutating runtime layers outside reducer publication — was resolved by
`2d654eb` + `de91a83` the next morning, via document-scoped presentation ownership, which is
exactly the option it named.

---

#### `ses_f205222efffeUQVJxF4P8OoFX3` — `@@@ Phase 1 Writer Readiness migration`

- **Started** 2026-09-26 21:45:08 · **ended** 2026-09-27 08:12:59 · **628 min (10.5 h)** · agent `code`
  · the longest session in the window
- **Prompt:** the entire prompt was _"implement `.kilo/plans/history-migration-05-followup-prompt.md`
  carefully"_
- **Cites in transcript:** `2b1d4bf` ×2, `b3a0cdc` ×2, `2f051a0`, `50bb2b8` ×18, `a8dc316` ×2,
  `cb1896d` ×2.

**What it did — verbatim from its closing message:**

> Merged and improved. `main` is 6 commits ahead of `origin/main`, working tree clean, all gates
> green.
>
> **The merge.** The branch rebased onto your two test commits without conflict, but the _contract_
> diverged in three places, all in suites that landed with your test work:
>
> | Suite                                             | Contract it pinned                                                     | Resolution                                                                                        |
> | ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
> | `layer-utils.createLayerSource.test.ts` (3 sites) | `createLayerSource` materializes the canvas; `deferSave` suppresses it | Now stages only; `deferSave` removed; 3 tests renamed to state that                               |
> | `useLayer.creation.test.tsx`                      | flatten commit keeps `tmpCanvas` = the raster                          | Asserts the published outcome: canvas released, layer carries the materialized cache              |
> | `layer-utils.test.ts`                             | `saveLayerCanvas` adopts/clears, closes on race, throws synchronously  | Materialize-and-return contract; the race case moved to the store suite where the guard now lives |
>
> **The improvement slice** (the first item from the handoff plan, now landed): the append boundary
> is no longer plan-only. `applyDocumentCrop` hands its planned durable entry to
> `COMMIT_DOCUMENT_EDIT`, and the store publishes it instead of reconverting the timeline — but only
> when the durable document still describes exactly the timeline the plan was made against. The
> decision is three-way so a normal situation and a defect stay distinguishable:
>
> - `published` — same document, current document revision, same branch, append at the tip, no redo
>   truncation, entry matches → extend the durable document, cursor advances by exactly one and can
>   only lag the legacy cursor.
> - `preconditions` (fall back silently) — undo-then-edit, replay, moved revision, different branch.
> - `mismatch` (fall back + `durable-append-mismatch` error) — foreign id, wrong schema version,
>   flipped `enabled`, wrong operation kind, rewritten frames.
>
> Also found and fixed while writing the fallback test: `APPLY_HISTORY_REPLAY` threw inside the
> dispatcher when `updates` was absent; it now degrades to a navigation no-op.
>
> **Verification:** 19 new decision/validation cases in `history-append.test.ts`, 8 store-level
> cases in the new `StoreContext.durable-append.test.tsx` (including a control proving the published
> document is structurally identical to the full conversion's). `npx tsc -b --force` clean, `npx
eslint src` 0 errors, `npm run build` green, full suite 173 files / 3811 passed / 42 expected
> failures. One flake appeared in a single full run right after the slice landed and did not
> reproduce in 3 subsequent full runs or 5 targeted runs; I failed to capture which file, so I'm
> not attributing it.
>
> **Docs:** both in `.kilo/plans/` (the readiness doc's next slice is now `set-layer-properties` +
> `reorder-layers`; the handoff has the new §7). Two housekeeping notes: `main` is unpushed, and the
> now-fully-merged `.kilo/worktrees/history-migration-08` worktree can be deleted whenever you want.

- **Commits — this chat produced the first genuine single-writer slice:**
  - **`2d654eb`** `fix(history): publish presentation caches through the store and plan appends once`
    (09-27 09:24, 9 prod files, +623/−61) — created `history-append.ts` and
    `layer-presentation.ts`.
  - **`f240515`** `test(history): cover the presentation boundary and the append boundary`
    (09-27 09:24, 5 test files, +836/−29).
  - **`92028a7`** `test(history): absorb the presentation contract into the merged suites`
    (09-27 10:04, 2 test files, +21/−16).
  - **`de91a83`** `feat(history): publish the planned durable entry for document-frame changes`
    (09-27 10:12, 4 prod + 2 test, +624/−20).
- **Housekeeping it reported, still outstanding:** `main` unpushed (now 10, not 6) and the
  `history-migration-08` worktree is now parked at `92028a7` and can be deleted.
- **Its honest disclosure** — _"I failed to capture which file, so I'm not attributing it"_ — is
  worth preserving as a practice. A flake that cannot be named cannot be closed.

---

#### Supporting step-5 sessions

| id                               | when                  | what                                                                                                                                                                                                                                       |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ses_f2315c4daffe4dxAAASRRfu77V` | 09-26 08:52 (14 min)  | Read `history-migration-consolidated-handoff.md`, did feature hardening. Its prod changes are catalogued in `.kilo/prod-code-changes-since-consolidation.md` §1 and audited in `ses_f219b7423ffekqeN0Rhx4XMOR0` (7 mentions of `0f11554`). |
| `ses_f212fb59affeW4Pc7UiESyGyix` | 09-26 17:43 (330 min) | `--todo` — parallelised unit-test fix. Hard constraint in the prompt: _"HARD LIMITATION: focus on unit tests only. NEVER change prod source code."_ Names `2f051a0`, `50bb2b8`, `cb1896d` ×7, `f11f7e7` ×4.                                |
| `ses_f207f0527ffedf0tOmpIEFcanv` | 09-26 20:56 (33 min)  | Staged and committed the prod-code changes with husky disabled → `2f051a0`. 8 test-only subagents.                                                                                                                                         |
| `ses_f205c7098ffeNlac07PRx4ejHB` | 09-26 21:33 (121 min) | Generated commit messages excluding tests and docs → `50bb2b8`.                                                                                                                                                                            |

### 3.6 Other notable sessions

| id                               | when                  | what it produced                                                                                                                                                                                                                   |
| -------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ses_f2677982affeyq0HQuG2uO04Ee` | 09-25 17:06           | "History migration **phase 04** architecture work" — the follow-on from step 3 into phase 4. 4 explore/general subagents auditing durable conversion, asset lifecycle, migration integration, and replay cutover.                  |
| `ses_f2580339dffep4wkCS84qdCcxz` | 09-25 21:36 (542 min) | "Improve phase02 durable replay migration issues doc" — the 4 h/9 m session that produced `.kilo/issues/phase02-durable-replay-migration-issues.md` (39 issues).                                                                   |
| `ses_f2333b0b3ffe13RDFLqG2DDyhI` | 09-26 08:19           | "History migration plan consolidation" → `history-migration-consolidated-handoff.md`. The consolidation point named by `ses_f216acd6`.                                                                                             |
| `ses_f2135bdebffeJHnPRHaA0uwMIj` | 09-26 17:36           | "Investigating unauthorized StoreContext…" — an incident chat. A subagent had modified `StoreContext.tsx` against the "tests only" rule; see also `ses_f2134d209ffe6pcixeJuK3KLFK` (6 mentions of `cb1896d`). Names `cb1896d` ×17. |
| `ses_f1d78a3a0ffe6KwintzsxHGx3y` | 09-27 11:01           | "Merge latest main into tools improvements branch" — cites all 4 e2e commits, `de91a83`, `2d654eb`, `50bb2b8`, `92028a7`.                                                                                                          |
| `ses_f1cc60a69ffes0kT5wrXiD83xa` | 09-27 14:17           | "Review unmerged branch against main" — the `ps-transform-geometry` review. Led to subagents reviewing homography math, `transform.ts` integration parity, new test quality, and merge/integration.                                |

### 3.7 Worktree sessions and unmerged branches

`git worktree list` — 15 worktrees, of which **7 are parked at the obsolete commit `f11f7e7`**
(09-24 22:40) and are dead weight: `fix-history-adapter-safety-tests`, `fix-layerstab-tests`,
`fix-replay-coordinator-tests`, `fix-useapp-psd-tests`, `fix-usehistory-tests`, `fix-userect-tests`.
Delete these six plus `polished-ironclad` (detached at `50bb2b8`).

Branches with commits not on `main`:

| branch                                                                            | worktree                                | ahead | HEAD                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `fix/unit-tests`                                                                  | `.kilo/worktrees/fix-unit-tests`        | **2** | `b027de3` `fix(history): stop a departed layer's cache from being closed or stranded`      |
| `ps-integration`                                                                  | `.kilo/worktrees/ps-integration`        | 3     | `a0f66c4` `merge: main (e2e suite, history publication) into ps-integration`               |
| `ps-transform-geometry`                                                           | `.kilo/worktrees/ps-transform-geometry` | 1     | `a3f9050` `fix(transform): unify raster CTM order and warp trapezoid through a homography` |
| `photoshop-fidelity`, `ps-shape-geometry`, `ps-ux-chrome`, `history-migration-08` | —                                       | 0     | fully merged; safe to delete                                                               |

---

## 4. Verified production state at `eb2160e`

Traced from the code, not from the plans.

**What renders:** `layer-renderer.ts:60-141`, reading runtime `Layer` objects with `tmpCanvas`.

**What exports PSD:** `psd-utils.ts:241-251` → `drawLayerSource(layer.tmpCanvas ?? layer.bitmap)`.
Frame-translated offsets are implemented at `psd-utils.ts:221-250`, but **no test anywhere passes a
third `documentFrame` argument to `savePsd`** — a decision handoff 01 explicitly required, verified
by zero tests.

**What merges:** `useLayer.ts:593` — a bare `createImageBitmap(canvasRef.current)`. This falsifies
handoff 08's §4.6 claim that "nothing else assumes the global exists."

**What the clipboard copies:** the visible canvas.

**What the durable shadow does:** `StoreContext.tsx:686-786` computes `durableDocument`,
`durableStatus` and `durableDiagnostics` on every commit. Nothing outside `StoreContext.tsx` and
its tests reads them. `durableDiagnostics` and `durableStatus` have **no reader anywhere in
`src/components/**`**, and there is no feature-flag mechanism in `src/` at all — so the
"diagnostics are the only durable signal the UI reports" claim in handoff 08 is unsupported. A
`durable-append-mismatch` error is invisible to the user.

**Current gate status on `main`:**

| gate                                      | result                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run tsc` (`tsc -b`, 3 project refs)  | exit 0                                                                                                         |
| `npm run lint:check` (eslint + prettier)  | 0 errors, 19 pre-existing warnings                                                                             |
| `npm run test` (vitest 5.0.2, jsdom)      | 173/173 files, **3813 passed, 42 `it.fails` expected**, 3855 total, 6.05 s — **re-measured for this document** |
| `npm run test:e2e:unit` (vitest, node)    | 693 passed / 2 expected-fail, 10 files — _reported, not re-measured_                                           |
| `npm run test:e2e` (playwright, headless) | 97 pass, 2 skipped by declaration, none failing — _reported in `e2e/OPEN_PROBLEMS.md`, not re-measured_        |
| `npm run build`                           | green                                                                                                          |

---

## 5. Open problems

### 5.1 P0 — ALREADY FIXED on `fix/unit-tests`. Do not redo this.

`HANDOFF.md` (untracked, 301 lines, written 09-27 11:46) lists 9 open problems. **Six of them are
already fixed on the unmerged `fix/unit-tests` branch**, at `b027de3`:

> `b027de3 fix(history): stop a departed layer's cache from being closed or stranded`
> `5da9f82 test(core): close the gaps the merged suite was asserting around`

`b027de3` touches 10 files, +802/−111, of which 5 are production:
`StoreContext.tsx` (74), `layer-presentation.ts` (79), `history-adapter.ts` (63),
`history-append.ts` (23), and `layer-utils.ts` (function removed).

| `HANDOFF.md` item                                                       | Status on `fix/unit-tests` | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.** Presentation bitmaps never released on layer delete              | **FIXED**                  | New `retireDepartedLayers(before, after)` in `StoreContext.tsx`, driven off the layer set-difference, never off `deletedLayers`; called for both the commit path and the replay path. Retires the _current_ layer's bitmap so a borrowed raster is never double-closed.                                                                                                                                                                |
| **2.** Refused publication dropped with `console.debug`                 | **FIXED**                  | `console.error('Refused a runtime presentation publication that also changes durable layer state')`.                                                                                                                                                                                                                                                                                                                                   |
| **3.** Invalid document frame converts with no diagnostic               | **FIXED**                  | The `SET_DOCUMENT_FRAME_ACTION` branch gained an `else` that pushes a `severity: 'warning'`, `code: 'invalid-history-entry'` diagnostic explaining that the legacy history remains authoritative for that frame change.                                                                                                                                                                                                                |
| **4.** `saveLayerCanvas` is dead in production                          | **FIXED**                  | `saveLayerCanvas` no longer exists in `layer-utils.ts` on that branch, and the now-unused `materializePresentationBitmap` import went with it (required — `tsconfig.app.json:27` sets `noUnusedLocals`).                                                                                                                                                                                                                               |
| **5.** The comment justifying the discarded append diagnostics is false | **FIXED**                  | `useLayer.ts:563-567` rewritten to state the current single-writer contract: the store publishes the plan when `decideDurableAppend` accepts it and reconverts otherwise, so the boundary's diagnostics are redundant on the happy path, with a cross-reference to `history-append.ts` for the "reporting never blocks the append" invariant.                                                                                          |
| **6.** Duplicate durable entry id has no second line of defence         | **FIXED**                  | `publishedEntryIds: Set<string>` in `history-adapter.ts`, scoped to ids that actually reached `entries`, with a long comment explaining why uniqueness is enforced at the one place a durable id is minted. The offending entry is **skipped** (not thrown) and the diagnostic is `error` rather than `warning`. Plus a test: _"withholds the shadow through the safe entry point, so a duplicate id never yields a usable document"_. |

**Action: merge `fix/unit-tests` into `main` first, then delete these six from the problem list.**
They are items 7, 16, 17, 18, 21, 22 in the rewritten `HANDOFF.md`, and its §0 merge checklist is
authoritative over this table. Do not work them from this document.

### 5.2 P0 — genuinely still open

Ordered by what blocks the cutover.

**Blocker 1 — `materialization.ts` has no production caller.**
The whole point of the durable pipeline is that one shared materialization path serves screen,
export, clipboard, merge and the pixel tools. Right now it serves nothing. Until it is wired, the
durable model's correctness guarantees protect no user-visible behaviour. This is _the_ next slice.
Note that two independent affine/filter composers exist — `materialization.ts:102-138` duplicates
`getLayerAffineTransform` and `scaleVectorArgs` — which violates the "never independently
approximate in different files" rule and is a trap for whoever wires it.

**Blocker 2 — the single-writer publish path is defeated in ordinary UI.**
`StoreContext.tsx:654` gates publication on `durableStatus === 'current'`. The reducer sets
`durableStatus: 'stale'` for roughly twenty action types, including `SET_ACTIVE_LAYER` (`:327`),
`SET_TOOL_NAME` (`:314`), `SET_TOOL_DIRTY` (`:316`), `SET_COLOR` (`:451`), `SET_BACKGROUND_COLOR`
(`:453`), and every selection action from `SET_SELECTIONS` (`:457`) through `CLEAR_SELECTIONS`
(`:509`). `history-append.ts:221` then returns `outcome: 'preconditions', reason: 'the durable
document is unavailable'` and the store silently reconverts the whole timeline. `durableStatus` only
returns to `'current'` via a successful conversion.

So: **two consecutive crops publish. A crop after any layer click, tool switch, colour change, or
selection action reconverts everything.** Nothing surfaces the difference — `preconditions` is a
silent fallback by design, and `durable-append-mismatch` is only emitted on the `mismatch` outcome.
Tests miss it because they reach the published path through `UPDATE_LAYERS`, which has no production
caller. The fix is to stop treating a _selection_ as invalidation of the _durable document_, not to
weaken the gate.

**Blocker 3 — the interleaved affine/filter ordering bug is pinned, not fixed.**
`materialization.ordering.test.ts:415` is `it.fails('applies interleaved affine and filter
operations in original order, not grouped by type')`. Raster processors are now genuine segment
boundaries (`materialization.ts:257-284`), so it is **half-fixed**: intra-segment interleaving is
still grouped. Handoff 03 and the consolidated handoff both gate Phase 3 on this. Fixing it must
remove the pin in the same change.

**Blocker 4 — `convertLegacyHistorySafely` voids the entire shadow on the first error diagnostic.**
`history-adapter.ts:573-581` (pre-`b027de3`). One pen or curve history entry discards a
correctly-computed cursor map for the whole document. That is a fail-closed choice, but it is
fail-closed far too coarsely to be usable at scale.

**Blocker 5 — no error boundary exists anywhere.**
Zero hits for `componentDidCatch` in the repo. The sibling Phase 0 item (P0-D) is the one Phase 0
entry fully undone, and it is the one that would have contained the `2f051a0`-class regressions.

**Blocker 6 — two implementations of every commit transition in `StoreContext`.**
The dispatcher's hand-built `latestStateRef.current` (`:686-696`, `:725-740`) omits
`hasUnsavedChanges: true`, which the reducer sets (`:406`, `:429`). Latent today — no reader — but
it is a second source of truth for the same state, and it is exactly the kind of divergence that
`b027de3`-style fixes then have to chase.

**Blocker 7 — `ReplayRevisionToken` has no `frameRevision` field** (`replay-coordinator.ts:1-10`), so
a frame change cannot invalidate a token. `DurableLayerSnapshot` likewise still has no `frame`
field, contradicting the consolidated handoff's own drift note.

**Blocker 8 — 12 of the 13 live writers still reconvert the whole timeline.** The boundary
(`history-append.ts:102-106`) returns `unsupported-history-feature` for every action except
`set-document-frame`. The next slices named by the readiness docs are `set-layer-properties` and
`reorder-layers`.

### 5.3 P1 — correctness and robustness

- **`StoreContext` merge path calls `createImageBitmap` bare** (`useLayer.ts:593`), bypassing the
  presentation scope entirely. This is the second half of blocker 1.
- **`materialization.ts` does not apply `blendMode`.** Opacity _is_ applied
  (`materialization.ts:155`, `ctx.globalAlpha = source.opacity`) — an audit claimed both were missing
  and only the blend-mode half is true. There is no `globalCompositeOperation` anywhere in
  `materialization.ts` or `durable-replay.ts`; only the legacy renderer sets it
  (`layer-renderer.ts:96`). So the moment item 1 lands, every non-normal blend mode renders wrong.
- **`rasterize-layer` has no writer anywhere.** Declared in `history-model.ts:107`, replayed,
  asset-collected, never produced. Either wire it or delete it.
- **`UPDATE_LAYERS` is an unguarded escape hatch** in the public `Action` union (`:144`, reducer
  `:344-354`) with no `layersDifferOnlyByPresentation` guard and 0 production callers.
- **`addHistoryEntry` is a live second-writer _surface_.** It is defined at `useHistory.ts:51` and
  returned on the hook's context value at `:166`, so any component can append a `HistoryItem` through
  a path that bypasses `COMMIT_DOCUMENT_EDIT` — and therefore bypasses the append boundary, the
  durable publication, and the two-writers-per-transition hazard. It has **zero production callers**
  (`useHistory.test.tsx:304,322` only), so the fix is simply to stop exporting it.
- **`psd-utils.ts` `savePsd` does not release materialization leases** (phase02 Issue 35).
- **Asset registry has no unreachable-branch sweep** (phase02 Issues 32, 33).
- **`materialization.ts` never yields** within a single layer's materialization (Issues 30, 31) —
  a main-thread stall risk once it is actually on the render path.
- **Vector-layer resize under the Transform tool is still wrong.** `transformToolArgsToAffine`
  keeps scale in the matrix and `Layer.pos` never changes, so `layer-renderer.ts:84` bitmap-stretches
  a re-rendered vector. `.kilo/plans/vector-friendly-transform-resize-plan.md:12-25` documents this
  as open. True only for Reposition; correct there.

### 5.4 Known defects that are PINNED. Do not "fix" them casually.

An `it.fails(...)` is a tripwire: it passes today and **fails the moment the defect is fixed**, so a
fix must remove the pin in the same change. There are 42 of them. The migration-relevant ones:

| Location                                           | What it pins                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `materialization.ordering.test.ts:415`             | interleaved affine/filter operations grouped by type (blocker 3)                                                                                                                                                                                                                                                                                                                                       |
| `StoreContext.durable-boundary.test.tsx:441`       | `REPLACE_DOCUMENT` retains the prior frame crop                                                                                                                                                                                                                                                                                                                                                        |
| `StoreContext.durable-boundary.test.tsx:602-633`   | the durable cutover is **absent** — `replayCoordinator`, `presentationMaterialization`, `getReplayRevisionToken` are not in the store                                                                                                                                                                                                                                                                  |
| `useSelectionClipboard.layerViaCopy.test.tsx:203`  | canvas→document position translation. **Its diagnosis is stale**: it blames a `documentToCanvasPos` call at `useSelectionClipboard.ts:100` that now calls `canvasToDocumentPos` (correct). The expectation matches neither the correct value nor the described bug. The polygon `points` array is still never frame-converted — a real unfixed clipboard bug under the plan's own coordinate contract. |
| `tools/__tests__/tool-processors.test.ts:143, 303` | the new `affine-operation` commit kind                                                                                                                                                                                                                                                                                                                                                                 |
| `text.test.ts:258`                                 | replaying text from a durable vector source without re-rasterizing                                                                                                                                                                                                                                                                                                                                     |

**`AGENTS.md` forbids every headed Playwright invocation outright** — `--headed`, `--ui`,
`--debug`, `show-report`, `show-trace`, `codegen`, `PLAYWRIGHT_ALLOW_HEADED=1`,
`test.use({headless: false})`. Nothing fails headless today, and a headed run is expected to be green
too, but no run in this repository establishes that and `AGENTS.md` forbids an agent from producing
one: operator input reaches the page as real input. Do not flip the mode to "fix" a failure.

### 5.5 Stale documentation — actively misleading

**Two source comments are provably false against code two files away.** I verified both:

`src/contexts/history-append.ts:19-25`:

> _"Phase 1 status: plan only. The durable entry is derived at the append point but is not published.
> `StoreContext` still converts the whole timeline into the diagnostic shadow, so publishing the
> planned entry here would create a second writer for a single append."_

`src/contexts/useLayer.ts:564-567`:

> _"The planned durable entry is not published yet: the store still rebuilds its diagnostic shadow
> from the legacy timeline, and that shadow is the only durable signal the UI reports, so the
> plan's own diagnostics are deliberately not surfaced here."_

Both were invalidated by `de91a83` on 09-27 10:12. `StoreContext.tsx:647-666` publishes the planned
entry through `decideDurableAppend`, and on `mismatch` appends `durableAppendDiagnostic` at
`:679-684`. `HANDOFF.md` item 5 flags only the `useLayer.ts` one — **the `history-append.ts` one is a
second, unflagged instance.** Both are fixed on `b027de3`.

**`tsc --noEmit` and bare `tsc` type-check zero files.** The root `tsconfig.json` is a solution stub
with `"files": []`. Verified: a probe file with `export const broken: number = "definitely not a
number"` passes `npx tsc --noEmit` and fails `npx tsc -b`. No repo file instructs anyone to run the
bare form, but `.claude/settings.local.json:3` has `"allow": ["Bash(npx tsc:*)"]`, which would
auto-approve it. Rename the script to `typecheck` and narrow the wildcard.

**`toolbar-mapping.ts` is type-checked only transitively.** `tsconfig.app.json:33` sets
`include: ["src"]`, which matches nothing at the root. The file is production code
(`SidebarLeft.tsx:6` imports it) and reaches the program only because five files import it — four of
them tests. Delete the last import and it silently drops out of all three programs. Fix:
`"include": ["src", "toolbar-mapping.ts"]`, or move it under `src/`. Then add a CI assertion that
every tracked `*.ts`/`*.tsx` is claimed by at least one project (`npx tsc -b --listFiles` diffed
against `git ls-files '*.ts' '*.tsx'`; measured cost ~1.3 s on top of a 5.2 s `tsc -b`).

**Do not add `tsc --force`.** It is unnecessary (all three `tsBuildInfoFile` paths point into
`node_modules/.tmp/`, which `npm ci` wipes) and it would not help anyway: **all three configs set
`noEmit: true` and none is `composite`, so `tsc -b` never takes the up-to-date skip path in this
repo.** Verified with a warm buildinfo — every project reports "out of date because output file
`src/App.test.js` does not exist" on consecutive runs. The `tsBuildInfoFile` lines are dead
configuration; the current setup is not incremental and should not be described as such.

### 5.6 Worktree and branch hygiene

- 7 worktrees are parked at `f11f7e7` (09-24 22:40) and are dead. Delete them.
- `history-migration-08` is at `92028a7`, 0 ahead of `main`. The Phase-1 chat said to delete it
  "whenever you want". Do.
- `photoshop-fidelity`, `ps-shape-geometry`, `ps-ux-chrome` are all 0 ahead. Safe to delete.
- `ps-transform-geometry` (`a3f9050`, 1 ahead) and `ps-integration` (`a0f66c4`, 3 ahead) hold
  unmerged Photoshop-fidelity work. `a3f9050` unifies raster CTM order and warps trapezoids through
  a homography — that is adjacent to the migration's raster-boundary work and worth reviewing
  _before_ deleting, in case the migration wants it.
- `main` is 10 ahead of `origin/main`. Nothing is pushed.

---

## 6. Observations

These are my read of the process, not findings from the code. They are the part of this document
most likely to be wrong, and the part most worth arguing with.

### 6.1 The test budget was spent on the wrong axis

Two independent measures point the same way. In **committed lines**, test insertions outran production
insertions **4.3 : 1** — 58,549 against 13,543 (§2.6). In **session wall-clock**, tests/lint/tsc took
**3747 of 8244 minutes, 45%**, against the migration's 2370 minutes, 29% (§3.2).

The migration's actual blocker is wiring (§5.2), and wiring cannot be verified by more unit tests,
because a module with no production importer has nothing to assert against. The test suite is
currently _pinning the cutover out of production_:
`StoreContext.durable-boundary.test.tsx:602-633` asserts the coordinator and materialization are not
in the store. That is a green suite enforcing a rollback.

The pivot is traceable to a single decision. `ses_f25b4c83bffeG38Z1dy60Y7Gx9` (09-25 20:39) was
tasked with step 3, and ended by rewriting the _next_ plan as a P0-only test-hardening plan. Every
subsequent session inherited that framing. Handoff 04 scored 70% and handoff 08 scored 90%+ on
volume of green checks, which is real work, but it is work on a path that is not shipped.

**The counter-argument, which is fair:** the durable model _must_ be correct before it is
authoritative, and unit tests are how you establish that for a 6,000-line pure reducer with a
diagnostic contract. The tests were not wasted. They were spent in the wrong order — correctness
proved, then wiring deferred indefinitely.

### 6.2 Scaffolding created false confidence, exactly as predicted

`history-migration-06-recommendations-lessons-summary.md` carries a lesson: _"scaffolding creates
false confidence."_ It scored ⛔ not adopted, and the reason is that the lesson recurred in the
prose: `history-append.ts:21-25` and `useLayer.ts:563-567` both assert a pre-cutover state that
`de91a83` had already left. Comments outlived the code they described, and every audit that read
them as evidence of dormant state was wrong.

The deeper version: **the plan audit scores are themselves an instance of the same failure.** Plan 08
scores 93% and plan 03 scores 74%, but 08's work is unwired and 03's is partly live. A percentage
over a plan's own task list measures conformance to a plan, not distance to a shipped system. The
numbers in §2.5 are useful for locating detail, not for ranking risk.

### 6.3 The `durableStatus` gate made the first real slice inert

`de91a83` is the best commit in the series: a real single-writer path, a three-way decision
(`published` / `preconditions` / `mismatch`), 19 + 8 new test cases including a control proving the
published document is structurally identical to full conversion. And in ordinary UI it almost never
publishes, because a layer click sets `durableStatus` to `'stale'` and the gate demands `'current'`
(§5.2 blocker 2).

The gate is defensible — it is what makes the publish path safe. The problem is that the six
actions which flip it to `'stale'` were never examined as a group, and none of them is a history
write. The fix is not to weaken the gate; it is to stop treating a _selection_ as a reason to
invalidate the _durable document_. Those are different concerns and they are currently coupled
through one status field.

### 6.4 The rollback was right, and the plan files still describe the pre-rollback world

`323d664` added `PUBLISH_DURABLE_REPLAY`. `cb1896d` made legacy replay authoritative again.
`2f051a0` deleted the action outright. Three audits scored `PUBLISH_DURABLE_REPLAY` as merely
"unimplemented" — it was implemented, then deliberately reverted, in the same 24 hours.

That was the correct call. `PUBLISH_DURABLE_REPLAY` dispatched from a `latestStateRef` fast path
that bypassed React state, and its own chat (`ses_f216acd6`) identified the precise blocking
defect — out-of-reducer mutation — before any of it reached a user. The agent recommended _not_
starting the cutover, named the exact gate, and the next session resolved that gate through the
option it named. That is the migration working as designed.

The cost was documentation debt. `history-migration-consolidated-handoff.md` (09-26 10:35) and
`history-migration-07-readiness-next-steps.md` both assert `PUBLISH_DURABLE_REPLAY` as the Phase 4
mechanism. Neither was updated. A future agent reading them would try to implement an action that
was deleted on purpose.

### 6.5 One cheap fix, delivered late, was worth more than four sessions of tests

`b027de3` — 5 production files, +802/−111 total — closes six of nine `HANDOFF.md` items, including
the only live memory leak in the system. It sits unmerged on a worktree branch, behind two days of
test commits, discovered only by reading branch heads. The most valuable work of the week is
currently invisible to `main`.

The process failure is not that the fix was late. It is that `HANDOFF.md` — a 301-line, verified,
problem-focused document — was written _after_ `b027de3` existed and does not mention it. A problem
list that is not diffed against every local branch is a snapshot, not a list.

### 6.6 The subagent rule was followed well

43% of sessions ran on explicitly free models, and the split is clean: free models wrote tests and
did audits, frontier models did architecture. The one violation is instructive —
`ses_f2135bdebffeJHnPRHaA0uwMIj` / `ses_f2134d209ffe6pcixeJuK3KLFK`, where a subagent modified
`StoreContext.tsx` against an explicit "tests only, NEVER change prod source code" instruction, and
it took two follow-up sessions to detect and unwind. Rule-scoped subagents need an enforcement
mechanism, not a restatement.

---

## 7. Recommendations

Ordered. Each is cheap relative to what it prevents.

1. **Merge `fix/unit-tests` into `main` and delete its six items from `HANDOFF.md`.** Six of the
   original nine `HANDOFF.md` items are already fixed there (§5.1); in the rewritten `HANDOFF.md`
   they are items 7, 16, 17, 18, 21, 22. Every other estimate in this document is downstream of
   this.
2. **Push `main`.** 10 commits, 4 days, unpushed. Establish a remote checkpoint before starting
   blocker 1.
3. **Delete the 7 dead worktrees and the 3 fully-merged branches.** Reclaim disk and stop the branch
   list from lying about what is in flight.
4. **Fix the two false comments on `main` immediately, even if you merge `b027de3` later** — they
   are actively costing audits time.
5. **Decide the cutover question before writing more durable code.** The honest options are
   (a) commit to wiring `materialization.ts` and finish it, or (b) freeze the durable model as a
   documented shadow, delete the dead modules, and spend the effort elsewhere. What is not
   acceptable is the current state: 4 dead modules, 2 dead actions, 1 dead operation kind, and a
   shadow nothing reads. That is the most expensive option on the table, because it looks like
   progress.
6. **Decouple `durableStatus` from selection state** (blocker 2) before wiring the next writer.
   Otherwise every `set-layer-properties` / `reorder-layers` slice will be inert in real use, exactly
   as `set-document-frame` is.
7. **Add the error boundary** (blocker 5). It is the cheapest item on the P0 list and it is the
   control that would have contained the `2f051a0` regressions.
8. **Update or delete `PUBLISH_DURABLE_REPLAY` references** in the consolidated and readiness plans
   (§6.4). Mark them superseded rather than leaving them actionable.
9. **Write a `WIRING.md`** listing, per module, its production importers — generated, not
   maintained by hand. The fact that four modules were dead was discoverable only by grepping
   importers, eleven independent times.

---

## 8. The prompt for the next agent

Self-contained. Paste into a fresh Kilo session rooted at `/Users/bkalynovskyi/ph`.

---

> You are continuing a large, well-advanced migration of the history machinery in the browser-based
> Photoshop clone at `/Users/bkalynovskyi/ph`.
>
> **Read these first, in this order:**
>
> 1. `MIGRATION_NEXT_STEPS_SUNDAY.md` (repo root) — the full map, chat inventory, and problem list.
>    §5 and §6 are the parts that matter.
> 2. `AGENTS.md` — especially the "Never open a browser window" section. It is not advisory.
> 3. `HANDOFF.md` — **22 numbered open problems, each with a verified `file:line` and a concrete
>    fix.** It leads with a merge checklist for `fix/unit-tests` (`b027de3`), which closes its items
>    7, 16, 17, 18, 21, 22. Read §0, merge, then work the list top-down: P0 is items 1–6.
> 4. `.kilo/plans/history-migration-08-phase1-writer-readiness.md` and
>    `history-migration-08-hardening-handoff.md` — the most recent plan state. Both carry an
>    appended `## Assessment by Space Bunny` section with a per-task table; read those, not the
>    original text.
>
> **The situation in one paragraph.** The migration from a flat `HistoryItem[]` history to an
> immutable durable document with an asset registry is roughly 75% built by task count and 0%
> switched on. Production still runs legacy `HistoryItem[]` → `replayHistory` → runtime `Layer` →
> `layer-renderer`. `materialization.ts`, `durable-replay.ts`, `replay-coordinator.ts` and
> `replay-checkpoints.ts` have **zero non-test importers**. `durableDocument` / `durableStatus` /
> `durableDiagnostics` are written by `StoreContext.tsx:686-786` and read by nothing outside that
> file. `StoreContext.durable-boundary.test.tsx:602-633` actively pins the cutover's absence. Do not
> assume a green suite means a working feature.
>
> **Your first three actions, in order:**
>
> 1. `git fetch && git log --oneline main..origin/main` and reconcile with the map (it was written
>    at `eb2160e`). Confirm HEAD before trusting any line number.
> 2. Merge `fix/unit-tests` (`b027de3`, `5da9f82`) into `main`. It closes `HANDOFF.md` items 1–6,
>    including the only live `ImageBitmap` leak in the system. Then **re-derive the problem list** —
>    do not trust `HANDOFF.md` afterwards.
> 3. Push `main` (10 commits are currently unpushed) so there is a checkpoint.
>
> **Then pick ONE of these and do it properly. Do not start all three.**
>
> **Option A — make the durable path real (recommended).**
> Wire `materialization.ts` into the render path so one shared materialization pipeline serves
> screen, PSD export, clipboard and merge. Today the runtime raster boundary is wrong
> (`useLayer.ts:516-536` feeds an _untransformed_ bitmap to a pixel processor, while
> `materialization.ts:263-269` materializes the retained presentation first). Note the trap: two
> independent affine/filter composers exist — `materialization.ts:102-138` duplicates
> `getLayerAffineTransform` and `scaleVectorArgs` — and `materializeLayer` / `materializeDocument`
> have no callers, so the first wiring attempt will be the first time that code has ever executed
> against real state. Reconcile the composers before wiring, not after.
>
> **Option B — unblock the writer path.**
> `StoreContext.tsx:654` gates publication on `durableStatus === 'current'`, but `SET_ACTIVE_LAYER`
> and four selection actions set it to `'stale'`. So `decideDurableAppend` almost always falls back
> to whole-timeline reconversion in real use, and the tests only exercise the published path through
> `UPDATE_LAYERS`, which has no production caller. The 6 writers the plan's inventory omits are the
> cause. Decouple selection state from durable-document validity — do **not** weaken the gate, which
> is what makes the publish path safe. Then add `set-layer-properties` and `reorder-layers` as the
> next two boundary writers (12 of the 13 live writers still reconvert the entire timeline).
>
> **Option C — freeze the shadow.**
> If wiring is not the right call, say so explicitly and treat it as a decision, not a deferral:
> delete the four dead modules, the dead `UPDATE_LAYERS` escape hatch, the writer-less
> `rasterize-layer` operation kind, and the dead `addHistoryEntry` path; document the shadow as a
> shadow. This is a legitimate outcome. The current state — 4 dead modules and a shadow nothing
> reads, while looking like progress — is the most expensive of the three.
>
> **Constraints that are not negotiable:**
>
> - **Never run Playwright headed.** No `--headed`, `--ui`, `--debug`, `show-report`, `show-trace`,
>   `codegen`, `PLAYWRIGHT_ALLOW_HEADED=1`, or `test.use({headless: false})`. `kilo.jsonc` denies most
>   of these and `e2e/global-setup.ts` refuses the rest. Nothing fails headless, and a headed run is
>   expected to be green too, but nothing here measures that and your own mouse and keyboard reach
>   the page as real input. If something only reproduces visually, that is the operator's call: ask
>   them to run `npm run test:e2e:headed` themselves.
> - **A pin is a tripwire.** There are 42 `it.fails(...)` tests. Each asserts current broken behaviour
>   on purpose and fails the moment you fix the defect. Removing a pin is part of the fix, not a
>   separate change. Do not widen a threshold, add a skip, or re-record a visual baseline to make
>   something green.
> - **Do not run bare `npx tsc` or `npx tsc --noEmit`.** The root `tsconfig.json` has `"files": []`
>   and type-checks zero files while exiting 0. Use `npm run tsc` (`tsc -b`). Do not add `--force`.
> - **Do not add `--force` to any tsc invocation.** All three projects set `noEmit: true` and none
>   is `composite`, so `tsc -b` never takes the up-to-date skip path; the `tsBuildInfoFile` settings
>   are dead configuration and the build is not incremental. Measured cost of a real `tsc -b` is
>   5.2 s; adding a `--listFiles` CI assertion costs ~1.3 s on top.
> - **Do not use `it.fails`, a test name, or a code comment as proof that behaviour exists.** Verify
>   by finding real non-test importers and reading the implementation. Two comments in this repo
>   (`history-append.ts:21-25`, `useLayer.ts:563-567`) are provably false against code two files
>   away, and several audits were misled by them.
> - **Scope subagent work with enforcement, not restatement.** One subagent edited
>   `StoreContext.tsx` against an explicit "tests only" instruction and it cost two follow-up
>   sessions to detect. If a subagent must not touch production, verify the diff before accepting
>   its result.
>
> **Free models in subagents are welcome and encouraged** — 43% of the last two days ran on
> `nemotron-3-ultra-550b-a55b:free` and `laguna-s-2.1:free`, almost all of it test writing and
> auditing, and the split worked well. Use frontier models for anything touching replay semantics,
> asset ownership, or the store reducer.
>
> **Gates before you call anything done:**
> `npm run tsc` (exit 0) · `npm run lint:check` (0 errors; 19 warnings are pre-existing) ·
> `npm run test` (173/173 files; 3813 pass and 42 `it.fails` expected — a _lower_ pass count with
> the same expected-fail count means you broke something) · `npm run build` (green) ·
> `npm run test:e2e` headless (97 pass, 2 skipped by declaration, none failing — a failure there is
> a new defect, not a known one; read `e2e/OPEN_PROBLEMS.md` first).
>
> **At the end, produce:** what you changed, which of Options A/B/C you took and why, the gate
> output, what you deliberately did not do, and a fresh problem list. Then write the follow-up prompt
> to a file, the way `history-migration-05-followup-prompt.md` was written — that chain is the
> migration's memory, and it only works if each link is written down.
>
> **One judgement call, flagged rather than prescribed.** A rollback of the durable cutover already
> happened once, in `323d664` → `cb1896d` → `2f051a0`, and it was the right call: the
> `latestStateRef` publication path bypassed React state and mutated runtime layers outside the
> reducer, and the agent that found it recommended not proceeding. The migration has not
> contradicted itself since. The trap available here is to read the 90–93% audit scores on the phase-1
> plans as "nearly done" and treat wiring as a formality. It is not a formality — it is the entire
> remaining risk, and it is the only part of this work that no test suite currently covers.

---

## Appendix A — verification commands

```bash
# state
git log --oneline -1
git log --oneline origin/main..main
git status --short
git worktree list
git branch -vv

# is a module actually wired?
grep -rn "from '.*<module>'" src --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v "\.test\."

# the durable shadow's readers (expected: nothing outside StoreContext)
grep -rn "durableDiagnostics\|durableStatus\|durableDocument" src --include="*.tsx" | grep -v __tests__

# pins
grep -rn "it\.fails(" src --include="*.ts" --include="*.tsx"

# gates
npm run tsc
npm run lint:check
npm run test
npm run build
npm run test:e2e            # headless only. never :headed, --ui, --debug
npm run test:e2e:unit

# chat transcripts
kilo_db=$(kilo db path)
sqlite3 -readonly "$kilo_db" \
  "SELECT s.id, datetime(s.time_created/1000,'unixepoch'),
          substr(replace(coalesce(s.title,''),char(10),' '),1,60)
   FROM session s WHERE s.directory LIKE '%/ph%'
   ORDER BY s.time_created DESC LIMIT 50;"

kilo export <session-id>    # --sanitize if it may contain secrets
```

## Appendix B — key file index

| path                                                      | what it is                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/contexts/history-model.ts`                           | canonical durable types + validation (live)                          |
| `src/contexts/history-adapter.ts`                         | `HistoryItem[]` → durable document, with diagnostics (live)          |
| `src/contexts/history-append.ts`                          | the Phase-1 single-writer append boundary (live, 1 writer)           |
| `src/contexts/history-replay.ts`                          | legacy replay — **production authority** (live)                      |
| `src/contexts/history-timeline.ts`                        | `append` / `cursor` primitives (live)                                |
| `src/contexts/affine-transform.ts`                        | the single `{a,b,c,d,e,f}` composer (live)                           |
| `src/contexts/asset-registry.ts`                          | ImageBitmap leases, generations, budgets, disposal (live)            |
| `src/contexts/layer-presentation.ts`                      | `DocumentPresentationScope` — ownership + `retire()` (live, leaking) |
| `src/contexts/materialization.ts`                         | shared materialize pipeline (**dead**)                               |
| `src/contexts/durable-replay.ts`                          | pure durable replay reducer (**dead**)                               |
| `src/contexts/replay-coordinator.ts`                      | cooperative scheduling, revision tokens (**dead**)                   |
| `src/contexts/replay-checkpoints.ts`                      | bounded checkpoint cache (**dead**)                                  |
| `src/contexts/StoreContext.tsx`                           | single writer; owns the shadow; the two divergent state paths        |
| `src/contexts/useHistory.ts`                              | navigation → `replayHistory`                                         |
| `src/contexts/useLayer.ts`                                | tool commits, layer removal, `applyDocumentCrop`                     |
| `src/contexts/layer-renderer.ts`                          | the render path                                                      |
| `src/contexts/psd-utils.ts`                               | PSD export (`tmpCanvas ?? bitmap`)                                   |
| `src/contexts/layer-utils.ts`                             | `saveLayerCanvas` (dead; removed on `fix/unit-tests`)                |
| `e2e/OPEN_PROBLEMS.md`                                    | pinned e2e defects, with evidence                                    |
| `HANDOFF.md`                                              | 9 problems, **6 already fixed on `fix/unit-tests`**                  |
| `.kilo/issues/phase02-durable-replay-migration-issues.md` | 39 verified issues, several retracted                                |
| `.kilo/prod-code-changes-since-consolidation.md`          | prod-code deltas from weak-model test sessions                       |
