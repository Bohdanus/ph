# History migration — the four parallel artifacts, and what an audit has to settle

**A point-in-time report.** It describes one tree on 2026-10-03 and is not maintained. Every
number below was measured then; re-derive before trusting it. `docs/README.md` names it under
"Not maintained here" for that reason.

Its job is to hand an audit a map: four artifacts were built against the same subsystem without
coordinating, they now disagree, and the disagreement is _semantic_ — two designs for one module,
not two patches to one file. This document says what each artifact holds and which questions the
audit must answer. It deliberately does **not** restate what the sources already own:
`HANDOFF.md` §179 owns the verdict on `fix/migration-review-sweep`, `docs/ARCHITECTURE.md` owns the
system shape, and `HANDOFF.md` owns the code defects. Where this document repeats them it is to
point at them, and it says so.

## 0. The one-paragraph version

Four sessions wrote to `src/contexts/` history modules in about 30 hours. One died leaving 42
uncommitted files. A second recovered them and committed them as an anchor that is **red by its own
declaration**. A third branch, 188 commits stale, independently re-derived the same subsystem in an
incompatible direction and was correctly adjudicated unmergeable in `HANDOFF.md` §179 — then merged
anyway, twice, and abandoned mid-operation both times. A fourth left six uncommitted paths of which
half are provably redundant. No work was lost — but **three** operations are still open on disk, two
merges and a rebase. The oldest is 28 hours old and holds a silent takeover that passes `tsc`; the
newest is the rebase that tried to land C and stopped on twelve conflicts.

## 1. The artifacts

Ages and states measured 2026-10-03 ~17:07 local.

| #   | Artifact                                                     | State on disk                               | Recoverable?            |
| --- | ------------------------------------------------------------ | ------------------------------------------- | ----------------------- |
| A   | `history/migration-architecture-2026-10-03` @ `e07e2f9d`     | 1 ahead of `main`, 0 behind, clean tree     | Yes — already committed |
| B   | `.kilo/worktrees/continue-architecture-migration-2026-10-03` | 0 ahead, **6 uncommitted paths**            | Yes — not yet committed |
| C   | `fix/migration-review-sweep` @ `5d388e02`                    | 1 ahead, **188 behind**, fully unmerged     | Yes — but see §3        |
| D   | `.kilo/worktrees/sweep-land`                                 | **`MERGE_HEAD` set, 5 files `UU`, 27h old** | **At risk** — see §4    |

Two further operations are open and are _not_ migration artifacts:
`migration-review-sweep` (detached, mid-**rebase**, 12 files `UU`, ~40 min old at measurement) and
`header-menu-structure` (`MERGE_HEAD` set, **0** unmerged, ~2h53m old — a clean merge never
committed).

Re-derive every cell:

```bash
git worktree list --porcelain
for w in .kilo/worktrees/*/; do
  echo "== $w"; git -C "$w" rev-parse --abbrev-ref HEAD
  git -C "$w" rev-list --left-right --count main...HEAD
  git -C "$w" status --short | head -30
done
# an operation in progress leaves one of these behind:
ls -d .git/worktrees/*/rebase-merge .git/worktrees/*/rebase-apply 2>/dev/null
ls .git/worktrees/*/MERGE_HEAD .git/worktrees/*/CHERRY_PICK_HEAD 2>/dev/null
```

## 2. What A holds, and what it costs to land

`e07e2f9d` is 42 files, +3,661/−345, and its commit message is exemplary: it declares six known
defects, including `90 tests fail`. Two things follow, and both matter to the audit.

**It is an anchor, not a landing candidate.** It exists so the work would survive. Its own message
says the tests are red, and that is measured: **89 failures**, not 90, all from one cause —
`LayersTab` now calls `useCurrentTool()` and the suites that render it without a provider die at
mount. Measured per file, and the sum is the 89:

| Failing file                                                        | Failures |
| ------------------------------------------------------------------- | -------- |
| `src/components/SidebarRight/__tests__/LayersTab.test.tsx`          | 39       |
| `src/components/SidebarRight/__tests__/SidebarRight.test.tsx`       | 24       |
| `src/components/SidebarRight/__tests__/LayersTab.store.test.tsx`    | 14       |
| `src/components/SidebarRight/__tests__/LayersTab.dispatch.test.tsx` | 12       |

**Its reconciliation is exact.** 36 modified + 6 added matches the prior session's report one-for-one,
with nothing unaccounted for. That is worth stating because a recovery commit that quietly contains
something nobody described is the failure mode to look for, and it is absent here.

**Its `HANDOFF.md` additions are stale against itself.** §184, §185 and §186 are added _by this
commit_ and describe the pre-fix state. `main` ends at §183. Concretely, §185's "what is needed" names
`transformedProcessorInput()` and `replayProcessorInput()`, and this same commit **deleted both**; it
also demands eight proofs, of which **zero** are present. §177's `it.fails` leg was removed but the
entry was not retired, so it still asserts that leg exists.

The audit should decide, per declared defect, whether it is fixed, still open, or must be
re-derived — not whether to re-read the commit message.

## 3. Why C must not be merged

This is the load-bearing conclusion, and `HANDOFF.md` §179 already reached it a day earlier with the
commands inline. What follows is the ledger that was missing.

A line-by-line enumeration of `5d388e02` against `main` came to roughly: **8 changes already on
`main`** (re-derived independently, often more strictly), **11 genuinely unlanded**, **3 regressions**
the merge would introduce, and 2 comment-only. Treat the split as one review's partition rather than
settled fact — the collision table below does not depend on it, and that table is what the decision
rests on.

The structural reason the conflicts are semantic: `main` never touched `materialization.ts` or
`durable-compositor.ts` at all since the fork, so that payload is 100% unlanded — while `main` added
+358 lines to `history-append.ts`, +146 to `presentation-evaluator.ts` and +114 to `layer-renderer.ts`,
which are the exact files the branch most heavily rewrites. The branch is working from a pre-fork
snapshot of the modules it replaces.

Collisions, both directions:

| Only on the branch            | Only on `main`                                             |
| ----------------------------- | ---------------------------------------------------------- |
| `omittedLayerIds`             | `evaluatePresentationForDraw`                              |
| `PresentationFilterRefusal`   | `enabledFilterOperations`                                  |
| `validateBounds`              | `getLayerFilter`                                           |
| `layerPresentationOperations` | `FilterArgumentUnrenderableError`, `registryResolvesAsset` |

Merging would also delete **20 tests `main` owns** and revert main's `never` arm in
`collectDurableAssetIds`, where an unclassified `DurableOperation` kind would again compile and
silently release a live asset. **Any `-X ours` / `-X theirs` here picks one design and reverts the
other**, which is why the conflicts are not the interesting part.

### The one thing worth recovering

`materializeDocument()` on `main` rethrows only `AbortError` and `console.error`s everything else,
so an out-of-memory `RangeError`, an unknown or disposed asset, an unregistered processor or a
degenerate transform each **silently drop a layer**, and with no `omittedLayerIds` a consumer cannot
tell a refusal from a layer that was never in the replay. I confirmed this in the current tree. It
is **latent** — `materialization.ts`'s only non-test importer is `durable-compositor.ts`, which
itself has none — which is exactly why it should be fixed _before_ any authority cutover rather than
after. Re-derive it on a fresh worktree off `main`; do not carry the branch's design with it.

Also worth re-deriving, in the same order: skipping invisible layers before materializing; dropping
`opacity`/`blendMode`/`visible` from `createMaterializationKey` (the producer renders none of them,
so every visibility toggle currently forces a full-document re-rasterization); and recognising abort
by `error.name` rather than `instanceof DOMException`, which is a per-realm global.

**Do not** recover: the `getLayerFilter` deletion; the resize-only snapshot gate (main's own test
proves it loses pixels after `clearRect`); `validateBounds` as a boolean flag (use main's target
union instead); and the five documentation files, whose branch copies are 188-commit-stale snapshots.

## 4. D is the dangerous one

`sweep-land` is a merge of `5d388e02` into `integration/sweep-land`, open since 2026-10-02 13:34.
Two facts distinguish it from every other artifact here.

**Its conflicts are resolved in the working tree and were never `git add`ed.** Zero conflict markers
remain in the files; the index still lists five as `UU`. So `git merge --abort` there would destroy
real resolution work. Handle it deliberately, or do not touch it.

**The resolution took the branch's side wholesale, and it compiles.** Against `main` it nets −51
lines in `layer-renderer.ts` and −130 in `presentation-evaluator.ts`, deleting `getLayerFilter`,
`enabledFilterOperations` and `evaluatePresentationForDraw` and reinstating the branch's
`PresentationFilterRefusal`. `npm run tsc` **passes** on it.

That is the exact shape `scripts/merge-takeover-guard.mjs` exists to catch, and it would very likely
have refused it: `sweep-land` has `MERGE_HEAD` set, so `pre-commit` fires on commit. It had no
chance, because nothing ever committed. **The guard protects the last moment; nothing protected the
27 hours before it.**

## 5. B is two halves with opposite merit

Six uncommitted paths, produced by background workers, one of which kept editing after a stop
instruction.

**Keep — `history-append.ts` and its test.** `planHistoryAppend()` withholding `durableEntry` when
`validateTimeline()` returns an `error` is `HANDOFF.md` §17's prescribed fix, and the two tripwire
pins are re-pointed rather than relaxed. The `FreehandLasso.test.tsx` change is a legitimate fixture
repair and a strengthening: the old `history: [] / historyIndex: -1` fixture only produced a
_defined_ timeline, not a valid one, so the pins had stopped exercising the durable plan at all.

**Discard — `durable-compositor.ts`, `materialization.ts`, and the untracked
`materialization.blend-mode.test.ts`.** Provably a no-op. `composeDurableDocument()` already set
`globalAlpha` and `globalCompositeOperation` from the layer snapshot before the patch; the patch
moves three fields between two internal structures. Empirically: 4 of the new file's 6 tests pass
against `main` untouched, and the 2 that fail assert only that `MaterializedLayer` carries three extra
properties. Keeping them would enshrine a refactor as a contract.

**B is currently red, and the cause is a half-finished fixture repair.** Three failures in
`LayersTab.dispatch.test.tsx`, all `durableEntry: null` where a shaped entry was expected. The worker
fixed the same fixture defect in `FreehandLasso.test.tsx` and missed this file, which inherits the
degenerate default `historyIndex: -1` from `createMockStoreState` in `src/__tests__/fixtures/store.ts`.
Nine test files both assert `durableEntry` and use a degenerate timeline.

**And a coupling the audit must not miss.** B's `durableEntry: null`-on-error change fires on exactly
the path where the timeline is invalid — and §2's declared double dispatch in `commitDirtyTool`'s
text arm makes the second write plan against a **pre-dispatch closure**, so its cursor is outside the
timeline. So B would silently withhold the durable record of the second write rather than record it,
masking a defect neither artifact has fixed. _This interaction is inferred from the two mechanisms,
not observed end to end._ Verify it before landing either.

## 6. The detection existed and was not read

This is why the situation arose, and it is the part most likely to recur.

`WORKTREES.json`, generated 2026-10-03 11:34, **already answered the question**. Its record for
`migration-review-sweep` reads `action: at-risk`, `recommendation: salvage`, `riskScore: 90`,
`behind: 187`, `mergeConflict: true`, and a `statusReasons` entry naming **all twelve conflicting
paths** with the sentence "so it needs a rebase first". The merge "discovered" twelve conflicts as a
surprise roughly two hours later.

The inventory had **53 records and omitted both worktrees carrying the entire migration payload** —
it was generated before either existed. It is also stale against `main` (`mainHead` two commits
behind) and **nothing regenerates it**: no hook, no script, no CI job.

`HANDOFF.md` §179 — "`fix/migration-review-sweep` cannot merge" — is on `main`, in prose, with the
`rev-list` and `comm -12` commands inline, and it independently names all three collisions above. The
chat that merged anyway **did read that file**. `HANDOFF.md` has **no table of contents and no
documented way to find an entry**, and §179 sits at the far end of it. That is the causal link: not
ignorance, but an unsearchable artifact — the one entry that governed the branch was in a document
whose only access path is reading it end to end.

Board file locks are correct, cross-session and keyed by branch, which would have named the other
writer — and hold **zero rows** for either branch. `.kilo/agent-manager.json` records **no session** on
any of its 85 worktrees.

## 7. What the audit should do, in order

1. **Freeze before reading.** Three operations are open, and the cheapest thing an audit can do
   first is stop them ageing further. Abort the `migration-review-sweep` rebase — it holds nothing
   but conflict markers, and its branch is intact either way. Then decide `sweep-land` explicitly:
   its conflicts are resolved but unstaged, so `git merge --abort` destroys real work while
   committing lands a silent takeover. `header-menu-structure` is a clean uncommitted merge and needs
   only a decision.
2. **Do not merge C, and do not re-run its rebase.** `HANDOFF.md` §179 forbids it and §3 proves it.
   Re-derive the 11 unlanded changes on a fresh worktree off `main`.
3. **Land the `materializeDocument()` catch first.** It is the highest-value defect and it is
   currently latent only because the durable path is unwired.
4. **Fix the four `LayersTab` suites for the missing provider**, then re-measure `e07e2f9d` and decide
   per declared defect whether it is fixed, open, or must be re-derived.
5. **Salvage only §17's append half from B**, add the `LayersTab.dispatch.test.tsx` fixture repair
   first so the commit is not red, and settle the coupling in §5.
6. **Delete §185 and rewrite §184 and §186** to describe the post-commit state, or retire them. §177's
   `it.fails` leg is gone but its entry still asserts it exists.
7. **Retire or rewrite §179** once §3 is acted on. Until then it is correct and load-bearing.

## 8. Process gaps this exposed

Separated because they are not history-migration problems, and each has a named home.

**Rules that exist and did not fire:** board file locks (zero rows); the inventory's
`mergeConflictFiles` (all twelve named); `uncommitted-only` / `at-risk` / `workOnNoRef`
verdicts; `main-worktree-guard.mjs`; `merge-takeover-guard.mjs`; the dead-chat proof in
`.skills/stale-worktree-reclaim.md` (entirely manual); `scripts/dispose-worktree.mjs` (refuses dirty
trees, so nothing here is at risk of deletion).

**Rules that do not exist:** any automatic trigger for the inventory; any ownership record; any join
of `behind` × file overlap (`behind` is output-only prose); any file-overlap check at worktree
creation; any enforcement of one-writer-per-worktree (documented as "a discipline, not a lock"); any
post-stop write detection; any timer on uncommitted work inside a feature worktree; and any direction
gate at `git merge` time — the main-worktree guard runs at commit, and only on the conflicted path.

**One hole in a gate, found and closed in the same change as this report.** `merge-takeover-guard.mjs`
scanned `diff HEAD result`, so `git merge -X ours` and `git merge -s ours` produced an empty scan set
and it reported `clean — 0 path(s) moved by the merge` while deleting the branch's committed line. A
third shape now reports it, measured with raw git before the detector was written and verified end to
end against a real `git merge -s ours` with the hook installed. `docs/ORCHESTRATION.md` documented
coverage of `-X theirs` and never said the inverse was invisible; that asymmetry was an accident.
