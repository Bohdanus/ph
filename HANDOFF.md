# Handoff

Open defects in this code. [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) is the rule: **fixed and
verified DELETES the entry**, a tombstone is not a record, and this file is scoped to `history` by
`SCOPE_BY_FILE`. Where a finding belongs in another document, that document is named in the entry.

Numbering is stable and gaps are expected — a deleted entry's number is not reused.

### Items 0, 2-3, 5-10, 11-30, 33-44, 47-54, 56-59, 61-62, 64-65, 67-68, 69-73, 75, 84-85, 87-93, 97, 100-102, 104-105, 111-112, 117, 125-128, 130-131, 136-137, 141, 145, 154-155, 161, 168, 170, 175-177, 180, 186, 188, 191-192, 194-196, 200, 204-205, 208, 210-212, 222, 224-227, 229-230 — deleted

Numbers only, and that is deliberate. This heading is the machine-readable record that keeps the
board from re-filing a number as new work
(`scripts/lib/agent-board/handoff-import.mjs` `deadNumbers`), so the numbers have to outlive the
entries. What must not outlive them is prose — a "fixed in `abc123`" line per entry is the
tombstone the lifecycle rule forbids, because it invites a reader to trust a claim instead of
re-deriving the code. So this is a list and nothing else; each number was deleted on verification,
and the verification is `git log`, not this file.

## 1. P0 — the durable replay path is only mounted as a navigation presentation cache

**Problem.** Two modules the migration was built around — `replay-coordinator.ts` and
`replay-checkpoints.ts` — were imported by nothing outside `src/contexts/__tests__/`, and have
been deleted rather than left as an unimported coordination layer that a later surface could
mount by accident. The two durable modules that remain:

| module                            | non-test importing files                                              |
| --------------------------------- | --------------------------------------------------------------------- |
| `src/contexts/materialization.ts` | 1 — `durable-compositor.ts`                                           |
| `src/contexts/durable-replay.ts`  | 3 — `StoreContext.tsx`, `materialization.ts`, `durable-compositor.ts` |

Production still uses legacy `HistoryItem[]` → `replayHistory` (from `resetHistoryTo` in
`useHistory.ts`) for logical navigation and runtime `Layer` state. `StoreContext.tsx` now composes
the mapped durable cursor after that transition and publishes only presentation caches into those
legacy layers. `durableDocument`,
`durableStatus` and `durableDiagnostics` are derived by `buildDurableDocument`
(`StoreContext.tsx`) and projected onto the three `StoreData` fields at each call site, never
inside that function. Two production components read the fields from `useStore()` —
`DevStatusStripContents` in `DevStatusStrip.tsx` and `ErrorBoundaryFallback` in
`ErrorBoundary.tsx` — so this entry's earlier claim that they are "read by nothing outside that
file" was false and is withdrawn. Neither reader runs on a normal production load, so the
conclusion below still stands: `DevStatusStrip` gates its body on `import.meta.env.DEV`, and
`ErrorBoundary`'s `useStore()` call is inside `ErrorBoundaryFallback`, which renders only after
a region has thrown (`ErrorBoundary.render`). The
`it('no longer exposes replayCoordinator, presentationMaterialization or getReplayRevisionToken')`
case in `StoreContext.durable-boundary.test.tsx` actively pins the absence — it asserts that
`replayCoordinator`, `presentationMaterialization` and `getReplayRevisionToken` are _not_ in the
store. The suite is green and is enforcing the absence of the feature.

**Why it matters.** The navigation cache is the first user-visible durable projection, and its
`tmpCanvas` reaches both runtime rendering and export through `layer-renderer.ts` —
`getLayerBitmap()`. Durable logical state remains legacy-authoritative. Every additional surface
must keep the same staged publication and lease ownership contract; the migration is not a full
authority cutover yet.

**Trap for whoever wires it.** Neither the affine composition nor the vector-argument rescale is
duplicated, so the drift warning this entry used to carry is withdrawn — `materialization.ts` owns no
affine arithmetic of its own. `renderRetainedSegment()` hands the retained operations to
`evaluatePresentation()`, and `presentation-evaluator.ts` — `getPresentationAffine()` composes them
through `multiplyAffineTransforms()`. The rescale has a single owner as well:
`presentation-evaluator.ts` — `scaleVectorArgs()`, which `materialization.ts` imports directly and
`layer-renderer.ts` imports for the legacy path, so the two paths cannot diverge on it. Navigation is
now the first real caller; the remaining surfaces still need independent parity gates before they
are mounted.

**Also wrong at the boundary.** The runtime path reads `layer.tmpCanvas` before `layer.bitmap` through
`getLayerBitmap()`, with vector-source handling between those fallbacks; the durable path materializes
the retained presentation first (in `renderRetainedSegment`). Wiring the durable path without
reconciling these changes pixel-tool results.

**Fix.** Close the remaining differential limitations (§206), add the history-panel state axis
(§207), then make the presentation authority explicit and rehydrate the options bar from durable
sources. Keep legacy logical state as the authority until those projections are staged, lease-safe,
and failure-contained; do not mount all remaining consumers at once.

**Files.** `src/contexts/materialization.ts`, `src/contexts/layer-renderer.ts`,
`src/contexts/presentation-evaluator.ts`, `src/contexts/StoreContext.tsx`

---

## 4. P0 — one error diagnostic voids the entire durable shadow

**Problem.** `convertLegacyHistorySafely` (`history-adapter.ts`) checks
`converted.diagnostics.some((d) => d.severity === 'error')` and, if any one entry
produced an error, rolls back the asset transaction and returns `status: 'unavailable'` with
`document: null`.

Fail-closed is the right instinct, but this is fail-closed far too coarsely to be usable: a single
unsupported pen or curve history entry discards the candidate document and cursor map for the whole
timeline. The cursor-map prefix through the failed entry is useful, but its suffix is not proven
correct: when deriving an entry throws, the conversion loop leaves its simulated state unchanged,
and later supported entries can be derived from that stale state. Do not assume that retaining every
entry that individually converts cleanly yields a faithful suffix.

**Fix.** First define the safe extent of a partial projection.
Either retain only the exact prefix before the first failed entry and map later legacy cursors
conservatively, or prove a re-seed/replay rule that makes the suffix derivation exact. Then partition
entry-local diagnostics from structural failures and represent partial availability explicitly; do
not return a partial document as `current`. `b027de3` establishes the vocabulary for skipping an
offending entry, but skipping alone does not prove later derivations or the cursor-map suffix safe.

**Status contract to resolve before implementation.** `src/contexts/history-adapter.ts` defines only
`current` and `unavailable`, while `src/contexts/StoreContext.tsx` documents `current` as an exact,
transactionally converted shadow. `buildDurableDocument()` forwards the converter's status, and
`normalizeDurableProjection()` plus the `SET_DURABLE_STATUS` branch clear the document for any status
other than `current`; navigation and reorder consumers likewise read only a current document.
Therefore, simply returning a partial document as `current` would violate the store contract, while
introducing a partial status without tracing these paths could either discard the retained document or
let an incomplete shadow appear exact. Represent partial availability explicitly and keep it out of
paths that require an exact projection; do not remove the severity gate alone.

**Asset-lifetime blocker confirmed.** `convertLegacyHistorySafely` currently rolls back the
transaction on any error; on success it commits and calls `reconcileDocumentAssets` with
`collectDurableAssetIds(converted.document)`. The contract documented by
`AssetRegistry.reconcileDocumentAssets` requires the complete replayable document's asset closure,
including assets needed for redo, not only the active cursor. Rolling back while retaining a partial
document would invalidate assets it references; committing and reconciling against its asset set
removes other ids held by that document owner. Since legacy history remains authoritative, establish
whether assets omitted from the partial projection are still needed by legacy replay/runtime or
in-flight materialization. If they are, preserve them under an independent owner/lease; if not,
prove that no consumer needs them. Verify the partial document's assets remain resolvable without
leaking assets that neither representation uses.

**Focused verification needed.** Cover an unsupported entry followed by source-dependent entries
and verify the chosen cursor-map boundary; also verify asset resolution/redo retention when a
partial projection is stored. Keep partial status excluded from navigation and append/reorder paths
that require an exact projection.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/StoreContext.tsx`,
`src/contexts/asset-registry.ts`, `src/contexts/history-model.ts`

---

## 31. The selection baseline lookup must stay unbounded over the whole timeline

**Problem.** `deriveSelectionBaseline` (`selection-baseline.ts`) is deliberately unbounded: it
takes the **first** non-disabled `SELECTION_ACTION` on the timeline and seeds from that entry's
`previousSelectionState`, with no cursor argument at all. Both consumers take the
timeline wholesale — `replayHistory` in `history-replay.ts` and `legacyHistoryToDurable` in
`history-adapter.ts` — so the durable baseline
and the legacy replay start from the same snapshot, which is the parity property `0659ce9`
extracted this rule to own.

Bounding the lookup by replay target looks like a correctness fix, but it would reintroduce a
data-loss bug. A selection can be created by a gesture that writes no history entry, so bounding
the lookup at the replay target makes undoing a tool-switch deselect a silent visual no-op. Two tests
pin the unbounded behaviour as load-bearing:

- The `it('restores a cleared selection when undoing the tool-switch history entry')` case in
  `useHistory.test.tsx` — "restores a cleared selection when undoing the
  tool-switch history entry". The fixture is a rename entry at index 0 and a selection-clear entry
  at index 1; `undo()` from `historyIndex: 1` replays to index 0, and the only record that the
  selection ever existed is the clear entry at index 1 — after the target. Bound the lookup and
  undoing a tool-switch deselect becomes a silent visual no-op.
- The `it('uses the first selection action baseline before it and its next state at or after it')`
  case in `history-replay.test.ts` — "uses the first selection action baseline
  before it and its next state at or after it". `replayHistory(history, 0, …)` inside that same
  case expects the
  baseline, with the `SELECTION_ACTION` at index 1, again after the target index.

**Fix.** Keep `deriveSelectionBaseline()` unbounded over the whole timeline. Any future selection
authority migration must preserve that rule and keep the two tests above as tripwires; bounding one
consumer but not the other would reopen the parity divergence this helper exists to close.

**Files.** `src/contexts/selection-baseline.ts` (`deriveSelectionBaseline`), `src/contexts/history-replay.ts`,
`src/contexts/history-adapter.ts` (`legacyHistoryToDurable`), `src/contexts/__tests__/useHistory.test.tsx`,
`src/contexts/__tests__/history-replay.test.ts`

---

## 32. Every selection change now appears as a "Selection" row in the History panel

**Problem.** `getHistoryItemTitle` (`useHistory.ts`) special-cases a tool `layerSource`,
`TOOL_ACTION` and the crop, and otherwise **falls through to the raw action
name**. `HistoryTab.tsx` renders that string, so a `SELECTION_ACTION` entry is labelled
with the constant's own value.

That was invisible while selections wrote no history. It is not any more. Every one of these appends
one real entry through `commitSelection` / `clearSelections` / `appendSelectionClear`:

| gesture                                                          | append site                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Clear/Deselect control, and the tool switch                      | `clearSelections` / `appendSelectionClear` in `useSelectionHistory.ts`, and `goToTool` in `useApp.ts`    |
| magic-wand click                                                 | `handlePointerDown` in `MagicWandToolArea.tsx`                                                           |
| rectangle drag end                                               | `onChangeEnd` in `RectangularSelectionToolArea.tsx`                                                      |
| polygonal / freehand lasso close, feathered magnetic lasso close | `finishSelection` in `PolygonClickToolArea.tsx`, `finishSelection` in `FeatherMagneticLassoToolArea.tsx` |
| polygon's committed anchor or body drag                          | `handlePointerUp` in `PolygonClickToolArea.tsx`                                                          |

So every selection change in a session adds a row, and **one gesture can add more than one kind**: a
lasso gesture appends a creation and a later drag appends a separate move, both labelled identically.
Each row is also a navigation target (`resetHistoryTo(originalIndex)` in `HistoryTab.tsx` —
`handleRewind()`) and carries a disable toggle (`HistoryTab.tsx` — `handleToggleDisabled()`), so a
user can step onto or disable a row whose label says nothing
about what it did — and there is no way to tell a creation from a move from a clear, since all three
carry the same `layerId: 'selection'` and the same action name.

**This is a UX decision, not a defect with one right answer.** The operator chooses between hiding
selection entries from the panel, grouping consecutive ones into a single row, and relabelling them
distinguishably (create / move / clear). Whichever is chosen, the label has to come from
something the entry actually carries; `nextSelectionState` and `previousSelectionState` are already
on the item (`useSelectionHistory.ts` — `commitSelection()`), so a relabel is derivable without a new
history field. Do not add a history field for presentation alone while the legacy timeline is still the
replay authority.

**Files.** `src/contexts/useHistory.ts`, `src/components/SidebarRight/HistoryTab.tsx`

---

## 45. The codecs' raster ceilings disagree, and two of seven have no budget at all

**What this entry is about.** A document between 80 MP and 100 MP **cannot be saved as AVIF at
all** — `saveImageToDisk` throws with the budget message and `useFile.tsx` — `handleImageSave()` logs
it and resolves `null`. That is the right failure (a clamp silently hands back a smaller image), and
the number was not chosen by whoever added the guard.

**Decided 2026-09-28: the 80 MP ceiling stands.** The operator was asked to choose between raising
`MAX_AVIF_PIXELS` to TIFF's `MAX_CREATABLE_DOCUMENT_PIXELS` derivation and accepting the export loss,
and chose to keep 80 MP. So **New ▸ A3 @ 1200 dpi is not AVIF-exportable in this build, by
decision** — do not "fix" that by raising the number without asking again, and do not write the
decision into `docs/OVERRIDES.md`, which is the operator's file and which records departures from
Adobe rather than this. The remaining work is the other-format gap below, not the ceiling.

**The rule that must survive.** Above a ceiling the file is **rejected with an error, never clamped
or downscaled**: a clamp silently hands the user a smaller image than the one they opened, and a
rejected file loses nothing. The TIFF byte ceiling also has a recorded provenance worth keeping —
`MAX_TIFF_BYTES` is the app's largest creatable document at 16 bytes per pixel, which is what
`UTIF.decodeImage` allocates for the **page** of a 4-sample RGBA file (`Math.min(32, t258[0])` bits
per sample, times the four samples an RGBA page carries) — and `MAX_TIFF_PIXELS` is that same budget
read at 8 bytes per pixel, so the two agree by construction rather than by coincidence. That
derivation is what makes a different number defensible if the ceiling is ever revisited. It is a
budget on the page term, though, not on every byte UTIF can allocate: a tiled page adds a second
buffer sized by `t322`/`t323`, so what the ceiling is compared against is the page and tile together
and a page nowhere near this figure can still exceed it.

**Five ceilings exist and three are below what the dialog can create:**

| ceiling                             | value       | where                                              |
| ----------------------------------- | ----------- | -------------------------------------------------- |
| largest document the app can create | 100,000,000 | `MAX_CREATABLE_DOCUMENT_PIXELS` in `tiff-utils.ts` |
| affine transform                    | 67,108,864  | `MAX_AFFINE_PIXELS` in `affine-transform.ts`       |
| PSD                                 | 67,108,864  | `maxPixels` in `psd-utils.ts`                      |
| AVIF, open and save                 | 80,000,000  | `MAX_AVIF_PIXELS` in `avif-utils.ts`               |
| TIFF, open and save                 | 200,000,000 | `MAX_TIFF_PIXELS` in `tiff-utils.ts`               |

The two 64 MP constants are the same number written twice, independently, in files that do not
import each other. A 100 MP document can be saved as BMP, GIF, SVG and TIFF, but not as AVIF and not
as PSD. "One exported `MAX_RASTER_PIXELS`" would have to reconcile **five** constants, not one, and
that reconciliation is the reason the BMP ceiling below is filed rather than fixed: choosing a number
is cheap, and choosing it in one place is the decision nobody has taken.

**Two codecs have no raster budget in either direction, and three bound nothing on the way in.**

| codec | loader budget | encoder budget | check before the allocation it bounds? |
| ----- | ------------- | -------------- | -------------------------------------- |
| avif  | yes           | yes            | yes                                    |
| tiff  | yes           | yes            | yes                                    |
| bmp   | **none**      | **none**       | n/a                                    |
| gif   | **none**      | 65535/axis     | yes, on the encoder                    |
| ico   | 256/axis      | 1..256/axis    | yes, on both                           |
| svg   | **none**      | **none**       | n/a                                    |
| psd   | yes           | yes            | yes — the reference implementation     |

`psd-utils.ts` — `validateSize()` runs ahead of the decoder, the same ordering `tiff-utils.ts` —
`assertIfdWithinBudget()` has, so the PSD column is the shape the others were measured against
rather than an exception to it. What the table leaves open is the loader column for `gif`, `svg` and
`bmp`, and the whole of `bmp` in both directions.

**The ICO loader ceiling is this build's rule, not the format's, and it narrows what opens.** A DIB
entry declares its geometry in a header and a PNG entry only in the stream the browser decodes, so
`ico-utils.ts` reads the former directly and the latter out of the PNG's `IHDR` chunk before
handing the bytes to the browser. Both are held to the same 256 the encoder enforces, so that a file
which opens can be saved back. The consequence worth knowing before changing it: an ICO whose
selected entry decodes above 256 on either axis — a 512×512 PNG entry, which Windows opens, because
it takes that geometry from `IHDR` too — is refused here. Round-trip coherence is the reason, and
loosening the load side reintroduces documents this build then cannot write.

**BMP is the worst amplification.** `bmp-utils.ts` — `decodeBmp()` bounds the input by its on-disk
byte length and then allocates `width * height * 4` regardless of depth, so the ratio is exactly
`32 / bitsPerPixel` — a 20000×40000 1-bpp BMP needs 100 MB on disk and allocates **3.2 GB**, with no
absolute pixel ceiling anywhere in the file. `bmp-utils.test.ts`'s largest geometry is 7×4, so no
test can reach an interesting ratio. The fix is one comparison before the `width * height * 4`
allocation; the open question is the number, and it has to be one of the five above rather than a
sixth.

**Owned, so recorded not fixed:** `image-load-save-utils.ts` — `loadImageFile()` is the load path for
GIF and SVG and bounds nothing — the whole file is base64-encoded into a data URL and handed to
`new Image()`. That is where a shared load-side ceiling would have to live for those two formats.

**Files.** `src/contexts/bmp-utils.ts`, `src/contexts/image-load-save-utils.ts`,
`src/contexts/avif-utils.ts`, `src/contexts/tiff-utils.ts`,
`src/contexts/affine-transform.ts`, `src/contexts/psd-utils.ts`

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

`src/components/SidebarLeft/__tests__/harness.tsx` is a shared render harness, and its
docstring says a suite must import it before `../SidebarLeft.tsx` so its hoisted `vi.mock` calls
apply. **Exactly one suite does** — `SidebarLeft.tablet.test.tsx`, whose `useSidebarLeftHarness`
import does it the required way. The other ten — `SidebarLeft.cleanup`, `SidebarLeft.color-pickers`,
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

**Files.** `src/components/SidebarLeft/__tests__/harness.tsx` and the ten
`SidebarLeft.*.test.tsx` files listed above.

---

## 55. The `EXCLUDED-touched-by-prior-campaigns` manifest is not a safe boundary

**Problem.** `.kilo/reviews/2026-09-27-untouched/scope/EXCLUDED-touched-by-prior-campaigns.txt` is
what a fixer reads to learn which files a prior campaign owns, and entries in this file that name it
are written entirely in terms of it. It lists 136 files (`wc -l`). Reconstructing the true set from
the session store instead — every `apply_patch` / `edit` / `write` target in a session whose
`model.providerID` is `openai`, which was 60 GPT sessions when it was measured — returns
**72 `src/` files the manifest does not list**, and several of them are load-bearing for entries here:

Re-derive the table from the entries this file still carries rather than reading it off this entry —
the entries it was built from have been deleted. Collecting every `src/` path named in the `Files`
paragraph of a numbered entry and comparing it against the manifest returns **78** the manifest does
not list — one of them a directory rather than a file, `src/components/ToolbarHorizontal/`, which §134
names in that form — and the omissions are exactly where the migration's own boundary lives:

| not in the manifest                                           | live entries whose `Files` line names it |
| ------------------------------------------------------------- | ---------------------------------------- |
| `src/contexts/history-model.ts`                               | 10, 56, 172, 197                         |
| `src/contexts/presentation-evaluator.ts`                      | 1, 159, 163                              |
| `src/contexts/durable-replay.ts`                              | 94                                       |
| `src/contexts/psd-utils.ts`                                   | 45, 56, 147, 166, 169, 172               |
| `src/contexts/layer-types.ts`                                 | 56, 172                                  |
| `src/components/SidebarLeft/toolIcons.tsx`                    | 116                                      |
| `src/tools/fill.ts`                                           | 47, 122                                  |
| `src/tools/rectangularSelection.ts`, `ellipticalSelection.ts` | 59, 115                                  |
| `src/tools/quickSelection.ts`                                 | 59                                       |
| `src/tools/draw.ts`                                           | 163, 164                                 |

So an entry whose `Files` line names only unlisted files reads as unblocked when it is not. The
sharpest case is the one this entry originally turned on: `src/tools/draw.ts` is absent from the
manifest, and its absence is incompleteness, not permission — the same reasoning applies to every
row above.

**A second, live ownership axis the manifest has no notion of: the unmerged branches.**
`git branch --no-merged main` is the command, and every branch it names is a file set the manifest
cannot see. Derive the count when you need it rather than reading a number off this entry: it moves
every time a session lands work, and the branches named here when this entry was written are gone
from the repository. An entry can therefore read as unblocked on BOTH axes at once, which is the
failure the manifest's completeness claim would have to cover to be a boundary at all.

**Fix.** Regenerate the manifest from the session store rather than maintaining it by hand, and
extend it with the unmerged-branch file set. Until then, treat "not in the manifest" as carrying no
information at all, and derive ownership the way this entry does before touching anything.

**Reproduce the live-entries half.** It is the cheap half and it is exact, so run it before the
session-store one. It takes the first `Files` paragraph of each numbered entry, and it has to be run
from the main checkout: the manifest is gitignored under `.kilo/`, so the relative path below resolves
only there.

```bash
awk '/^## [0-9]/{f=0;s=0;next} f&&/^\*\*[A-Z]/{f=0} !s&&/^\*\*Files\.\*\*/{f=1;s=1} f' HANDOFF.md \
  | grep -o '`src/[^`]*`' | tr -d '`' | sort -u > /tmp/handoff_paths.txt
comm -23 /tmp/handoff_paths.txt <(sort .kilo/reviews/2026-09-27-untouched/scope/EXCLUDED-touched-by-prior-campaigns.txt) | wc -l   # -> 78
```

Those paragraphs name 125 distinct `src/` paths, 47 of them in the manifest. `sort -u` is what makes
the answer a count of paths rather than of entry-path pairs, which is 244. Two `Files` paragraphs in
the file are deliberately outside the extraction and neither changes the count: §142 carries a second
one that names no `src/` path at all. The live §159 entry is headed and its `Files` paragraph names
the real `src/hooks/usePaintStroke.ts` path.

**Reproduce the session-store half.** The count was 72 `src/` files on 2026-09-27 and is not
re-derivable cheaply — the store is large and grows. The `lightshopy.com` clone is the reason both
path prefixes and the
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

**Verified by cross-check, not assertion** (measured 2026-09-27; the shape of the cross-check is the
point, not the tallies): the reconstruction also audited the other write vectors
and found them clean — of 974 `bash` calls in GPT sessions there is no `sed -i`, `perl -i`, `tee`,
`patch`, `git apply` or shell redirect that writes a tracked file. The only files the tool-call
reconstruction misses are `package.json` and `package-lock.json`, via `npm install ag-psd` and
`npm uninstall @floating-ui/react`. Note also that `/Users/bkalynovskyi/WebstormProjects/lightshopy.com`
is a **clone of this same repository** (identical `origin`, and this HEAD is a descendant of its
`1ddc968`), so 317 of those commands target this codebase from another path and a
`grep -rn 'lightshopy'` on the session store misses them.

**Files.** `.kilo/reviews/2026-09-27-untouched/scope/EXCLUDED-touched-by-prior-campaigns.txt` (not
tracked; gitignored under `.kilo/`), and the `Files` line of every entry named in the table above.

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
scanned. It is recorded on its own now: the registry half that used to sit beside it — the append
boundary's missing asset-registry transaction — is fixed, and the store opens a document asset
transaction around every planned source-backed publication, commits it only after the state is
published, and reconciles the exact set the published document names. That fix made asset ownership
on the append path a settled question and left this as the one place where the **presentation**
scope's liveness set and the registry still have to agree without saying so. The invariant is
cheapest to pin as a test now, while it is still unstated rather than load-bearing.

## 66. A refused pointer gesture is a silent no-op on the document

`src/hooks/usePointerPosition.ts` — `isPointerDownValid()` and `isPointerUpValid()` — and every
tool area that calls its validators as a bare guard.

`isPointerDownValid` refuses a non-primary button, refuses any press while
`activePointerId` is already set, and only then records the id and takes pointer
capture. `isPointerUpValid` refuses a non-primary release and a release whose id
does not match, and only then clears. Both return `false` and nothing else. Every
caller treats that as "this gesture is not mine" and returns early — with no
log, no thrown error, and no entry in the store. `DrawToolArea` is the clearest
case, because the commit lives in `handlePointerUp` and nowhere else
(`DrawToolArea.tsx` — `handlePointerUp()`), so a refused release means the
whole stroke vanishes: no layer, no history entry, no pixels, and the tool
overlay cleared anyway by the `overlayCtxRef.current?.clearRect(…)` at the end of
`handlePointerUp()`.

That silence is the defect, and it is separate from any particular race. Every
other writer in this codebase either publishes a history entry or reports; a
gesture that is dropped reports nothing at all, so a lost stroke and a
successfully drawn one are the same observable state. Two callers are already
known to need a reason for a refusal and cannot get one:
`EraserToolArea.tsx` — `handlePointerUp()`'s `releaseDocumentClaim()` comment says a release the
validator refuses must
not hand the document back, which is only checkable by instrumenting the
validator; and `TEST-FLAKES.md` §8 records an e2e failure that surfaced as a bare
ten-second pixel timeout against a canvas that was never going to change, which
is this shape seen from outside the browser. **Whether a refusal has ever
actually fired is not known** — this is an unstated invariant with no
demonstrated occurrence, recorded as §63 is, and the cheapest thing that would
settle it is a `console.warn` carrying the reason at each of the four early
returns, which is a product decision rather than a test one.

---

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

**`toolbar-mapping.ts` — the doc comment above `toolbarMap` says "Unsupported Photoshop tools are
intentionally omitted rather
than represented by placeholder values." That sentence IS the requirement, and it has to be
deleted, not kept.** Separately: `SidebarLeft.tsx` — the module-level `const toolbarGroups =
toolbarMap.flat()` discards the
map's section boundaries entirely, so the five current sections are not Photoshop's separators and
the new layout has to decide deliberately whether a section concept survives at all.

**Deletions, cheapest first.** `color`, `levels` and `transform` become menu commands, and their
processors are reused unchanged — but this is **not** the pure routing change with "the history and
durable paths untouched" that this line used to claim, and the claim was refuted before it shipped:
`'color' | 'levels'` are a **durable schema type** (`src/contexts/history-model.ts` — `DurableFilter`,
`src/contexts/layer-types.ts` — `LayerOperationArgs`), so every already-committed operation of either
crosses the durable
boundary whether or not the surface it was minted from moves. `shape` dissolves into the five figure
`ToolName`s that
already have processors and are already dispatched. `draw` is last and is the expensive one: it is
the suite's default way to make a mark, **25 call sites across 14 e2e specs**, and
`e2e/pen-types.spec.ts` is specifically about it and dies with the tool. Its engine does not die —
`brush`, `pencil` and `color-replacement` are all built on `buildDrawArgs` and `draw()` — only the
tool goes, and the engine should be renamed to stop pretending to be one.

**Cheapest real additions**, and they are parallelisable because they touch disjoint files: Single
Row and Single Column Marquee (SHIPPED 2026-10-01, `src/tools/singleRowColumnMarquee.ts`; the
phrase "two lines of geometry reusing `rectangularSelection`" held up), Sponge, Red
Eye, and Star (a new `FigureType` member plus a star-ratio branch). Next cheapest architecturally
is the measurement band — Color Sampler, Note, Count — because these are `PIXEL_FREE_TOOLS` like
the Eyedropper and the Ruler, committing no pixels and needing no durable operation. **The Ruler is
built**: `src/tools/ruler.ts` for the arithmetic, `src/components/Main/RulerToolArea.tsx` for the
gesture and the nonprinting overlay, and `src/components/ToolbarsRight/Ruler/Ruler.tsx` for the
readout bar. What it still lacks is the `Image ▸ Analysis` measurement scale, which is a menu
command rather than a tool and belongs with the menu gaps rather than here.

**Largest, and they need a primitive the app does not have:** Object Selection, Spot Healing,
Content-Aware Move, Remove (a generative backend), History Brush and Art History Brush (a read-out
across the whole history array, which touches the replay boundary), Vertical Type and its two
masks (glyph→selection rasterisation), Path Selection and Direct Selection (a path model absent
from `src/tools/shape.ts` entirely), and Artboard and Frame (layer kinds the app has no type for).

**One step is a baseline hazard and belongs on its own branch:** Hand, Zoom and Rotate View. The
app's zoom state is commented out (`StoreContext.tsx` — the commented-out `// zoom data` block;
`ZoomData` survives only as a
type), so the seam exists and the state does not. It is small in lines and large in blast radius,
because it touches the renderer and every e2e screenshot baseline.

**The first step is the highest-value thing in the plan and it is not a feature:** land the target
as data, and add a test asserting the **set of rail labels** equals the target set — not the order,
not the tiles. Any future invented tool fails it. It is cheap, and it is the tripwire that makes the
other eight steps safe.

**What this costs in tests, before a single tool is added.** The hand-copied lists are the expense,
and they are already drifted: `constants.test.ts` — the `it('names a tool that exists in the tool
registry')` title holds a hand-copied
29-name list that is **12 short of the real 41** and passes only because its assertion is
`toContain`. `toolIcons.test.tsx` — `toolIconNames` holds a 46-name union by hand;
`tool-processors.test.ts`
carries four separate 41-name and 10-name rosters; `SidebarLeft.rendering.test.tsx` — the
`it('renders the available tools in Photoshop-inspired order')` title pins
the exact 16-tile order by name; and `toolbar-mapping.test.ts` — the `it('lists the shape flyout in
the exact expected order and shape')` title compares a hand-copied
expected shape flyout with `toEqual`, so **an added key on any shape entry breaks it**.
`AppKeyboardShortcuts.tsx` — the doc comment above `brushGroup` asserts in prose that its cycle
groups match the mapping's groups;
**one of its seven does not** — the Pen tile is six wide and its cycle is three. Nothing tests that
claim. And `availableTools` /
`extraTools` have **no production consumer at all** — only tests read them — so a silent omission
there produces three green tests over an incomplete app.

## 76. A closure check reported "3 FIXED" for work that was already fixed before it ran

A verification pass was asked to confirm that 45 identified defects had been closed, and it
reported **3 fixed, 41 absent, 1 regression**. All three "fixed" verdicts were wrong, in the same
direction and for the same reason: the pass was given the _merged_ tree, where `main` had already
absorbed the corrections, and compared it against nothing. It read the presence of a correct value
as the work of a fix that had not happened there.

Re-derived against the actual pre-fix commit `13f44a1`, all three were already correct:

| Reported as fixed by the fix pass               | Actually already true at `13f44a1`                                   |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| color-replacement `placeholder` → `partial`     | `'partial'` already, `paintDescriptions` — `'color-replacement'`     |
| rectangle and ellipse `implemented` → `partial` | `'partial'` already, `shapeDescriptions` — `rectangle` and `ellipse` |
| levels black/white point `partial` → `missing`  | `'missing'` already, `transformDescriptions` — `levels`              |

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
`if (open && record.level <= open.level) close(...)`. At filing time, `HANDOFF.md` §15a was a **level-2**
`## 15a. A self-anchored reorder is refused, and the refusal is load-bearing`, a sibling of
`## 15.` — so it **closed item 15's body there** and opened nothing itself. The span
`HANDOFF.md` §15a occupied is **876 raw characters**, or **874** once the span's leading and
trailing blank lines are trimmed — 874 is the trimmed count, and the raw count is the one
that includes them. The first `---` rule inside that span is one `bodyOf` drops as layout, so the
prose the parser actually stranded was everything between the `## 15a.` heading and that rule. All of
it was unreachable from any item title or body. These measurements describe the document before
the reorder issue and its tripwire heading were deleted.
Item 15's stored body at that revision was 3994 chars and ended mid-sentence; the 15a prose was not in it. The
entry is a load-bearing tripwire, so this is live work loss, not latent.

**Both counts were wrong on the way in, and the correction is self-stable.** The span's text is
byte-identical across every base this entry has been re-derived against, so **its length cannot
change when the line numbers move** — and two earlier revisions "corrected" `872 → 873` and
`870 → 871` for a span that measured the same both times. `comm` over the region's bytes, not a
re-read of the number in the prose, is the only check that catches this: the raw count includes
the digits of the count itself, so replacing three digits with three digits leaves it unchanged
and needs no second pass. **The measured item 15 body was 3994 characters**: it sat upstream of
every hunk in this entry, and it was the one number here that could not be measured without the
parser, which is exactly why an unmeasured number must not be edited.

**The same root cause, opposite direction, and worse: a suffixed retirement retires the parent.**
`deadNumbers('## 15a. An old thing — deleted')` returns `[15]` — `NUMBER_OR_RANGE` harvests the
`15` out of `15a` — so item 15 is silently filed as _finished_ by a heading that says `15a` is done.
`## 15a, 16. Old things — deleted` returns `[15,16]`. This is silent corruption, not silent loss,
and a fix that only widens `NUMBERED` does not address it.

**Why the test suite cannot see either.** The `it('produces one item per numbered heading, and no
item for a prose section')` title's own heading-count regex
carries the **identical** `\d+\b` blind spot, so `items === headings` holds for `## 15a.`,
`## 15b.` and `## 16a.` simultaneously. Both sides miss it; the equality stays green. At the time
this was measured, the corpus had exactly one such heading, `## 15a`; that heading was later removed
with the resolved reorder defect. Proven: with `NUMBERED` fixed and the count regex
left alone, the count test fails. **The quoted output `expected 38 to be 37` was measured at
`a3f1dcc`**, the campaign branch tip, against that branch's `HANDOFF.md` — 37 headings under the
count regex, 38 items once the suffix is accepted. On `main` the same projection reads
**`expected 49 to be 48`** — 48 headings under the count regex, 49 once the suffix is accepted —
re-measured at **`0d64d75`**, the tip of `main` this branch merges. Neither number reproduces
unless the tree is named, and the assertion itself is the
`expect(doc.parsed.items.length).toBe(headings)` inside that same `it` title. Note that a
_naive_ `NUMBERED` patch does not produce 49: it maps
`15a` to `Number('15a') === NaN`, and folding it to `15` instead collides with the live
`HANDOFF.md#15` and loses it to first-occurrence-wins — the same collision the `makeItem` row
below describes. The projection only holds for a fix that gives the suffix its own origin, which
is the open design question under this table.

**A real fix must change all of these together:**

| Where                                                                                                                 | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handoff-import.mjs` `NUMBERED`                                                                                       | the suffix, and its case rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `handoff-import.test.mjs` — the `it('produces one item per numbered heading, and no item for a prose section')` title | the count regex, same blind spot. The `it('reads a numbered document as one item per number, in document order')` title's `HEADING_NUMBER` has it too, so there are **three** grammars to keep in step, not two. **"Hoist all three to module constants" is wrong as it stands**, and wrong on all three rows: the count regex is an inline regex literal handed straight to `countHeadings`, and `HEADING_NUMBER` is a `const` declared **inside an `it()` body** — already named, but test-local, so it agrees with nothing and hoisting it changes only where it sits. The one grammar that _is_ a module constant is `NUMBERED`, in the other file. The fix is therefore one shared constant for the two test-side grammars, declared once at module scope |
| `handoff-import.mjs` `makeItem`                                                                                       | `` `${base}#${number}` `` — `Number('15a')` is `NaN`, so every suffixed entry gets a literal `#NaN` origin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `handoff-import.mjs` `planImport`                                                                                     | the `/#(\d+)$/` dead-set filter cannot match `#15a`, so a suffixed item can never be suppressed by the document's own dead list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `handoff-import.test.mjs` — the `it('does not file a number the document records as finished')` title                 | both of its `?.[1]` reads, one over each parsed item and one over each created origin. The **unguarded** `Number(/#(\d+)$/.exec(item.origin)[1])` this entry used to cite is **gone from `main`** — `a14d728` ("close the eight findings from the board's review") replaced it with the guarded `?.[1]` there. There is no unguarded form left to fix here; the obligation moves to whoever writes the `## 15a.` assertion                                                                                                                                                                                                                                                                                                                                     |
| `handoff-import.test.mjs` `liveItems`                                                                                 | which the same row used to point at as the place to copy. It does **not** use `?.[1]`: it is `!number \|\| !parsed.dead.includes(Number(number[1]))`, guarding on a separate statement. The guarded form to copy is the `it('does not file a number the document records as finished')` title                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `handoff-import.mjs` `deadNumbers`                                                                                    | the dead set is `number[]` end to end — typedef, both `Set`s, and `planImport`'s `.map(Number).filter(Number.isInteger)`. It cannot represent a non-integer at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

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
The `draw` entry in `toolbarMap` gives the non-Photoshop `draw` entry `shortcut: 'B'`, the same letter
the Brush's own entry gives. The badge is rendered from the map
(`SidebarLeft.tsx` — the `<kbd>` badge inside `renderToolGroup()`), so the user is told the Draw Tool
answers to `B`; and
`AppKeyboardShortcuts.tsx` — `brushGroup` = `['brush','pencil','color-replacement','eraser']` puts
`b` on the brush group,
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

**3. Nothing asserts that two tools cannot share a letter.** `toolbar-mapping.test.ts` — the
`it('only declares U as the shape shortcut')` title
checks the `U` group and nothing else, so a `B`/`B` collision is invisible to the suite. One
`expect` over the flattened map's `shortcut` values would have found defect 1 on the day it
shipped. Note the trap it must not fall into: `draw` and `pen` variants legitimately share a
letter with their group leader, so the assertion is "no letter is claimed by two _different_
groups", not "no letter repeats".

**These are filed, not fixed.** Deleting `draw` and re-grouping the flyout are §74's work, and
doing them here would land the deletion without the replacement rail.

## 80. Five components fold `!isBedrock` into `usePaintStroke`; four of them gained a test, and `CloneStampToolArea` is the one that did not

A correction, because a wrong claim in this repository's own history is read by every future agent
that runs `git log`. `b001d7d` states that five components fold `!isBedrock` into the flag they
hand `usePaintStroke` — Dodge, Burn, Smudge, CloneStamp and Gradient — "and not one had a test".
Both halves need narrowing, and the error in the second one is about coverage rather than about
the flag.

The list of five is **correct**: the `enabled` / `isEnabled` each of `DodgeToolArea.tsx`,
`BurnToolArea.tsx`, `SmudgeToolArea.tsx`,
`CloneStampToolArea.tsx` and `GradientToolArea.tsx` computes from
`activeLayer && !activeLayer.isBedrock` and passes to `usePaintStroke`. What is
wrong is "not one had a test" as a description of the finished branch: `b001d7d` added suites for
four of the five, and **`CloneStampToolArea` still has no test file** — `git ls-tree main --
src/components/Main/__tests__/` answers none. The fifth area the commit covers is
`EllipticalSelectionToolArea`, which is **not** one of the five: it imports no `usePaintStroke`
and reads no `isBedrock`. It is a selection tool, and the rule it shares with the four is nothing
more than "the suite mounts a store fixture and drives real pointer events".

Two components read `isBedrock` without `usePaintStroke` and must not be counted into that set
either: `CloneStampToolArea` folds it into `isEnabled` **and** uses `usePaintStroke`, so it is
in; `MoveToolArea.tsx` — `activeLayerRect`, `EraserToolArea.tsx` — its own `isEnabled` — and
`FillToolArea` — its bedrock early return — read the flag directly
and are out of it. **The cheapest thing that settles whether `CloneStampToolArea` is actually
covered is a test, not a sentence** — and until one exists, treat the "not one had a test" claim
as four, not five.

## 81. The two `it.fails` on the polyline animation loop were mock artefacts, and the production comment that justified them is stale

`src/hooks/usePolylineAnts.ts` — the stale comment above the `isPaused` effect, whose closing three
lines are quoted in (c) below

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
`usePolylineAnts.ts` guards a pending frame three times — `clear()`'s cancel, `draw()`'s cancel before
rescheduling and the `isPaused` effect cleanup's cancel — and all three are
`if (animationIdRef.current)`. `useAnts.ts` does the identical job for the identical
pending-frame bookkeeping: `clear()` uses `if (animationIdRef.current !== null)` and
`schedule()` uses `=== null`. `useAnts` nulls the ref immediately after cancelling, so `0` and `null`
are genuinely
distinguishable there; `usePolylineAnts` never produces `0` either way, which is why the
truthiness form is currently correct. **It is correct by the spec argument in (a), not by
construction**, and the sibling in the same directory is the standing counterexample to "0 cannot
happen" — which is a local property of one file's mocks, not of the platform.

**(c) The comment above that same `isPaused` effect is stale and asserts the branch removed.** It
reads:

> A pending handle of 0 is the one case the cleanup's own truthy guard skips, but 0 is falsy here
> too, so cancelling here never had anything to do. That falsy-0 path is why pausing with frame 0
> pending does not stop the loop.

The last sentence is the claim the `it('stops the loop when paused before the first frame has run
…')` title in `usePolylineAnts.animation.test.tsx` now
**falsifies**: that test asserts that pausing before the first frame has run _does_ stop the loop, and
its own comment cites the `isPaused` effect cleanup's `if (animationIdRef.current)` — the very guard
this comment
describes. The repo currently holds a production comment
saying the loop does not stop and a test saying it does, and only one of them can be right.

**When production is next touched, the stale comment above `usePolylineAnts.ts`'s `isPaused` effect
must be corrected or deleted**, and
the **four** sibling counters that still start at `0` — the `let nextId = 0` in
`useSelectionAnts.test.tsx`, `useAnts.test.tsx`, `usePolylineAnts.test.tsx` and
`useAnts.transform.test.tsx`, all four of them `.test.tsx` — should move to `1` in the
same change, so the **five** rAF mocks in `src/hooks/__tests__/` stop disagreeing about a value the
platform fixes; only `usePolylineAnts.animation.test.tsx` counts from `1` today. Switching the three
guards to `!== null` to match `useAnts` is the durable fix and makes the whole
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
heading-count assertion — `scripts/__tests__/handoff-import.test.mjs`, the
`it('produces one item per numbered heading, and no item for a prose section')` title — matches
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

| Heading                                                                                                                                                                                         | Now                | Separator required |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------ |
| `## 13. Landed, superseded and deleted` (pinned fixture, `handoff-import.test.mjs` — the `it('reads a heading that ENDS with a status marker as a retirement, in every separator form')` title) | `dead=[13]`        | `dead=[]`          |
| `### Items 5, 7, 9, … — deleted` (this file's preamble heading, the corpus's **only** real retirement)                                                                                          | `dead=` 26 numbers | `dead=[]`          |
| Whole `HANDOFF.md` — `planImport(...).create`                                                                                                                                                   | 49                 | **51**             |

The second row is the one that decides it. That preamble heading is the one the `DEAD_HEADING`
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
actually reports it. The importer now reports duplicate numbered origins, but that does not
identify this different status-word case. The operator should choose which of the two behaviours a
mistyped heading should have.

**Pinned while unfixed, as an `it.fails` tripwire.** `scripts/__tests__/handoff-import.test.mjs`
holds the shape in `it.fails('keeps a LIVE numbered heading that ends in a status word as an open,
filed item')`: the body asserts what a **fixed** parser returns, so it is red today and the `fails`
is what makes the suite green. It is the marker the repo already uses in ~20 places
(`image-processors.test.ts` — the `it.fails('clamps a negative or non-finite radius into a valid CSS
filter …')` inside `describe('tool image processors')`, whose title carries its own stale
`src/tools/blur.ts` citation; and `StoreContext.durable-boundary.test.tsx` — the `it('uses the
replacement document baseline when updates omit totalSize and documentFrame')` title) and the one
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

## 86. `useRect`'s border still sits still for the three callers that are not a selection

**Problem.** `useRect` strokes its border with a fixed dash pattern and only advances it in
`'while-dragging'` mode:
`ctx.setLineDash([5 / scale, 5 / scale]); ctx.strokeRect(x, y, width, height);`
(`useRect.ts` — `drawMask()`). The file's `requestAnimationFrame` in
`handlePointerMove()` throttles the DRAG, not the border: it recomputes the rect and calls
`drawMask(true)`, which redraws the same fixed dash. The three non-selection callers use `'always'`,
where the offset stays zero.

**The committed selection border is no longer the remaining gap.** Every selection tool's
committed border is the same animated loop — `Main.tsx` — `SELECTION_INTERACTION_MODES` — admits all
seven selection modes, `useSelectionMarchingAnts` strokes every active selection whatever made it,
and the static stroke the elliptical marquee and quick selection used to hand-roll is gone from
`selection.ts`. The rectangular marquee's temporary border now advances while the gesture is in
flight. The three callers that are not selections still use a static border.

**`useMarchingAnts` is a fourth border and reaches none of them.** Its only production consumer is
`MoveToolArea.tsx` — its `useMarchingAnts()` call, which paints the outline of a **hovered layer**
in `reposition` mode. So "marching ants on a rectangle" is the Move tool's layer outline, and the
crop rectangle, the move rectangle and the text frame have no loop that could reach them.

**The one thing NOT to change here.** `borderMode: 'while-dragging'` is load-bearing for the
rectangular selection and must keep its current meaning (`useRect.ts` — `drawMask()`): the marquee
being dragged is the only evidence of itself, because a marquee in progress has not been committed
and so has no ants, and the ants stand down for the duration so the committed rectangle does not
appear beside the one being dragged. Animating the border must not move it out from under that
gate, and must not be applied to the handles, which are the resize hit area.

**It affects four tools, not one.** `useRect` is shared by `MoveToolArea` — its `useRect()` call —
`CropToolArea`, `RectangularSelectionToolArea` and `TextToolArea`, each reached through their own
`useRect()` call. Three of them stroke the still border whenever the rect is drawn; the rectangular
selection strokes it only between press and release.

**Fix.** The marquee's `'while-dragging'` stroke now has its own RAF loop and advances
`lineDashOffset` at a scale-adjusted screen speed. The remaining decision is whether the three
non-selection `'always'` borders should animate; do not extend the marquee loop to that mode without
deciding their intended behavior.

- If a later change elects to animate those three borders, give that behavior an explicit mode and
  focused coverage. `'always'` must remain static unless that decision is made.
- Moving the rectangular marquee border to the ants canvas is a separate alternative, not needed
  for its in-flight crawl: `useRect` draws the dim-out scrim, border and corner handles in one
  `drawMask()` pass, so separating them would require moving the handles too or the scrim would wipe
  the ants mid-drag.

The dash pattern remains `[5 / scale, 5 / scale]`; the two existing `setLineDash` assertions in
`useRect.drag.test.ts` remain valid. The focused animation coverage checks the offset advances in
`'while-dragging'` and remains zero in `'always'`.

**Files.** `src/hooks/useRect.ts` — `drawMask()`, `handlePointerMove()`; `src/hooks/useAnts.ts` —
`useMarchingAnts()`; `src/components/Main/MoveToolArea.tsx` — `MoveToolArea`; `src/components/Main/CropToolArea.tsx` —
`CropToolArea`; `src/components/Main/RectangularSelectionToolArea.tsx` — `RectangularSelectionToolArea`;
`src/components/Main/TextToolArea.tsx` — `TextToolArea`; `src/hooks/useSelectionAnts.ts` —
`useSelectionMarchingAnts()`; `src/hooks/__tests__/useRect.drag.test.ts` — the two `setLineDash`
titles named above

## 94. A skipped duplicate leaves the fold advanced, so a later `set-document-frame` can carry a `previous` the durable history never reached

**Problem.** When a duplicate id is skipped, the publication is withheld and the **fold state is
deliberately left advanced** (the duplicate-id skip inside `legacyHistoryToDurable()` in
`history-adapter.ts`). That breaks the invariant the frame derivation states in its own docstring —
`deriveSetDocumentFrameEntry()`'s, which documents `currentFrame` as the last enabled **durable**
frame — so a later `set-document-frame` that supplies no `previousFrame` takes its `previous`
from `currentFrame` (inside `deriveSetDocumentFrameEntry()`) and publishes a frame the durable
history never reached.

**User-visible failure, today: none.** Nothing reads `previous`. Durable replay applies `next` only
(the `'set-document-frame'` case in `durable-replay.ts`), exactly as `set-selection` applies `after`
only (the selection case in `durable-replay.ts`). This is a latent hazard for the day something does
read it, not a live
wrong answer — recorded here so the day it stops being latent is not also the day the advance is
"fixed" by someone who has not read this.

**The advance is deliberate and must not be undone.** `replayHistory` addresses entries by position
and has no id check, so it **applies both** repeats and ends in the same
fold state the converter holds. Not advancing would add a second, independent way for a later
derivation to disagree with the legacy timeline — the converter would then differ from both the
document and itself. Parity is the reason; the stale `previous` is the price, and it is a price
worth paying while `previous` is unread.

**Fix.** Not a fix to the advance. When something starts reading `previous`, the invariant has to be
restored then — most likely by recording the durable-reachable frame separately from the fold — and
that change must re-point the `it('leaves the frame fold advanced, so the next derived frame starts
where the skipped repeat ended')` and `it('leaves the layer fold advanced, so a reorder after a
skipped repeat is not derived from stale order')` titles in
`history-adapter.diagnostics.test.ts`, which
assert the advanced fold on purpose.

**Files.** `src/contexts/history-adapter.ts`, `src/contexts/durable-replay.ts`

---

## 95. A refused `PUBLISH_RUNTIME_PRESENTATION` reports an intended no-op as a lost user edit

**Problem.** `StoreContext` refuses the publication when
`layersDifferOnlyByPresentation(currentState.layers, action.payload.layers)` is false
(the dispatcher's `PUBLISH_RUNTIME_PRESENTATION` guard in `StoreContext.tsx`) and logs one
`console.error` for it
(its `Refused a runtime presentation publication that also changes durable layer state` call). The
comment above it already knows the problem
(the same guard, at _"Two refusals share that outcome and mean different
things, so only one of them is reported."_) Two refusals, one message — so the second is not merely
unreported, it is **misreported**: a publication that is a deliberate no-op is logged with the text
of a lost logical edit.

**The second reason is an identity affine operation.** The shape, from the code:

- `normalizeCommittedToolArgs` returns `null` for a transform whose retained history args are the
  identity (`useLayer.ts` — `normalizeCommittedToolArgs()`, tested by `isIdentityAffineTransform()`,
  `affine-transform.ts`), so the operation is dropped from the **history args**.
- The layer record published alongside it is built from the preview and **copies the preview's
  operations array** (`useLayer.ts` — `tempUpdateLayer()`'s transform arm), so the identity operation
  is still on it.
- `pendingToolEdits` is only pushed when the normalized args are truthy
  (inside `commitDirtyTool()` in `useLayer.ts`), so with nothing recorded the commit takes the
  `!pendingToolEdits.length` branch (also `commitDirtyTool()`) and calls
  `publishRuntimePresentation()` (from that same branch) with a payload that differs from
  the stored layer in `operations` alone.
- `layersDifferOnlyByPresentation` (`layer-presentation.ts` — `layersDifferOnlyByPresentation()`)
  compares durable state,
  and `operations` is durable. The publication is refused, and a no-op is reported as an invariant
  violation.

**It is NOT reachable by dragging the rotate slider and releasing.** `Transform.tsx` —
`throttledOnChange()` — calls
`tempUpdateLayer` and nothing else; the option bar's own commit is the `change` event on
`onValueCommitted`, which is a separate listener. The commit is
`commitDirtyTool(true)` in `useLayer.ts` — `commitDirtyTool()`, reached from `goToTool`, a new layer,
or `mergeAllLayers` — the options bar's Apply link, which used to be the fourth caller, was
removed by `c424469a`. So the operation is **staged** by the slider and only meets the
publishing branch when one of those commits — and the `it('discards an identity transform preview
without publishing a layer or history entry')` title in `useLayer.lifecycle.test.tsx` already pins
that a staged identity preview is discarded. Do not write the test for this by moving a slider and
releasing; nothing publishes.

**Why it matters beyond the log line.** The refusal is contained — nothing is persisted and
`previewLayersRef.current` is cleared inside `commitDirtyTool()` — so no user edit is lost.
It is NOT the `tmpCanvas` story the same guard's own
_"a refused publication is a contained no-op: the layer keeps rendering from its tmpCanvas"_ comment
in `StoreContext.tsx` tells for the
other refusal: the transform preview nulls `tmpCanvas` outright (`useLayer.ts` — `tempUpdateLayer()`'s
transform arm), so
there is no cached raster still rendering. What is lost is the signal — a `console.error` reading
"this action's invariant was broken" for a commit that did exactly what the user asked. Once that
text exists, the real violation is the one an operator learns to discount.

**Two tests already pin the message, so this is a change to them, not an addition beside them.**
The `it('refuses a presentation publication that also moves durable layer state')`
title in `useLayer.commit.test.tsx` asserts the call count, the invariant text
and the offending ids — and its own comment already states the two-refusal claim this
entry is recording. The `it('refuses a payload that also changes durable layer state, naming the
offending ids')` title in `StoreContext.presentation.test.tsx` pins the
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
  transition (the `'PUBLISH_RUNTIME_PRESENTATION'` case in `StoreContext.tsx`, which returns
  `{ ...state, layers }` and nothing else), and `replayHistory()`'s `layer-operation` arm in
  `history-replay.ts` rebuilds
  `layer.operations` from history entries. Accepting the payload as-is would publish a record whose
  operations the shadow cannot re-derive. Publishing the STORED record instead makes the preview a
  pure no-op, which is what the user asked for.

Whichever is chosen, two details are load-bearing. `operations` **is** in `logicalLayerState`, because
`PRESENTATION_FIELDS` is only `bitmap` and `tmpCanvas`
(`layer-presentation.ts` — `PRESENTATION_FIELDS` and `logicalLayerState()`), so it must be excluded
explicitly on both sides. And
`getLayerAffineTransform()` skips both non-affine kinds and disabled operations
(`affine-transform.ts`), so the filter must be exactly `kind === 'affine-transform'
&& isIdentityAffineTransform(op.transform)` — and since `createAffineLayerOperation()` mints a fresh
uuid per preview (`layer-utils.ts`), the two sides are only comparable after the
identity entries are removed from **both**.

**Files.** `StoreContext.tsx` — the dispatcher's `PUBLISH_RUNTIME_PRESENTATION` guard and the
reducer case of the same name;
`src/contexts/__tests__/useLayer.commit.test.tsx` — the `it` title named above,
`src/contexts/__tests__/StoreContext.presentation.test.tsx` — the `it` title named above,
`src/contexts/layer-presentation.ts` — `layersDifferOnlyByPresentation()`, `PRESENTATION_FIELDS`,
`logicalLayerState()`; `src/contexts/useLayer.ts` — `normalizeCommittedToolArgs()`,
`commitDirtyTool()`, `tempUpdateLayer()`; `src/contexts/affine-transform.ts` —
`isIdentityAffineTransform()`, `getLayerAffineTransform()`; `src/contexts/layer-utils.ts` —
`createAffineLayerOperation()`,
`src/components/ToolbarsRight/Transform/Transform.tsx` — `throttledOnChange()` and
`onValueCommitted`.

**Origin.** Salvaged from the unmerged `fix/unit-tests` branch, which also carried two
`history-adapter` changes — a duplicate-durable-entry-id filter and a frame-omission diagnostic.
Both have since landed on `main` by other routes (the `publishedEntryIds` check and add inside
`legacyHistoryToDurable()` in `history-adapter.ts`, and that function's `SET_DOCUMENT_FRAME_ACTION`
`else`). The `layer-presentation` predicate was the third part, and it has NOT landed: it is
absent from `main` today, and `fix/unit-tests` remains 2 commits ahead with 13 conflicting files,
`StoreContext.tsx` and `useLayer.ts` among them. Treat the branch as at-risk salvage, not as a clean
source, and re-derive from this entry rather than from its copy.

## 96. Two tracked lines still carry the `e2e/OPEN-PROBLEMS.md` hyphen path, and the spec one has no routed home

**Problem.** The file on disk is `e2e/OPEN_PROBLEMS.md`. The hyphen form `e2e/OPEN-PROBLEMS.md` names a
path that does not resolve — and that is not a macOS-only hazard, because a hyphen and an underscore
are different characters, so it is broken on a case-insensitive volume too.

**Two occurrences of it are live defects, and they route differently.**
The `captureCanvasScreenshot` drift note in `TEST-FLAKES.md` §12 is prose, so this entry is its routed
home. The SKIPPED-BY-DECISION comment above the
`test('line stays under cursor after window resize (normal, wide and narrow)')` case in
`e2e/viewport-drawing.spec.ts` is a comment inside a Playwright spec, so by the routing table in
`docs/DOCUMENTATION.md` §"The single-home rule" it belongs in `e2e/OPEN_PROBLEMS.md` — **and no such
entry exists** (`grep -in 'OPEN-PROBLEMS' e2e/OPEN_PROBLEMS.md` returns nothing). A fix confined to
the prose file leaves the spec comment standing, which is almost certainly how it has survived every
earlier pass.

A third tracked file matches a search for the string — `docs/LAYERS-PANEL.md`, whose §20 item 6 quotes
the census command itself — so re-derive the count with `git grep -n 'e2e/OPEN-PROBLEMS' -- .` rather
than trusting any tally recorded here, including this one.

**`docs/LAYERS-PANEL.md` §20 item 6 no longer asserts what this entry used to report of it.** It has
been rewritten: it no longer claims "only two files, five lines", no longer cites `AGENTS.md` at all,
and no longer carries a line-numbered census. It now counts **two** tracked lines, records that
`AGENTS.md` and `docs/TESTING.md` already hold the underscore form, points at the route-by-scope rule
where it now lives, and says to fix both lines, file the spec one in `e2e/OPEN_PROBLEMS.md`, then
delete the item. It also names this entry as having gone stale on its own citations. So the
`AGENTS.md` premise this entry argued from is gone and its half of the census is fixed; what is left
is the two lines and the missing routed home.

**Fix.** Correct both surviving lines to the underscore form, filing the
`e2e/viewport-drawing.spec.ts` comment occurrence in `e2e/OPEN_PROBLEMS.md` rather than here. Then
delete `docs/LAYERS-PANEL.md` §20 item 6, which by its own text is to be deleted once the two lines
are fixed. Re-derive the remaining references from the prose at the time of the fix: `AGENTS.md` is
the file every agent reads first, so a citation into it silently rots, and its own rule says as much.

**Files.** `TEST-FLAKES.md` §12, `e2e/viewport-drawing.spec.ts` — the SKIPPED-BY-DECISION comment
named above, `e2e/OPEN_PROBLEMS.md` — the entry that does not exist yet,
`docs/LAYERS-PANEL.md` §20 item 6, `docs/DOCUMENTATION.md` §"The single-home rule"

---

## 98. The console log is the app's whole error channel, by decision

**Decided 2026-09-30: the app gets no user-facing error surface.** Swallowing a failure is acceptable
provided the console reports it. Every `alert()` was removed in favour of `console.error`
(`155ba7b8`), and nothing replaced them: `git grep -iE "toast|snackbar|notif"` over production `src/`
returns nothing, and `ErrorBoundary` is mounted at only two places (`App.tsx` — the two
`ErrorBoundary` mounts), catches
React render throws only, and covers neither `Menu`, `MobileMenuDrawer` nor `MobileHeader`.
**Do not "fix" a silent failure by adding a dialog or a banner** without asking again — the reasoning
that removed the alerts applies to whatever would replace them.

**The accepted cost, which is real and deliberate.** A failed file open, save, export or selection
copy is invisible on screen. Export is the sharpest case: `handleImageSave()` tears the dialog down in
its **success** branch and deliberately not in a `finally`, so a failure leaves the dialog open with
`fileInput` still staged and the user's own `fileName`/`format`/`jpegQuality` edits intact — the
comment above `setShowSaveDialog(false)` in `useFile.tsx` records that a `finally` was tried and
removed precisely because it "tore the dialog down on a failure exactly as it does on a success", and
that the staged input is what makes a retry re-encode the same `{ layers, size, documentFrame }`
without a remount. So the screen is **not** byte-identical to a success; what is still missing is the
one thing that would say _this attempt failed_. Nothing on screen does: the open dialog is
indistinguishable from an export still in flight, `fileName` is rendered
only at `MobileMenuDrawer.tsx` and `MobileHeader.tsx` — the `fileName` bindings each reads from the
store —
and `hasUnsavedChanges` is rendered nowhere, appearing in components only inside the three `confirm()`
guards. This is reachable by decision, not by accident: entry 45 keeps the 80 MP AVIF ceiling, so an
80–100 MP document is _supposed_ to fail to export.

No data is lost. `useApp.handleImageSave` (`useApp.ts` — `handleImageSave()`) is the only writer of
`hasUnsavedChanges: false` and of the rename, and it is guarded by `if (data)` at every call site, so
a failed export leaves the document dirty and intact rather than half-saved.

**What the decision required.** A report is only as good as the channel, so the console gap had to be
closed for it to hold. `copyActiveSelection` — `useSelectionClipboard` — `copySelection()` — returns
`false` without throwing for every null-snapshot
case, and seven call sites used to discard that boolean
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

**Files.** `src/contexts/useFile.tsx` — `handleImageSave()`, `src/hooks/useApp.ts` —
`handleImageSave()`,
`src/contexts/useSelectionClipboard.ts` — `copySelection()`,
`src/components/Main/Main.tsx` — `handleDrop()` and its `onDrop` binding,
`src/components/DesktopHeader/DesktopHeader.tsx` (File > Save handler),
`src/components/Mobile/MobileMenuDrawer.tsx` — `handleNew()`, `handleOpen()`, `handleSave()` and its
`fileName` binding,
`src/components/Mobile/MobileHeader.tsx` — `handleExport()` and its `fileName` binding,
`src/App.tsx` — the two `ErrorBoundary` mounts,
`src/util/selection.ts` — `getSelectionCanvasContext()` and `SelectionCanvasContextError`.

## 99. Every `history-replay.ts` line citation past the `documentSource` arm's gate is off by twenty

**Problem.** The bedrock-frame assignment in `replayHistory` is now wrapped in `if (index === 0)`
(`history-replay.ts` — `replayHistory()`, at its `index === 0` bedrock block), which turned a five-line
block into a thirteen-line one, and the
`documentSource` arm above it grew a gate of its own (that same `documentSource` arm). Every cited
line up to the top of the `documentSource` arm still
points where it did; **every citation past that point is now twenty lines early**, and the shift in
between
is not uniform (the rest of the `documentSource` arm moved eleven, its trailing lines twelve, the
whole arm nineteen). The citations were all
correct before the gates and are all wrong after them, so nothing here is pre-existing rot — it is
drift this change introduced.

**Why it matters.** These are references a session follows instead of reading, and `history-replay.ts`
runs past two hundred lines, so a twenty-line miss lands inside the neighbouring arm rather than past
the file. The
sites this entry listed in other documents have been re-pointed; the ones left are in the history
tests, which still quote the bedrock block as a line range
(the fixture comment in `history-adapter.branches.test.ts` — the
`it('reports the omission through the safe entry point while keeping the shadow available')` and
`it('leaves the durable frame at the pre-add size when a bedrock layer is added mid-history')` titles
— and `useHistory.test.tsx` — the `it.each(...)('replays image sources for %s without saving null
canvases')` case), the document-frame
arm as a line range (the `it('keeps a disabled remove entry in history without removing the layer')`
title in `history-adapter.branches.test.ts`) and the document-source arm as a line range (that same
file's `it('reports the omission through the safe entry point while keeping the shadow available')`
title). Entry 96 in this file is the same genre of defect for the same reason.

**Fix.** Re-point each site by reading the file, not by arithmetic — the shift is not uniform below
the `documentSource` arm's gate. For reference, past that gate the two gates together moved everything
twenty lines down: the
bedrock block is `replayHistory()`'s `index === 0` block, the document-frame arm its
`SET_DOCUMENT_FRAME_ACTION` arm, the layer arms its `NEW_LAYER_ACTION`/`TOOL_ACTION` handling, the
`layer-operation` test its `processor.commit === 'layer-operation'` arm and the `document-operation`
`continue` its `processor.commit === 'document-operation'` guard. Already correct, and
re-verified against the working tree: the `set-document-frame` comment in
`history-adapter.ts` — the one inside `legacyHistoryToDurable()`'s `SET_DOCUMENT_FRAME_ACTION` arm,
which now names `frameFromFirstEntryBedrock` and cites
the bedrock block by line — plus that file's `deriveSetDocumentFrameEntry()` and its `legacyHistoryToDurable()`,
and `history-append.ts` — `compareDurableSourceToLegacy()` and `deriveReorderLayersEntry()`. The four
sites in this file are re-pointed too. Sites still stale:

- `src/contexts/__tests__/history-adapter.branches.test.ts` — the
  `it('keeps a disabled remove entry in history without removing the layer')` title (the document-frame
  arm), the `it('reports the omission through the safe entry point while keeping the shadow available')`
  title (the document-source arm), the
  `it('a disabled first entry replays as the empty state legacy replays')` and `it('leaves the durable
frame at the pre-add size when a bedrock layer is added mid-history')` titles (the bedrock block),
  and the `it('keeps recording a property action for a layer an earlier entry removed')` title (the
  layer arms)
- `src/contexts/__tests__/useHistory.test.tsx` — the
  `it.each(...)('replays image sources for %s without saving null canvases')` case (the bedrock
  block)

**Files.** `src/contexts/history-replay.ts`

The append-boundary test citations were a separate drift cluster, not part of this file's
`history-replay.ts` arithmetic. They were resolved with the §87-§89 fixes and are no longer
outstanding.

---

## 103. The `REPLACE_DOCUMENT` fast path is a second, untested copy of the reducer's identity logic

**Problem.** The dispatcher's `REPLACE_DOCUMENT` arm in `StoreContext.tsx` intercepts `REPLACE_DOCUMENT`
before it
reaches the reducer. It recomputes seven fields the reducer's own `REPLACE_DOCUMENT` arm
also computes — `documentFrame`, `totalSize`, `documentId`, `documentRevision`,
`branchRevision`, `history`, `historyIndex` — assigns them to `latestStateRef.current` in
that arm's own pre-write, and then calls `rawDispatch`, so the reducer runs anyway and React state is
recomputed
from the reducer chain. The two copies are related by nothing but a comment.

**Measured 2026-09-30, one field at a time, against the real provider** with
`src/hooks/__tests__/useApp.document-reset.test.tsx` (12 tests, all green). Each row mutates one of the
seven assignments in the fast path's pre-write — named by its field below, since they all live in that
one arm — plus the disposal guard beside it:

| fast-path site     | field              | mutated to                      | result                                                                           |
| ------------------ | ------------------ | ------------------------------- | -------------------------------------------------------------------------------- |
| the seed           | `documentFrame`    | `currentState.documentFrame`    | **survives**                                                                     |
| the seed           | `totalSize`        | `currentState.totalSize`        | **survives**                                                                     |
| the seed           | `documentId`       | `currentState.documentId`       | **survives**                                                                     |
| the seed           | `documentRevision` | `currentState.documentRevision` | **survives**                                                                     |
| the seed           | `branchRevision`   | `currentState.branchRevision`   | **survives**                                                                     |
| the seed           | `history`          | appended instead of replaced    | **survives**                                                                     |
| the seed           | `historyIndex`     | `currentState.historyIndex`     | **survives**                                                                     |
| the disposal guard | disposal guard     | `if (false)`                    | caught — but by `StoreContext.durable-boundary.test.tsx`, not by any other suite |

Seven of eight survive, and the reason is structural rather than incidental: the pre-write lands in
`latestStateRef`, which the next dispatch reads as its `currentState`, and that value is used only to
(a) decide document disposal and (b) seed the _next_ fast path. It never reaches `useReducer`, so no
React state and no exported value can observe it. The one append that reads a cursor —
`updateHistoryTimeline` — clamps it, so even a stale `historyIndex` yields the same timeline.

**Why it matters.** The duplication is a real correctness surface, not dead code: `currentState` is
read by the disposal guard, so a wrong `documentId` in the fast path's seed would dispose the wrong
document's
assets — and that is precisely the one field whose divergence is currently caught by a different
suite, which is luck rather than design. Nothing binds the two copies together, so an edit to the
reducer arm that is not mirrored in the fast path's pre-write is invisible, and an edit to the fast
path that is
not mirrored in the reducer is invisible too.

**Fix.** Two options, and the second is the real one. Either expose the fast path's pre-write to a
test — `latestStateRef` is already in the provider's value, so a store test can assert the seven
fields directly and pin the two copies against each other. Or delete the fast path and let the
reducer be the only writer; the pre-write exists to make same-batch dispatches see the new document,
which `useSetSelectionFromHistory` and the append path need, so deletion is not free and the first
option is the cheaper correct move. Whichever is chosen, the seven seeds in the table above are the
list.

**Files.** `src/contexts/StoreContext.tsx` — the dispatcher's `REPLACE_DOCUMENT` arm and the reducer
case of the same name,
`src/contexts/__tests__/StoreContext.durable-boundary.test.tsx` — the `it('keeps unavailable rather
than downgrading to stale when a selection commits after a failure')` title

## 106. `docs/TOOLS-RESEARCH-BRIEF.md` cites four numbers for one file, and all four are stale

```bash
wc -l .skills/photoshop-tool-creation.md       # 4,455
grep -n '^## Photoshop shape tools\|^## The tool backlog\|^## Appendix A' \
  .skills/photoshop-tool-creation.md
```

which prints `373:## Photoshop shape tools`, `3879:## The tool backlog — what to build next` and
`4094:## Appendix A — the trap list`.

`docs/TOOLS-RESEARCH-BRIEF.md` §"What already exists — read before re-researching" said "a 4,371-line
playbook", and gave each of the three sections it names as a line range:

```
its `## Photoshop shape tools` section is `:357-846`
its `## The tool backlog` is `:3797`
its `## Appendix A` is `:4012`
```

Every one of those points at content that has since moved. This is the citation-staleness
defect `.skills/photoshop-tool-creation.md` phase 9 exists to catch, in the one document that tells
an agent what to read before writing a tool — and the drift is in the count as well as the anchors,
which is the case a `grep` cannot see.

**Fix.** Re-derive all four from `wc -l` and `grep -n` at the moment of writing, and consider naming
the sections by heading rather than by line, since a heading survives a merge and a line number
does not.

**Files.** `docs/TOOLS-RESEARCH-BRIEF.md` §"What already exists — read before re-researching",
`.skills/photoshop-tool-creation.md`

## 107. `docs/ORCHESTRATION.md` cites a handoff section and a source line that both point at the wrong thing

The pointer in the document every other worktree rule defers to: `docs/ORCHESTRATION.md`
§"Four traps that cost real debugging time" cited
`db.mjs`'s `holdFiles()` signature line for the `lock.agent_id !== who` conflict test. The lock-level
comparisons are in `scripts/lib/agent-board/db.mjs` — one inside `holdFiles()` and one inside
`lockFile`; the claim-level ones are in `createIssue()`, `claimIssue()`, `holdFileInTransaction()` and
`releaseIssueLocksInTransaction()`.

It matters more than an ordinary stale citation because it sits inside a rule an agent is told to
obey rather than to check — the section that ends "Only `e2e-run/<…>/<digits>` is probed" — and
because the wrong line names a function rather than a comparison, so a reader who opens that
`holdFiles()` signature
sees something that looks like the rule and is not.

A second, now-corrected pointer: `docs/ORCHESTRATION.md` §"Landing" attributed the `git stash` rule to
"HANDOFF §69", which was an eraser-preview defect, not the stash rule, and the real rule's own entry
restated `docs/ORCHESTRATION.md` back at it. Both entries are now deleted and the dangling pointer
went with them, so `docs/ORCHESTRATION.md` carries the stash rule once and on its own.

**Files.** `docs/ORCHESTRATION.md` §"Four traps that cost real debugging time" and §"Landing",
`scripts/lib/agent-board/db.mjs` — `holdFiles()`, `createIssue()`, `claimIssue()`,
`holdFileInTransaction()`, `releaseIssueLocksInTransaction()`

## 108. `.skills/photoshop-tool-creation.md` carries ~200 source citations it last verified two days before `main` moved, and it does not know which are dead

The skill's own header says every `file:line` was "last re-verified on 2026-09-28", and `main` has
moved since. The four worst instances were confirmed stale, each quoted here as it stood:

```
:492         quotes e2e/README.md:30 for "npm run test:e2e is headless by default. Keep it that way."
:3774-3779   asserts e2e/README.md:401-411 still says the `e2e` job is `continue-on-error: true`
:3137        says the pass/skip count lives in e2e/OPEN_PROBLEMS.md:41-42
:3207-3208   cites e2e/README.md:243-263 for `testInfo.snapshotDir`
```

The first named the wrong `e2e/README.md` line — the headless sentence is in the README's own
commands section, and the cited line was the "Counts are deliberately absent…" line instead. The same
paragraph claimed the README was "415 lines" and it was **580**. The second is the damaging one: the
README's history section already read "It **was** `continue-on-error`", and the skill still instructed
the reader that "the README is the stale one — fix it in the same commit", so it **instructed an agent
to "fix" a correct document.** The third pointed at two lines of `e2e/OPEN_PROBLEMS.md` that are blank
and the `## Observed failures` heading, while `grep -c '97 pass\|skipped by declaration'
e2e/OPEN_PROBLEMS.md` returned **0**; the count had moved into `AGENTS.md` and nothing in the skill
said so. The fourth cited a twenty-line `e2e/README.md` range for `testInfo.snapshotDir`, which sits
somewhere else entirely.

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

**Files.** `.skills/photoshop-tool-creation.md` — its "last re-verified" header, the phase table's
phase 9 row, and the four quoted bodies above; `e2e/README.md` — its commands section and its history
section; `e2e/OPEN_PROBLEMS.md` — the `## Observed failures` section; `AGENTS.md` — its known-failures
section

## 109. `.skills/hard-merge.md` cites eight source locations that have moved, three of them inside a paragraph that tells the reader to re-derive

`.skills/hard-merge.md` has the strongest evidentiary discipline of any document here — it names the
tree it was read against, and Appendix F is entirely about not trusting a citation. These were the
ones that did not get re-derived, each row naming the `.skills/hard-merge.md` section whose citation
was wrong on the left and what it actually resolved to on the right:

| section                                                  | claimed                                                             | actually                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| §"Preview without touching anything"                     | a range in `git.mjs` is `mergeConflict`                             | `mergeConflict()` in `git.mjs`                                                                   |
| §"Preview without touching anything"                     | "JSDoc at" a range in `git.mjs`                                     | the JSDoc on `mergeConflict()`                                                                   |
| §"Preview without touching anything"                     | `return { conflict: null, … }` at a range                           | two returns inside `mergeConflict()`, not one range                                              |
| §"Preview without touching anything"                     | `'toolbar-overflow'` present on `main` at a line                    | the `'toolbar-overflow'` entry in `curated.mjs`                                                  |
| the merge-commit corpus section                          | "of the last 200 merge commits on `main`, 50 carry a body"          | re-running the document's own command returns **62**                                             |
| §"1. Union — the default", §"2. Graft, do not duplicate" | "matches 83"; "78 times … and 5 in `HANDOFF.md`"                    | 92 uncorrected today: 79 in this skill, 7 in `HANDOFF.md`                                        |
| §"Corrected rather than deleted"                         | quotes `ef85d3ab`'s subject                                         | the real subject ends "**and shorten it**"; quoted with no ellipsis                              |
| the expired-lease section                                | "See a range in `docs/ORCHESTRATION.md`" for the expired-lease trap | that range is the `mustNotPrune` paragraph; the lease material is elsewhere in the same document |

The load-bearing claim — that the **corrected** pattern has **0** occurrences — still holds, so the
rule the numbers support is intact. What is broken is every number a reader would copy.

**Fix.** Correct the eight, and prefer the symbol over the line everywhere in this file, because
Appendix F's own argument is that a line number is a property of a moment.

**Files.** `.skills/hard-merge.md` — the eight sections named above;
`scripts/lib/worktree-inventory/git.mjs` — `mergeConflict()`,
`scripts/lib/worktree-inventory/curated.mjs` — the `'toolbar-overflow'` entry;
`docs/ORCHESTRATION.md` — the `mustNotPrune` paragraph and the expired-lease material

## 110. `ToolbarsRight/Lasso/Lasso.tsx` has no importer, and it is the only UI for two persisted lasso settings

`src/components/ToolbarsRight/Lasso/Lasso.tsx` (152 lines) is not reachable:

```bash
git grep -nE "import .*\bLasso\b.* from" -- src e2e   # zero hits
git grep -n "Lasso/Lasso.tsx" -- src e2e             # zero hits
```

`src/tools/toolsMap.ts` — its three lasso entries — wires the three lasso keys to `PolygonalLasso`,
`FreehandLasso`
and `FeatherMagneticLasso`. The component's only consumer is its own test,
`Lasso/__tests__/Lasso.test.tsx`, which renders a component the app can never reach.

**It is nevertheless the only place `lineWidth` and `alpha` are editable**, and both are
persisted defaults for two live keys:

- `src/tools/settings.ts` — its `'polygonal-lasso'` and `'freehand-lasso'` defaults — each declare
  `{ alpha: 1, lineWidth: 3, color: '#FF0000', fill: false, points: [] } satisfies LassoToolArgs`.
- `src/tools/polygonSelection.ts` types all of them, and `PolygonSelectionToolSettings` is
  `Omit<LassoToolArgs, 'points'>` — so they survive a reload.
- `PolygonalLasso.tsx` and `FreehandLasso.tsx` render **hint text only**; neither has a control.

So deleting it is not a cleanup, it is a second defect: two persisted settings with no UI
at all, and a settings bucket that round-trips values a user can no longer change. **The real
defect is the missing options bar.** `src/tools/descriptions/selection.notes.md` §"What is true of
all seven" already
records what Photoshop's Polygonal Lasso bar carries — the four combination modes, `Feather`,
`Style` and `Anti-alias` — and marks them absent here, while `FeatherMagneticLasso` ships
`featherRadius` / `magneticWidth` / `edgeContrast` / `frequency` (`src/tools/settings.ts` — its
`'feather-magnetic-lasso'` default).

The component is also wrong if reconnected: `Lasso.tsx` hardcodes
`toolName: 'polygonal-lasso'` into every `setToolArgs`, so wiring it to the freehand key would
label that tool's panel with the polygonal name.

**Fix.** Do not delete. Port `lineWidth` and `alpha` — and Photoshop's `Feather` and
`Anti-alias` — into `PolygonalLasso.tsx` and `FreehandLasso.tsx`, which are the components the
keys actually render, and delete `Lasso.tsx` and `Lasso.test.tsx` **in the same change**. The
two hints `Lasso.tsx` renders ("Backspace removes anchor • Enter finishes • Esc cancels")
are behaviour the live panels do not document, so carry them across too.

**Files.** `src/components/ToolbarsRight/Lasso/Lasso.tsx`,
`src/components/ToolbarsRight/Lasso/PolygonalLasso.tsx`,
`src/components/ToolbarsRight/Lasso/FreehandLasso.tsx`,
`src/components/ToolbarsRight/Lasso/__tests__/Lasso.test.tsx`, `src/tools/settings.ts` — the three
lasso defaults

## 113. `docs/TOOLS-TOO-HARD.md` attributes the placeholder-tool policy to `AGENTS.md`, which does not contain it

`docs/TOOLS-TOO-HARD.md` §"The Pen family":

> "`AGENTS.md` is explicit that this is the correct state for a tool the app cannot do: the
> Photoshop grouping and naming are the specification, and the stub bar is the debt."

`grep -rn "grouping and naming are the specification" --include='*.md'` returns three hits — the
same paragraph in `docs/TOOLS-TOO-HARD.md` §"The Pen family" and `docs/PHOTOSHOP-UX.md` §"Open
violations", plus this entry's own quotation of it. `AGENTS.md` states no such policy:
`grep -cE 'specification|grouping|stub bar' AGENTS.md` is **0**, its two `_placeholder_` matches
being the `‹line›` placeholder wording of the citation rule rather than a placeholder-tool policy,
and the whole file is short enough to read (`wc -l AGENTS.md` — 256 lines at the time of writing),
so this is an absent policy rather than one the grep missed.

The policy is real, deliberate, and load-bearing: `docs/PHOTOSHOP-UX.md` §"Open violations" — _"A
tool the
app cannot actually do still belongs in the rail, rendering Photoshop's real options bar,
because that is the contract… Seven tools currently render a `PlaceholderTool` chip bar instead
— the six Pen-family tools and Custom Shape. Photoshop's grouping and naming are the
specification; the stub bar is the debt."_

**Why this matters beyond a citation.** Six of the seven placeholder tools were audited for
deletion this week and every one came back "keep" **because of that policy**. An agent
reasoning from `TOOLS-TOO-HARD.md` follows a citation that resolves to nothing, and the natural
conclusion from a missing policy is that no policy was ever written down.

**Fix.** Change `AGENTS.md` to `docs/PHOTOSHOP-UX.md` §"Open violations" in that one sentence.

**Files.** `docs/TOOLS-TOO-HARD.md` §"The Pen family", `docs/PHOTOSHOP-UX.md` §"Open violations"

## 114. `rectangle`, `ellipse`, `triangle`, `polygon` and `line` are `ToolName`s the rail can never select, and nothing states whether they are load-bearing

`toolbar-mapping.ts` — its five `shape`-named toolbox entries — gives the toolbox entries
`name: 'shape'` plus a `figure`, never the key:

```ts
{ label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' },
{ label: 'Ellipse Tool',    name: 'shape', figure: 'oval' },
{ label: 'Line Tool',       name: 'shape', figure: 'line' },
{ label: 'Triangle Tool',   name: 'shape', figure: 'triangle' },
{ label: 'Polygon Tool',    name: 'shape', figure: 'polygon' },
```

All four activation surfaces translate — the rail's own `selectTool` in `SidebarLeft.tsx`, the mobile
equivalent in `Mobile/mobile-tools.ts`, the `Image`/`Edit` menu dispatch in `DesktopHeader.tsx`, and
the keyboard map in `AppKeyboardShortcuts.tsx` — and `useApp.ts` holds the only `SET_TOOL_NAME` dispatch
in `src`, so the enumeration is complete. `DesktopHeader.tsx` records that dispatching the
key directly was a **bug they fixed**: it mounted the Shape panel where the
`toolName !== 'shape'` guard in `Shape.tsx` suppressed the colour publish, so the well said
red and the shape committed black.

So the five keys are unreachable as a `toolName` but wired: each has a `ToolArgs` union variant
(its `rectangle`, `ellipse`, `triangle`, `polygon` and `line` variants in `tool-types.ts`), a
per-figure settings bucket (the five figure buckets in `settings.ts`),
a description record (`shape.ts` — its per-figure `sources` entries) and doc sections.
`docs/PHOTOSHOP-UX.md` §"Open violations" names them as _"registry ids the rail never names"_ and
frames the
rail-naming decision around them.

**What is not stated anywhere is whether they are forward-scaffolding or residue**, and one fact
would settle it: **can a durable document or a replayed history item carry
`toolName: 'rectangle'`?** `toolProcessors.ts` registers all five as
`{ creator: true, commit: 'source', replay: replay('source', false), imageProcessor: shape }`,
so a committed shape carries its tool name into history. The dispatch path is closed in the
running app, but document import and the durable `ToolArgs` deserialiser were **not** audited
for a persisted figure-key `toolName`. If one can arrive, these keys are load-bearing for
existing documents and deleting them is a data-loss change; if none can, they are pure residue
and the `ToolArgs` union is carrying five variants nothing constructs.

**Fix.** Audit the import and durable-replay path for a persisted figure-key `toolName`, then
either state in `docs/PHOTOSHOP-UX.md` that the five ids exist to keep historical documents
replayable, or delete them together with their `ToolArgs` variants, settings buckets and
descriptions. Whichever it is, the `rectangle` entry in `ToolbarPlaceholder.test.tsx`'s
unreachable-config list changes and that test moves with it.

**Files.** `toolbar-mapping.ts` — the five `shape`-named toolbox entries,
`src/tools/toolsMap.ts` — its five `Shape`-component entries,
`src/tools/toolProcessors.ts` — the five figure registrations,
`src/contexts/tool-types.ts` — the five figure `ToolArgs` variants,
`src/tools/settings.ts` — the five figure settings buckets, `docs/PHOTOSHOP-UX.md` §"Open violations",
`src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx` — the `it` title named in §112

## 115. The rectangular marquee ships no options bar at all, while the elliptical marquee beside it ships four controls

`src/tools/settings.ts` — its `'rectangular-selection'` default — declares
`'rectangular-selection': { toolName: 'rectangular-selection' }` — **no settings whatsoever** —
while the same file's `'elliptical-selection'` default gives it `style`, `fixedRatio`, `fixedWidth`
and `fixedHeight`, implemented in full in `ellipticalSelection.ts` — its `MarqueeStyle` type, its
`MARQUEE_STYLES` and `isMarqueeStyle()` exports and the `MARQUEE_RATIO_MIN`/`MAX` and
`MARQUEE_SIZE_MIN`/`MAX` bounds.

`RectangularSelection.tsx` is, in full, the literal string
`'Draw a rectangle and copy selected bitmap area.'` plus Copy / Paste / Clear.

Photoshop's rectangular marquee carries the same four combination modes, `Style` and the
`Width`/`Height` pair, and `src/tools/descriptions/selection.notes.md` §"What is true of all seven"
already records them
as absent. Since `docs/PHOTOSHOP-UX.md` §"Open violations" makes the rendered bar the contract, this
is debt
on a **shipped, working, reachable** tool — the rectangular marquee is a rail tile
(its entry in `toolbar-mapping.ts`'s marquee group) with the `M` shortcut.

**Fix.** Give `RectangularSelectionToolArgs` the same `MarqueeStyle` field the ellipse uses,
extract `ellipticalSelection.ts`'s `applyRatio` as a shared ratio helper, and render
the four controls.

**Files.** `src/tools/settings.ts` — the `'rectangular-selection'` and `'elliptical-selection'`
defaults, `src/tools/rectangularSelection.ts` — `RectangularSelectionToolArgs`,
`src/components/ToolbarsRight/RectangularSelection/RectangularSelection.tsx` — the whole component's
rendered body, `src/tools/ellipticalSelection.ts` — `applyRatio()`,
`src/tools/descriptions/selection.notes.md` §"What is true of all seven"

## 116. Three of the six pen tools have no shortcut and no Tools-menu entry

`AppKeyboardShortcuts.tsx` — `penGroup` — is `['pen', 'freeform-pen', 'curvature-pen']`, so
`P` / `Shift+P` cycle three of the six. `add-anchor-point`, `delete-anchor-point` and
`convert-point` have **no keybinding** and no Tools-menu entry — `DesktopHeader.tsx`'s
`TOOL_MENU_ITEMS` lists only the three pens. There is no standalone keymap table the enumeration
could be incomplete against: the keymap _is_ the `useKeyDownShortcut({ key: … })` registrations in
`AppKeyboardShortcuts.tsx`, and `grep -n "add-anchor-point\|delete-anchor-point\|convert-point"
src/components/Common/AppKeyboardShortcuts.tsx` returns nothing —
`toolbar-mapping.ts` declares the three without a `shortcut` as well, so no other surface declares a
binding either. `selectPenTool()` is the only consumer of `penGroup`, and `useApp.ts`'s `goToTool()`
is the only site in `src` that dispatches `SET_TOOL_NAME`, so a tool is reachable by key only
through a registration calling one of those selectors.

**Both other halves of the earlier version of this heading are wrong, and the rail never needed
them.** The icons are **not** identical: `SidebarLeft/toolIcons.tsx`'s `freeform-pen` entry gives
`freeform-pen` its own `FreeformPenIcon`, and `toolbar-mapping.ts`'s `toolbarMap` gives each of the
six its own label. The Tools-menu absence is Adobe's own doing — Adobe's keyboard-shortcut reference
(Adobe, primary, and the source `docs/PHOTOSHOP-UX.md` — "What it costs" cites for its own shortcut
list) lists **no** shortcut for `Add Anchor Point`, `Delete Anchor Point` or `Convert Point`, so a
menu row for them would be a departure rather than a fix, and `docs/OVERRIDES.md` has no entry
authorising one. What `docs/TOOLS.md` — "Freeform Pen Tool", "Curvature Pen Tool" and "Curvature
Pen Tool" again — record is only that the shortcuts do not exist, which is what this entry says.

**The rail half does not survive either.** `docs/PHOTOSHOP-UX.md` — "Open violations" states the six
Pen-family tools "currently render a `PlaceholderTool` chip bar instead", and that same open-violations
section lists only `draw`, `color`, `levels` and `transform` as invented entries — **not** the
pen family. So the "incomplete hiding" framing has no premise: nothing was hidden, and
`docs/PHOTOSHOP-UX.md` is the document that owns the answer if the family is ever implemented. **Do
not add a shortcut here without asking.** What remains is a record, not a defect.

**Files.** `src/components/Common/AppKeyboardShortcuts.tsx` — `penGroup` and `selectPenTool()`;
`src/components/DesktopHeader/DesktopHeader.tsx` — `TOOL_MENU_ITEMS`;
`src/components/SidebarLeft/SidebarLeft.tsx` — `RailGripIcon`;
`src/components/SidebarLeft/toolIcons.tsx` — the `freeform-pen` entry; `docs/TOOLS.md` — "Freeform
Pen Tool", "Shape Tool (the Tools panel group; no entry by that name)" and "Pen Tool";
`docs/PHOTOSHOP-UX.md` — "Open violations" and "The foreground/background swatch pair BELONGS in the
rail, and must NEVER be hidden"

<!-- §117 DELETED, not merged. Its own closing sentence made deletion the exit condition:
     "This entry stays until the three are gone from `toolbar-mapping.ts`, at which point the fix
     DELETES it rather than rewording it." They are gone — `extraTools` is now disjoint from
     `toolbarMap` and `toolbar-mapping.test.ts` pins it in both directions. What it decided is
     carried forward: the rail half is in `docs/PHOTOSHOP-UX.md`'s open-violations bullet, the
     operator's later "will be implemented" signal and the unanswered adjustment-layer question
     are in `docs/TOOLS-TOO-HARD.md` and `docs/PHOTOSHOP-UX.md`, the unanswered
     adjustment-layer question is §172. The label question was §170; it is resolved and
     implemented, so it is deleted, and the rule it settled now lives in
     `docs/TOOLS-TOO-HARD.md`'s enabled-items entry. -->

## 118. `brush`, `pencil` and `draw` are one rasteriser behind three tool names, and the rule that keeps them apart is not on `main`

`src/tools/toolProcessors.ts` registers all three against the same rasteriser — `buildDrawArgs()` and
the `brush` and `pencil` entries below it. **The coordinates in that fence are historical, kept as
the quoted record only; they no longer point at the quoted code**, and the current locations are
`buildDrawArgs()` and those two entries' `creator` bodies:

```
 96: const buildDrawArgs = (args, penType: 'pen' | 'spray', lineWidth?) => …
 259-262: brush   → draw({…})(buildDrawArgs(args, 'pen'))
 267-275: pencil  → draw({…})(buildDrawArgs(args, 'pen', lineWidth))
```

So `brush ≡ pencil ≡ draw` at the pixel level. They differ by nothing a user can see except the
preset list (`src/tools/brush.ts` — `PAINT_PRESETS`) and the tool name carried into history.
`src/components/ToolbarsRight/Brush/Brush.tsx` and `Pencil/Pencil.tsx` are both three-line
`createPaintToolbar('brush' | 'pencil')` calls over one shared bar.

**The constraint that makes this correct rather than a duplication bug has no surviving copy
anywhere.** The rule was written into `AGENTS.md`; `git log -S 'PaintToolName' -- AGENTS.md` names
`f0f7e548` (which added it), `ef85d3ab` and `1e82da20` (which removed it) — and all three are on
`main`, so the removal landed with the rule and no ref carries it either. An earlier version of this
entry named `fix/stale-reclaim-skill` as its home; `git rev-parse fix/stale-reclaim-skill` fails and
the only refs matching `*reclaim*` are four under `refs/keep/disposed/`, none of which has an
`AGENTS.md` carrying the rule. The only place the text survives is the quotation below:

> "`PaintToolName` is `'brush' | 'pencil'` and that narrowing is load-bearing: a tool that
> SUBSTITUTES pixels cannot share a processor, args type or options bar with one that STAMPS
> them — sharing is what let a forced `'spray'` `penType` masquerade as a tool setting, and a
> tool that left the paint panel must not be widened back for a new bar. Corollary: a group that
> persists one key may not absorb a tool that has more than one."

The corollary's original pointer (`HANDOFF.md` §70, "a tool whose settings do not fit a shared arm")
is gone — that defect was fixed, and the rule it recorded is the sentence above. `grep -c
PaintToolName AGENTS.md` on `main` returns **0**, and no branch's `AGENTS.md` carries it either.
`git grep -ln PaintToolName -- '*.md'` returns two files — `.skills/photoshop-tool-creation.md` and
this one — and the skill file uses the name only inside a code sample and the `createPaintToolbar()`
factory discussion, never as a boundary rule. `grep -rn "SUBSTITUTES pixels" --exclude-dir=node_modules
--exclude-dir=.git .` matches the fence below and nothing else, so the quoted paragraph **is the only
copy of the rule in the repository.** The type exists and is enforced in
code (`src/tools/draw.ts`, asserted at `src/tools/__tests__/paint-tools.test.ts` —
`paintToolNames`) — but the sentence that explains _why_ `'brush' | 'pencil'` is a narrowing and not
an accident exists nowhere else: the entry that used to hold it is deleted, correctly, because its
own defect was fixed, and the file that carried it was shortened in a commit already on `main`.

**Why it matters for the dead-tool question this surfaced.** Three tools sharing one rasteriser
is exactly the shape that reads as dead-code duplication, and the correct deletion — merging
`brush` and `pencil` into `draw`, or deleting `draw` as `docs/PHOTOSHOP-UX.md` — "Open violations",
its "No invented tools" bullet — orders would
be a real regression for anyone who has not read the rule. The rule is what stops it. That is
also the general lesson: **a rule can outlive the entry that recorded it, and deleting the entry
does not delete the rule** — so a rule with no home is a defect in itself.

**Fix.** Write the quoted `PaintToolName` paragraph into `AGENTS.md`'s **Architecture status**
section, next to the history-authority paragraph it constrains. It is a boundary rule of the same
kind. An earlier version of this entry proposed moving it "out of the branch's `AGENTS.md`"; there
is no branch left to move it out of, so it must be **written**, not moved — and until it is, the
rule exists only as a quotation inside this entry.

**Files.** `src/tools/toolProcessors.ts` — `buildDrawArgs()`, the `'clone-stamp'` entry and the
`brush` entry; `src/tools/brush.ts` — `PAINT_PRESETS`; `AGENTS.md` §Architecture status;
`docs/PHOTOSHOP-UX.md` — "Open violations"

## 119. The Draw tool is bound to no key at all, and whether it should be is a decision nobody has taken

**Problem.** `toolbar-mapping.ts`'s `toolbarMap` declares the Brush with `shortcut: 'B'` and declares
the Draw tile **with no `shortcut` at all** — its entry is `[{ label: 'Draw Tool', name: 'draw' }]`.
So the rail renders `B` on one tile and nothing on the other, and
`AppKeyboardShortcuts.tsx`'s two `useKeyDownShortcut({ key: 'b' … })` registrations bind `b` and
`shift+b` to `selectBrushTool()` while nothing is bound to `draw`. **The Draw tool is reachable only
by clicking.**

**An earlier version of this entry said both tiles declared `B`, and the map says otherwise — the
duplicate badge is gone, and its removal was deliberate.** `toolbar-mapping.ts` carries a comment
above the Draw entry stating that the omission **is** the fix: the entry previously declared
`shortcut: 'B'`, the Brush's own key, so `SidebarLeft.tsx` drew a `B` badge on the Draw flyout item
and pressing `B` selected the Brush — "a declared shortcut the app does not implement, exactly like
a tooltip that promises an Esc key the tool has no handler for". The coordinates in the fence below
are historical and are kept as the quoted record only; they no longer match `toolbarMap`, and the
fence is the one place that shape still appears.

```
 66: { label: 'Brush Tool', name: 'brush', shortcut: 'B' },
 90: [{ label: 'Draw Tool',   name: 'draw',   shortcut: 'B' }],
```

**And it cannot regress: three assertions now pin the invariant.** `toolbar-mapping.test.ts` carries
`it('never declares the same shortcut on two entries')`,
`it('claims each shortcut key at most once across the whole mapping')`, and
`it('gives the Draw tool no shortcut, because no key selects it')` — the last pinning the very
absence this entry is about. An earlier version claimed nothing asserted this and that no test
compared shortcuts across the rail; that was true of the figure-flyout assertions beside it
(`it('keeps Triangle, Polygon, Line and Custom Shape in the flyout')` and
`it('only declares U as the shape shortcut')`) but not of the rail-wide contract since.

**What remains live is a gap, and closing it is a decision rather than a repair.** An earlier version
of this paragraph claimed Adobe binds the Draw tool to `Shift+W`. Adobe’s published
default-keyboard-shortcut reference gives no letter for a Draw tool, so that provenance was
fabricated, it is withdrawn here, and `src/tools/descriptions/eyedropper-draw.ts` carried the same
sentence and no longer does. The chords are occupied by this app’s own keymap instead: `w` and
`shift+w` both go to `selectObjectSelectionTool()` (`AppKeyboardShortcuts.tsx` — its two
`useKeyDownShortcut({ key: 'w' … })` registrations, the Magic Wand tile’s `objectSelectionGroup`),
and `b` and `shift+b` both go to `selectBrushTool()`. `docs/DOCUMENTATION.md`’s ladder makes Adobe’s
documentation the authority, so this entry does not answer whether the tile should carry a key
anyway and no change may be made on this paragraph alone.

**Fix.** Take the ruling — does the Draw tile get a key of its own, and which chord if so — and
write it into `docs/OVERRIDES.md` if it departs from the current "no key". There is no published
Adobe letter to reproduce, so the ruling is about this app’s keymap: `w` and `shift+w` are the
Object Selection chord, `b` and `shift+b` the brush group. If the tile is to carry a key, add the
`useKeyDownShortcut` registration and the `shortcut` in the same change, since
`it('never declares the same shortcut on two entries')` will refuse a declaration that collides. If
the tile is to keep none, nothing needs changing and the live half of this entry closes.

One claim beside this one is still unverified and is left as it stands rather than restated here:
the comment above the Draw entry in `toolbar-mapping.ts` says "Adobe publishes none" on the premise
that "Photoshop has no Draw tool", and `docs/OVERRIDES.md` titles OVR-2 "Photoshop’s Tools panel has
no Draw tool". Whether Adobe’s Tools panel carries a tool by that name is a separate question from
whether its shortcut reference gives that tool a letter, and only the second is settled. Re-derive
that premise from Adobe before either is quoted as authority, and correct both together — OVR-2 is
what keeps the tile, so its heading is not a comment that can drift alone.

**Files.** `toolbar-mapping.ts` — `toolbarMap`'s `brush` entry, its Draw flyout entry and the
comment above it; `src/components/Common/AppKeyboardShortcuts.tsx` — `brushGroup`,
`selectBrushTool()`, `objectSelectionGroup`, `selectObjectSelectionTool()`;
`src/components/SidebarLeft/SidebarLeft.tsx` — `renderToolGroup()`;
`src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts`

## 120. The Move tool has nine documented missing controls and no entry tracking them as work

`docs/TOOLS.md` — "Move Tool" — gives `reposition` a written `partial` verdict and enumerates what
is absent: Tool Preset Picker, Auto-Select, Auto-Select: Group, Auto-Select: Layer, Show Transform
Controls, Align, Distribute, Align to, Width, Height — plus Alt-drag, Shift-constrain,
Shift-extend and arrow-key nudge. It records Auto-Select as welded on with no control to turn it
off.

**Nothing tracks the nine as work, and the claim does not depend on a match count.**
`grep -n reposition HANDOFF.md e2e/OPEN_PROBLEMS.md` returns **no match naming any of them** — not
Tool Preset Picker, Auto-Select, Auto-Select: Group/Layer, Show Transform Controls, Align,
Distribute, Align to, Width, Height, Alt-drag, Shift-constrain, Shift-extend or the arrow-key nudge.
What it does return is this entry's own two lines, the `reposition-layer` action identifier in
another entry, the rendered-label-versus-identifier question, §86's hovered-layer rect, and a
rail-fit entry in `e2e/OPEN_PROBLEMS.md`. An earlier version of this sentence counted the matches
instead ("returns only three matches, and each is about a different subject") and was wrong twice
over: the grep returns more, and two of them are the sentence itself.

The tool itself is not parked, which is the reason this is a handoff entry and not a deletion
candidate. Its _processor_ file was last touched 2026-09-25 by `2e1b6e46` — a config-and-test
commit whose real content was removing a dead `resize` rasteriser branch — but its live surface,
`src/components/Main/MoveToolArea.tsx` and the Move panel, was changed on **2026-09-28** by
`a30c318a` and `f6f54752`, i.e. _newer_ than `transform`'s 2026-09-27. It is the tool that owns
`Merge all` (`src/components/ToolbarsRight/Move/Reposition.tsx` — its `Merge all` button), which
nothing else has.

The scope decision is written down; the work is not. A documented `partial` verdict with no
tracked work is how a half-built tool becomes permanently half-built.

**Fix.** Add one `HANDOFF.md` entry carrying the nine controls and the four modifiers as named
work, referencing the existing verdict rather than restating it.

**Files.** `docs/TOOLS.md` — "Move Tool";
`src/components/ToolbarsRight/Move/Reposition.tsx` — its `Merge all` button,
`src/components/Main/MoveToolArea.tsx`

## 121. The worktree sweep is structurally blind to every branch that has no worktree, and one of those branches is the upstream reference implementation

**Problem.** `scripts/worktree-inventory.mjs` derives its entire model from
`git worktree list`; the only place any branch name is read is
`scripts/lib/worktree-inventory/git.mjs` — `listWorktrees()`, which parses a `branch refs/heads/…`
line out of that listing. A branch with no worktree is therefore not `land`, not `at-risk`, not
`dispose` and not
`goneWorktrees` — it does not appear in `WORKTREES.json` at all, so no reclaim or harvest run can
ever reach it. The blind set is **every ref in `refs/heads` that `git worktree list` does not
name**, and it is not a fixed number — it grows every time a session adds a branch before its
worktree. At the time of writing, 62 local branches against 51 with a worktree, so eleven
branch-only refs, and **not one of them is an ancestor of `main`**:

```bash
git for-each-ref refs/heads --format='%(refname:short)' | sort > /tmp/all-branches
git worktree list --porcelain | grep '^branch refs/heads/' \
  | sed 's|branch refs/heads/||' | sort > /tmp/with-worktree
comm -23 /tmp/all-branches /tmp/with-worktree \
  | while read -r b; do git merge-base --is-ancestor "$b" main || echo "$b"; done
```

The one that matters is worse than merely unlisted.

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
   bookkeeping whose own pointers had rotted, and deleting it is correct. `docs/ORCHESTRATION.md`
   is where a statement about the repository's remotes belongs, but it does **not** carry the
   upstream-rewrite rule this entry restates. An earlier version of this entry claimed it did, and
   quoted one — "a branch rewrote the whole history of the app … is a remote-tracking ref, not a
   local branch" — that exists in no tracked document:
   `grep -nE "remote-tracking|rewrote the whole history|refs/remotes" docs/ORCHESTRATION.md` returns
   nothing, and `git log -S'rewrote the whole history' --all` names only `4833e740`, the commit
   that introduced the citation. So the rule needs writing into `docs/ORCHESTRATION.md` as part of
   this fix; the closest real content there is the landing rule in `docs/ORCHESTRATION.md` — "Landing"
   ("a branch merges into `main` only after `main` has already been merged or rebased into the
   branch"), which is about merge discipline and not about identifying an upstream reference.
2. Teach the inventory to enumerate branch-only refs. `git for-each-ref refs/heads` alongside
   `git worktree list` is the whole change; a branch with no worktree should surface as an explicit
   category rather than as silence. That category splits three ways, and the split is a property of
   each ref rather than a count to store: a ref already an ancestor of `main`
   (`git merge-base --is-ancestor <b> main` → yes) is clutter no sweep will ever collect; a ref with
   unlanded patches (`git cherry main <b> | grep -c '^+'` → non-zero) is live work; and a ref that
   is **not** an ancestor yet reports **zero** unlanded patches is the one a reader must be warned
   about, because `git cherry` will call it landed. At the time of writing that third case is
   `ps-integration` alone — 2 commits ahead, merge commits only — sitting beside `layers`, the
   upstream reference implementation above, and beside eight ordinary branches with unlanded
   patches. An earlier version of this entry named a third member, `fix-merge`, as "already on
   `main`"; no ref of that name exists anywhere in this repository, and a branch already on `main`
   would not be in this set at all.

**Files.** `scripts/lib/worktree-inventory/git.mjs` — `listWorktrees()`,
`scripts/worktree-inventory.mjs`,
`docs/ORCHESTRATION.md` (where the upstream-rewrite rule has to be written)

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

**Files.** `src/contexts/useLayer.ts` — `tempUpdateLayer()`

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
4. the **mobile shell** — `MobileLayersDrawer.tsx`'s add-layer button calls
   `createBlankLayer({ …, size: totalSize, isBedrock: true })` with NO `replaceDocument`

**Entry point 4 is STILL OPEN, and a previous version of this entry said otherwise. That claim was
false in three verifiable ways, and it is corrected here because it sent two sessions away from the
one production path that still has the defect.**

The deleted paragraph claimed that `MobileLayersDrawer.tsx` "no longer calls `createBlankLayer` at
all", that the shell's blank layer "now goes through `applyRasterReplacement`
(`MobileLayersDrawer.tsx` — its layers-list row `<li>`)", and that `src/hooks/useApp.ts`'s PSD
import branch routes it through `setBlankImage`. Against the tree as it stands:

1. `MobileLayersDrawer.tsx`'s add-layer button **still** calls
   `createBlankLayer({ color: '#ffffff', opacity: 1, size: totalSize, isBedrock: true })` — with **no**
   `replaceDocument`, exactly the history shape this entry was written about. It is the only
   production writer of a mid-timeline bedrock entry, and the sole reason `replayHistory` needs a
   bedrock branch at all.
2. **`applyRasterReplacement` does not exist.** `grep -rn applyRasterReplacement src e2e` returns
   **zero** hits; the identifier appears only in this file and in the copies of this file inside
   worktrees. `MobileLayersDrawer.tsx`'s layers-list row `<li>` is what carries a comment about
   `role="button"`.
3. `src/hooks/useApp.ts` — `setImageFromUpload()`'s PSD-import branch — is the `REPLACE_DOCUMENT`
   payload of the **PSD** import plus an `ADOPT_LAYER_BITMAPS` dispatch. `setBlankImage` is
   `src/hooks/useApp.ts` — `setBlankImage()` — and is
   reached from `src/App.tsx` — `BlankImageStarter()` (the boot seed) and the New-document path —
   neither from the mobile drawer.

The premise was not merely stale; it was a wrong answer delivered with a `file:line`, and it is
recorded here as the standing example of why a stale line number is worse than none.

**What is left, stated as the tree actually is.** The mobile drawer commits a bedrock blank layer
mid-history. `createLayerSource` forces `pos = { x: 0, y: 0, ...source.size }` for any bedrock
source (`src/contexts/layer-utils.ts` — `createLayerSource()`), so after a crop to a frame whose
origin is not `{0,0}` the new layer lands **off-canvas**: measured at `(-100, -80)` relative to the
visible document for a crop to `{x:100,y:80,w:400,h:320}`. The `index === 0` gate in
`history-replay.ts` stops the FRAME from moving on undo; it does nothing about the layer's position,
which is why that gate was described as masking this defect rather than fixing it. **The fix is to
commit a non-bedrock layer from the drawer** — it is a normal empty layer above the current one, not
a document.

**Reproduce.** The harness is committed on `salvage/probe-canvas-growth` (it was untracked in a
detached-HEAD worktree, so it was on no ref at all and nothing in git could have recovered it).
**Run it from a worktree under `.kilo/` and never merge it** — see the landing shape below:

```bash
git worktree add .kilo/worktrees/probe-checkout -b probe/display-growth
cd .kilo/worktrees/probe-checkout
ln -s /Users/bkalynovskyi/ph/node_modules node_modules   # Vite does not walk up; tsc and vitest do
git show salvage/probe-canvas-growth:src/contexts/__tests__/probe-canvas-growth.test.tsx > src/contexts/__tests__/
git show salvage/probe-canvas-growth:e2e/zzz-probe-canvas-growth.spec.ts > e2e/
npx vitest run src/contexts/__tests__/probe-canvas-growth.test.tsx   # the per-cursor sweep
npm run test:e2e -- e2e/zzz-probe-canvas-growth.spec.ts              # the four entry points
```

**Landing shape, corrected.** The previous text warned that `probe-canvas-growth.test.tsx` is named
`*.test.tsx` and is therefore collected by `npm run test`. **That warning was also false**:
`vitest.config.ts`'s `exclude` sets `exclude: [...configDefaults.exclude, '**/.kilo/**', 'e2e/**']`, and
`.gitignore` ignores `.kilo`. A probe under `.kilo/worktrees/` is therefore invisible to both
suites, which is exactly what the worktree is for. The `ln -s … node_modules` in the commands above is
required for Vite (it does not walk up to a parent checkout) but makes three cases in
`scripts/__tests__/tsc-guard.test.mjs` measure the root checkout instead — §135 — so those three
failures are the symlink and not your work.

**Verified 2026-10-01 against `main` `c8c27619`: the store-level half of this entry does NOT
reproduce, and the numbers are in the plan.** Both probes are green, and that is structural rather
than lucky: `totalSize` is recomputed only from `updates.documentFrame`
(`src/contexts/StoreContext.tsx` — `projectPublishedTimeline()`, reached from the
`COMMIT_DOCUMENT_EDIT` case), and of the `COMMIT_DOCUMENT_EDIT` dispatches in `src/contexts/useLayer.ts`
exactly one carries a frame — `applyDocumentCrop()`. Take the dispatch count from the file; it moves
as writers are added.

**Correction to the reason that was written here.** This paragraph used to say `applyDocumentCrop()`
"cannot grow the document because `trimRect()` clamps every edge into `[0, totalSize]`". **That is
false, and inverted.** `applyDocumentCrop()` normalises with `sortRoundRect()`
(`src/contexts/useLayer.ts` — `applyDocumentCrop()`), not `trimRect()`. `rect.ts` documents the
difference deliberately: `trimRect` feeds `roundedPos` clamped edges, `sortRoundRect` feeds it
unclamped ones, "the rounding is the same, the clamp is the caller's decision"
(`src/util/rect.ts` — `roundedPos()`, `trimRect()`, `sortRoundRect()`, `clampEdge()`), and
`applyDocumentCrop()`'s own comment says "Unclamped on purpose, and that is the whole feature"
(`src/contexts/useLayer.ts` — `applyDocumentCrop()`). So `applyDocumentCrop()` **can** and does
grow the document, and the added band stays transparent — that is OVR-1 in `docs/OVERRIDES.md`. The
green probes are still explained, by the other half of the sentence: only this one dispatch carries a
frame, so no _ordinary tool commit_ moves `totalSize`. The conclusion stands; the mechanism named for
it did not. `trimRect()` is real and does clamp via `clampEdge()`, but it is not on the crop commit
path: `CropToolArea`'s `onChangeEnd` hands `applyDocumentCrop()` the `sortRoundRect()` result, and
`crop`'s own `imageProcessor` (`src/tools/crop.ts`) is reached by nothing in that flow.
`operationForTool()` (`src/contexts/history-adapter.ts`) returns `null` for a `document-operation`
tool, so the durable converter derives nothing from it either.

**What the green run does NOT cover, which is most of this entry.** Scenarios D and E are
deliberately assertion-light: they assert only `expect(rows.length).toBeGreaterThan(0)`, a tautology,
and `console.log` the rest. So they are diagnostic, not verdicts, and the run above must not be read
as "the mobile path is fixed". Specifically, **the blank-layer flow holds the pre-crop size at every
cursor only when no crop has been committed.** After a crop, scenario D logs
`800×600` at cursor 0 and the **cropped** size at every cursor after it — which is correct for a crop,
and is exactly why D asserts nothing. The off-canvas layer position above is measured directly and
does not depend on that scenario.

**So the remaining question is not the store — it is the DISPLAY, and it is unmeasured.** The
workspace canvas is `h-full w-full object-contain` (`src/components/Main/Main.tsx` —
`renderContent()`), so its
CSS box is the `1fr` grid cell and the document raster is letterboxed inside it at
`containFit(outer, image).scale` (`src/util/contain-fit.ts` — `containFit()`). The element box and the
on-screen document rect are two quantities neither probe reads, and **no test in the suite asserts
that either is invariant across a commit.** The existing coverage reads the canvas box only across a
dock toggle (`e2e/responsive-shell.spec.ts` — the
`test('reclaims the layers column by default and offers a toggle for it')` title) and the document
size only across dialogs (`e2e/document-dialogs.spec.ts` — `documentSize()`). Measure those, per
tool, before building anything on this
entry; `.kilo/plans/canvas-growth-display-measurement-plan.md` §3 is the measurement, with the
tool list and the four independent quantities.

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
longer exists. What replaced it is a 28-line comment in `scripts/__tests__/worktree-inventory.test.mjs`
— `describe('the curated table')`, headed "WHY THERE IS NO 'EVERY WORKTREE HAS
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

**Files.** `scripts/__tests__/worktree-inventory.test.mjs` — the `describe('the curated table')`
comment headed "WHY THERE IS NO 'EVERY WORKTREE HAS AN ENTRY' RULE HERE", and the
`it('re-checks a read-derived no-ref claim against the live tree')` title; `TEST-FLAKES.md` §14

## 132. The shape's three document-frame conversions are correct, and no test pins that

**This entry is a guard against a future "simplification", plus a missing tripwire.** An earlier
reading of this code claimed the frame offset is applied twice to a shape and lands it 2x from
where it was dragged. **That reading was wrong.** The arithmetic is worth writing down so nobody
derives it again. Three conversions, in order:

| where                                                                                  | conversion        | sign   |
| -------------------------------------------------------------------------------------- | ----------------- | ------ |
| `ShapeToolArea.tsx`'s `handlePointerUp()`, `canvasToDocumentPoint(..., documentFrame)` | canvas → document | **+1** |
| `useLayer.ts`'s `createLayerFromTool`, `pos: canvasToDocumentPos(pos, documentFrame)`  | canvas → document | **+1** |
| `layer-renderer.ts`'s `drawLayerSource()`, `position.x - (documentFrame?.x ?? 0)`      | document → canvas | **−1** |

`document-frame.ts`'s `canvasToDocumentPos()` adds. `documentToCanvasPos()` subtracts. The
renderer's inline subtraction is that same conversion. **Net +1**, which is
correct: a shape in a cropped document belongs one frame down and right of the origin.

The two "+1"s are not redundant. The first converts the _gesture_ from canvas to document space.
The second is `createLayerFromTool`'s unconditional conversion, which exists because a caller may
supply a `pos` already in layer space and a caller may not. `useLayer.ts`'s `_addLayer()` skips only
the _derivation_ when `pos` is supplied; the conversion inside `createLayerFromTool` is not
conditional, and that is deliberate rather than an oversight.

**Do not "fix" this by dropping either conversion.**

**The tripwire this names is not on `main`, and two documents claim it is.** An earlier revision of
this entry said a test already pinned the cancellation, and `docs/ARCHITECTURE.md` — "File I/O"
repeats that
claim. Both are false: `grep -rn "cancels the commit's" src/ e2e/` returns nothing, and the four
`ShapeToolArea.test.tsx` cases naming a `documentFrame` are about the
`it('falls back to documentFrameFromSize when currentFrame is null')` fallback, not about the offset
cancelling. The nearest analogue is about the Draw tool, and **it is on `main`**, not on the
unlanded branch an earlier version of this entry named: `src/components/Main/__tests__/DrawToolArea.test.tsx`'s
`it('shifts the committed bounding box by the document frame origin')` case, added by `b3a0cdc4`
("test(editor): pin invariants and failure-mode contracts"), which
`git branch --contains b3a0cdc4` lists `main` among.
`git merge-base --is-ancestor fix/shape-truth main` fails, and that branch carries the case only
because it descends from `main` — so `fix/shape-truth` is not where the test came from, whatever
`git log` walked back through it. **Two corrections, in one change:** add the shape test the Draw
case stands in for, and strike the
sentence from `docs/ARCHITECTURE.md` that says one exists.

The test to add: a shape committed into a non-zero `documentFrame`, asserting the committed bounds
equal the preview bounds plus the frame — the same relation the
`it('computes the committed bounds from the same geometry the preview draws')` case in
`ShapeToolArea.test.tsx` already
checks between preview and commit, extended to the renderer's subtraction.

**Files.** `src/components/Main/ShapeToolArea.tsx` — `handlePointerUp()`;
`src/contexts/useLayer.ts` — `createLayerFromTool`;
`src/contexts/layer-renderer.ts` — `drawLayerSource()`; `src/contexts/document-frame.ts` —
`canvasToDocumentPos()` and `documentToCanvasPos()`; `docs/ARCHITECTURE.md` — "File I/O"

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
hard-codes the same threshold in
`e2e/helpers/__tests__/canvas-stroke-analysis.unit.test.ts`'s `CONSTANT_CONTRACT` row for
`SPRAY_LUMINANCE_THRESHOLD`, so
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

**Files.** `e2e/helpers/canvas-helpers.ts` — `getStrokeAnalysis()` and the `STROKE_ANALYSIS`
constants; `e2e/helpers/__tests__/canvas-stroke-analysis.unit.test.ts` — `CONSTANT_CONTRACT`

## 134. Three tool descriptions promise a scrubby slider that does not exist

**Problem.** `main:src/tools/descriptions/paint.ts` promises the same thing three times — in the
Brush's `Opacity` row, the Brush's `Flow` row and the Pencil's `Opacity` row:

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

**Files.** `src/tools/descriptions/paint.ts` — the Brush's `Opacity` row, the Brush's `Flow` row and
the Pencil's `Opacity` row; `src/components/ToolbarHorizontal/` (no `ScrubbableField` on main)

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

**Observed.** A landing in this worktree failed 3 cases in `scripts/__tests__/tsc-guard.test.mjs` —
the `it('repairs npm plain symlink, which is the whole documented recovery path')` and
`it('replaces a dangling link rather than leaving one npm would skip')` cases among them — for no
reason connected to its change. The cause was
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

The comment above the `amount`/`radius` clamps in
`src/components/ToolbarsRight/Sharpen/Sharpen.tsx` and the one above `tip`/`strength` in
`src/components/ToolbarsRight/Smudge/Smudge.tsx` both carry the same text:

> A persisted args object can hold a value outside Photoshop's range — settings are round-tripped
> through `localStorage` and restored before anything clamps them — and a controlled `<input
type="range">` whose `value` is out of its own `min`/`max` pins the thumb to the bound while
> reporting the raw value, so the readout and the thumb disagree.

The reasoning is sound and the clamping is correct. **The premise is false.** `saveLastSettings()`
is called from `src/contexts/useCurrentTool.tsx` — `_setToolArgs()` — and writes to
`src/tools/settings.ts`'s module-level singleton `lastSavedSettings`, seeded from `defaultSettings`.
Grepping `localStorage`
across `src/` returns exactly two keys — `panelLayout` (read in `src/contexts/PanelLayout.tsx`'s
`readStoredLayout()`, written in `PanelLayoutProvider()`'s persist effect)
and `theme` (read and written in `src/contexts/ThemeContext.tsx`'s `ThemeProvider()`). Nothing
reaches the disk.

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

**Files.** `src/components/ToolbarsRight/Sharpen/Sharpen.tsx` — the comment above the
`amount`/`radius` clamps; `src/components/ToolbarsRight/Smudge/Smudge.tsx` — the comment above
`tip`/`strength`; `src/contexts/useCurrentTool.tsx` — `_setToolArgs()`;
`src/util/settings.ts` — `saveLastSettings()`; `src/tools/settings.ts` — `lastSavedSettings`

---

## 139. The superseded point-in-time reports cannot be moved without editing a data file

`AUDIT-STASHED-DOCS.md`, `FOCUSED-REVIEW-2026-09-28.md`, `MIGRATION_NEXT_STEPS_SUNDAY.md`,
`TEST_ISSUES.md` and `CANVAS-RESOLUTION-PLAN.md` sit at the repository root and are not part of any
documentation hierarchy: all five are point-in-time reports, and two carry banners saying they are
obsolete (`TEST_ISSUES.md` — "Open Unit-Test Issues"; `docs/save-settings-inconsistency.md` —
"Tool Settings Persistence Inconsistency"; `docs/next-target-useLayer.md` — "Next Tier 1 Target:
`src/contexts/useLayer.ts` — Test Plan").
`docs/README.md` now names all seven — those five plus the two recovered `docs/*.md` subjects — and
excludes them explicitly.

The obvious cleanup — move them to `docs/archive/` — **breaks `curated.mjs`**, which is why it has
not happened. `scripts/lib/worktree-inventory/curated.mjs` keys `ref:` values on these exact
paths, 9 references in all: three on `TEST_ISSUES.md`, three on `AUDIT-STASHED-DOCS.md`, two on
`FOCUSED-REVIEW-2026-09-28.md`, and one on `MIGRATION_NEXT_STEPS_SUNDAY.md`. Beyond
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
A third is worse: `docs/save-settings-inconsistency.md` carries a "Resolved, and the plan is
obsolete" banner and then heads a `## Status: Open` section underneath it, so the file contradicts
itself a few lines down. Deleting it is part of the same change.

**Fix.** Do it as its own change, not inside a documentation change: delete `TEST_ISSUES.md`,
`docs/next-target-useLayer.md` and `docs/save-settings-inconsistency.md`, then move the remaining
root reports to `docs/archive/` and update the four `ref:` key sets in `curated.mjs` plus the prose
references — including `docs/README.md`, whose "Not maintained here" table currently lists the two
deleted files as rows. `CANVAS-RESOLUTION-PLAN.md` has no `ref:` key, so it moves on prose
references alone. Verify by grepping for each old path afterwards, and by running
`npm run test:e2e:unit` — `scripts/__tests__/worktree-inventory.test.mjs` parses `curated.mjs` and
would catch a stale key.

**Files.** `scripts/lib/worktree-inventory/curated.mjs` — the four `ref:` key sets on these paths;
`docs/README.md` — "Not maintained here"; `TEST_ISSUES.md` — "Open Unit-Test Issues";
`CANVAS-RESOLUTION-PLAN.md` — "Canvas resolution: investigation, blast radius, and plan";
`docs/next-target-useLayer.md` — "Next Tier 1 Target: `src/contexts/useLayer.ts` — Test Plan";
`docs/save-settings-inconsistency.md` — "Tool Settings Persistence Inconsistency";
`e2e/OPEN_PROBLEMS.md`
---

## 140. `index.html` loads a Google Tag Manager container, so every e2e run beacons to Google

`index.html`'s two Google Tag Manager `<script>` tags load the container `GTM-WBWSB9XS` (the id is
declared in `index.html`'s container-id constant) from `googletagmanager.com`. Nothing in `e2e/`
stubs, blocks or
asserts on it.

Three consequences, in increasing order of how much they matter:

1. **The suite is not hermetic.** `e2e/helpers/console-police.ts` — its module note headed "WHAT IS
   REPORTED BUT NOT FAILED" — is where this is now
   recorded — the container "beacons to
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

**Files.** `index.html` — the two Google Tag Manager `<script>` tags and the `GTM-WBWSB9XS` container
id; `e2e/global-setup.ts` — `refuseVisibleBrowser()`;
`e2e/helpers/console-police.ts` — its "WHAT IS REPORTED BUT NOT FAILED" note

---

## 142. `classify` reports the main worktree as `keep` while it holds the only copy of uncommitted work

`scripts/lib/worktree-inventory/classify.mjs`'s `classify()` returns for the primary worktree before
any
tree-state check runs:

```js
if (wt.isPrimary) {
  recommendation = live ? RECOMMENDATION.IN_USE : RECOMMENDATION.KEEP;
  reasons.push('the main worktree is never a deletion candidate');
}
```

`KEEP` maps to `ACTION.KEEP` in `classify()`'s one-decision `switch (recommendation)`, never
`AT_RISK`. The `STATUS.UNCOMMITTED_ONLY` arm in `classify()` that produces `SALVAGE` → `AT_RISK` is
downstream and never reached for the main checkout.

**Observed, not inferred.** While correcting the `color`/`levels`/`transform` rail-removal decision
record, `npm run test` failed with:

```
ph (curated: NONE): ahead=0 onMain=true dirty=3 untracked=0
  -> status=landed recommendation=keep action=keep prunable=false
  — readable, so this must be reported as at-risk, not as anything else
```

Three modified files in main, in no commit on any branch, classified as **keep**. The guard in
`scripts/__tests__/worktree-inventory.test.mjs` — `describe('the duplicate-key reader, proven against
injected shapes')` — caught it and the suite went green the
moment the files were committed — which is the correct behaviour of the guard and the defect in
`classify` at the same time.

**Why it matters.** The inventory's stated purpose is to point an operator at work that exists in no
commit and can therefore be lost. Main is the **most** likely place for that, not the least:
`docs/ORCHESTRATION.md` — "Landing" records that other sessions commit into it concurrently, and its
`git add -A` bullet documents a merge that silently reverted 17 files through it. A `keep` verdict is
read as "this checkout is fine" by anything consuming the inventory, and the one checkout whose loss
is
catastrophic gets the verdict that says nothing needs attention. The `isPrimary` exemption is
correct for **deletion** — the comment inside `classify()`'s `wt.isPrimary` branch is right that main
is the landing site — but
the branch conflates "not a deletion candidate" with "nothing to report".

**Fix.** Keep the primary worktree out of every prune and dispose verdict, and make the dirty case
fall through to the salvage path rather than short-circuiting it. The narrowest correct shape is to
compute `uncommitted` first and let a primary worktree with a dirty tree reach the same
`AT_RISK` verdict a secondary one gets, while a clean primary still reports `keep` for the reason it
already gives. `wt.isPrimary` then needs to gate the _prune_ decision rather than the whole
recommendation.

**This entry is not a request to weaken a test.** The failing assertion is the guard working. Do not
touch that guard in `worktree-inventory.test.mjs`; fix `classify`. Reproduce by editing any tracked
file in
main and running `npx vitest run scripts/__tests__/worktree-inventory.test.mjs`.

**Files.** `scripts/lib/worktree-inventory/classify.mjs` — `classify()`, its `wt.isPrimary`
early-return, its `STATUS.UNCOMMITTED_ONLY` salvage arm, its `STATUS.UNMERGED_WORK` arms and its
one-decision `switch (recommendation)`;
`scripts/__tests__/worktree-inventory.test.mjs` — the `it('declares no key twice, because a
duplicate key silently discards a curation change')` title

```
docs(handoff): the AVIF timeout is a symlink artefact, and main's entry is correct

Two audits disagreed about e2e/OPEN_PROBLEMS.md:705. The second measured the AVIF
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
+++ b/HANDOFF.md
@@ -4471,3 +4471,47 @@ misleading", because `tsc` and `vitest` mostly work by walking up to the parent.
form of the same trap: they not only work, they work on the wrong files.

**Files.** `node_modules/.bin/tsc`, `scripts/tsc-guard.mjs`, `scripts/__tests__/tsc-guard.test.mjs`

```

## 143. The AVIF export timeout is NOT a defect, and `e2e/OPEN_PROBLEMS.md`'s entry is correct — do not "correct" it

**Problem.** Two audits of this sweep disagreed about the same thing, and the second one was wrong.
Main's `e2e/OPEN_PROBLEMS.md` — "P2 — the AVIF export waits on a wasm encoder inside a 30s download
timeout, and only AVIF exceeds it" — records the AVIF download timeout and states that **both specs
pass on `main`**, calling load "an explanation rather than a measurement". One audit measured the
AVIF pair
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
line. **The AVIF entry in `e2e/OPEN_PROBLEMS.md` stands.** Do not edit it, and do not add a second
AVIF entry.

**Files.** `e2e/OPEN_PROBLEMS.md` — "P2 — the AVIF export waits on a wasm encoder inside a 30s
download timeout, and only AVIF exceeds it"; `e2e/export/helpers.ts` — `waitUntil()`;
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

The likely cause is the name join in the
`it('protects that shape in a worktree NOBODY has written anything down about')` case —
`worktrees.find((x) => x.name === r.name)` — against the shape `liveWorktreeFacts()` builds,
which sets `mergedIntoBase` and `commitsAhead` rather than the `mergedIntoMain` the
`holdsWorkGitCannotSee()` predicate reads. A join that misses returns `undefined` and throws; one
that matches a
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

**Files.** `scripts/__tests__/worktree-inventory.test.mjs` — `holdsWorkGitCannotSee()`,
`liveWorktreeFacts()` and the
`it('protects that shape in a worktree NOBODY has written anything down about')` case;
`scripts/lib/worktree-inventory/classify.mjs` — `RECENT_IO_WINDOW_MS` and `hasLiveSession()`

## 146. Two of the Sponge's seeded defaults are choices Adobe never documents, and one is destructive if wrong

**Problem.** The Sponge shipped with `mode: 'desaturate'` and `vibrance: true`
(`src/tools/settings.ts` — the `sponge` entry in `defaultSettings`). **Neither is an Adobe default,
because Adobe documents neither.** A
dedicated search of Adobe's desktop Sponge page, its tool-techniques page, the CS4 manual and the
CS2 Bible found no statement of which `Mode` the bar opens on and no statement of whether `Vibrance`
ships checked. The app's two seeds rest on arguments, recorded at `SPONGE_MODE_DEFAULT`
(`src/tools/sponge.ts`) and in the tool's `appNotes`:

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

**Fix.** Confirm both against a live Photoshop and change the `sponge` entry in
`src/tools/settings.ts`'s `defaultSettings` if either is
inverted. Nothing else needs to move — both are single values, both are already isolated as named
constants, and both are already the subject of pinned unit tests. If the defaults cannot be
confirmed, the alternative is to stop asserting either: render the `Mode` select unseeded and refuse
the commit until the user chooses, which is worse and is not recommended.

**Files.** `src/tools/settings.ts` — the `sponge` entry in `defaultSettings`; `src/tools/sponge.ts` —
`SPONGE_MODE_DEFAULT` and `SPONGE_FLOW_DEFAULT`;
`src/tools/descriptions/focus.ts` §sponge `appNotes`;
`src/tools/descriptions/focus.notes.md` §Sponge Tool and items 15-16

## 147. The app has no document colour modes, so every Photoshop rule scoped to one is unimplementable

**Problem.** Adobe scopes behaviour to `Image > Mode` in several places, and this app has no such
surface — a `grep -rni grayscale src` finds only `colors.ts`'s `grayscale` **filter amount**
(`src/tools/colors.ts` — `ColorsToolArgs`, applied as a canvas `ctx.filter` in `colors()`), the
`color` tool's own
`Grayscale` slider (`src/components/ToolbarsRight/Colors/Color.tsx` — its `Grayscale` slider), a
PSD-import warning
(`src/contexts/psd-utils.ts` — `loadPsd()`, "Grayscale PSD converted to RGB") and the Sponge's own
prose.

The Sponge is the case that surfaced it. Adobe: "When an image is in Grayscale mode, the tool
increases or decreases contrast by moving gray levels away from or toward the middle gray"
(<https://helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html>), and Photoshop
Elements splits the direction — "In grayscale, Saturate increases contrast … In grayscale,
Desaturate decreases contrast" (<https://helpx.adobe.com/photoshop-elements/using/adjusting-color-saturation-hue-vibrance.html>).
That rule is **deliberately not implemented** (`SPONGE_MIDDLE_GREY`, in `src/tools/sponge.ts`), and
the reasoning is sound: the rule is scoped to a document MODE, and on an RGB pixel with no chroma the
chroma scale is already an exact no-op, so adding the pivot would make the tool behave the way
Photoshop behaves in a mode this app cannot reach.

**Why it is filed anyway.** The same trap is waiting for any future mode-scoped rule, and there is
more than one: `Image > Mode` also governs what the Channels panel lists, what a Lab-document's
`Image > Adjustments` behaves like, and how Photoshop's own Histogram reads a merged channel. An
agent that finds one of those will read the Sponge's `appNotes` and conclude "no mode, so skip it",
which is right here and would be wrong elsewhere — a greyscale document imported from a PSD is
**already converted to RGB on import** (`psd-utils.ts`'s `loadPsd()`), so the pixels a mode-scoped rule
would
read as grey exist in the app today, as RGB pixels, and the mode-scoped rule would then be the
Photoshop-correct answer for them. That inversion is the trap.

**Fix.** Decide whether the app has document modes at all. If it does not, say so once in
`docs/FEATURES.md` against the capability and treat mode-scoped Photoshop behaviour as unimplementable
rather than absent — and change the Sponge's `appNotes` to say which way that reasoning runs, since it
currently reads as "no mode, so nothing to do" when the imported-greyscale case is the opposite. If it
should, `Image > Mode` is a document-level property with a PSD round trip attached, and the Sponge's
grayscale branch is a small consumer of it rather than the reason to build it.

**Files.** `src/tools/sponge.ts` — `SPONGE_MIDDLE_GREY`; `src/tools/colors.ts` — `ColorsToolArgs`
and the `ctx.filter` assignment in `colors()`;
`src/components/ToolbarsRight/Colors/Color.tsx` — its `Grayscale` slider;
`src/contexts/psd-utils.ts` — `loadPsd()`

## 148. The rail's fit depends on React flushing passive effects before the first paint, and the fix is refused by a lint rule

**Problem.** `useToolbarOverflow` (`src/components/SidebarLeft/use-toolbar-overflow.ts`) measures the
rail from a ref callback, which runs during commit. React subscribes to an external store in a
**passive** effect, so at that moment there is no listener to notify, and the `setSlots` layout
effect publishes into the same empty set. The committed tree therefore holds the plan from _before_
the measurement, and `planToolbarOverflow`'s own answer to an unmeasurable rail is
`everythingVisible` — so the first committed rail is **every tool on screen**, fifteen tiles in a
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

**Files.** `src/components/SidebarLeft/use-toolbar-overflow.ts`,
`src/components/SidebarLeft/SidebarLeft.tsx` — `twoColumnEntries`,
`react-dom` `mountSyncExternalStore` (a **passive** `mountEffect`, and a consistency check that only
runs on a concurrent render that yielded — neither is a pre-paint refit).

---

## 149. The three-dots flyout reopens itself after the window crosses the edge where nothing collapses

**Problem.** `openGroup` is reset when its tile is swallowed by a collapse, but only against
`collapsedGroups` — the `if (openGroup !== null && collapsedGroups.has(openGroup))` render-time
reset in `SidebarLeft.tsx` — and that set can only ever contain GROUP keys — `0-0`,
`two-column-N`. The three-dots tile is keyed `OVERFLOW_GROUP_KEY`, the string `'overflow'` (the
`OVERFLOW_GROUP_KEY` declaration in `SidebarLeft.tsx`), which no group key can equal. So `collapsedGroups.has('overflow')` is
always false, the reset never fires for that tile, and `openGroup` outlives the unmount.

**Reproduced.** Open the three-dots menu at 1280x700, grow the window to 1400 — the tile unmounts,
because at 1400 all fifteen groups fit and nothing collapses — then shrink back to 700. The tile
remounts with the flyout **already open**, and nothing was clicked in between:

```
AFTER GROW:   overflow tile count = 0
AFTER SHRINK: the flyout is in the DOM with nothing clicked = 1
```

The user is shown a tool menu they did not open, over the tool they were reaching for.

**Why the `lg`-crossing fix — the `lastRailLayout !== railLayout` reset in `SidebarLeft.tsx` — does
not cover it**, and is worth reading as the same class
rather than the same bug: the two crossings both unmount tiles, and both leave `openGroup` naming a
tile that is no longer rendered. The desktop↔tablet crossing is handled by deriving the adjustment
from the layout; a COLLAPSE is handled by the `collapsedGroups` membership test; and the
collapse↔no-collapse crossing belongs to a third condition that nothing checks — the fit going
from `showOverflowTile: true` to `false` while `openGroup` is `'overflow'`.

**Reachability moved with the fit's budget, which is why it is filed now.** Nothing collapses from a
1037px window up, where before the budget change nothing collapsed from about 1300. The window has to
be dragged 263px less far to reach the state, and the drag is the natural gesture a user performs
while looking at an open flyout — to give the rail more room.

**What would close it.** Reset `openGroup` when `overflowPlan.showOverflowTile` goes false, the same
way the `lg` crossing does: derived from the state that changed, adjusted during render rather than
in an effect. A test belongs with it — open the menu, resize past the edge, resize back, and assert
the menu is not there — and **the height has to come from the rail's own arithmetic** (or from the
edge `e2e/toolbar-fit.spec.ts` already pins at 1037/1036), not from a hardcoded window, or the next
tile to be added moves it.

**Do not fix it by clearing `openGroup` on every `ResizeObserver` publication.** The store publishes
on plan changes only, and that is the point of the throttle; a subscriber that reset state on every
version bump would re-open the same class of problem as the one the throttle closed.

**Files.** `src/components/SidebarLeft/SidebarLeft.tsx` — the `RailGripIcon` doc comment, the
`openGroup` state, the `overflowTools` memo with the render-time collapse reset beside it, and the
two `renderToolGroup` call sites that render the overflow tile,
`src/components/SidebarLeft/toolbar-fit-store.ts` (the fit whose `showOverflowTile` edge moved),
`e2e/toolbar-fit.spec.ts` — the
`test('the count follows the window, and only the count that fits is ever shown')` case (the
1094/1093 edge).

## 150. A marquee drag that leaves the canvas is dropped rather than clamped, and the two families disagree about it

**Problem.** `SingleRowColumnMarqueeToolArea.tsx` wires both `onPointerLeave` and
`onPointerCancel` to `abortDrag`, so a drag that leaves the tool element ends as a cancelled
gesture that commits nothing. The geometry module documents the opposite behaviour three files
away: `singleRowMarqueeRect`'s doc comment in `singleRowColumnMarquee.ts` advertises that an
out-of-document pointer clamps to the first or last row, and cites Adobe's scripting API as the
reason. Both statements cannot stand. Only the PRESS clamps. A drag past the canvas edge is
discarded.

`EllipticalSelectionToolArea.tsx` wires the same pair, so this is house convention rather than
something these two tools introduced — but `RectangularSelectionToolArea.tsx` wires
`onPointerCancel` ALONE, to its own `handlePointerCancel`, so the rectangular marquee keeps
tracking a drag off the edge. Three selection tools, two behaviours, and one of the two is
undocumented.

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

**Files.** `src/components/Main/SingleRowColumnMarqueeToolArea.tsx` — `handlePointerDown` and
`abortDrag` with its two JSX wirings,
`src/components/Main/EllipticalSelectionToolArea.tsx` — `handlePointerDown` and `abortDrag` with
its two JSX wirings,
`src/components/Main/RectangularSelectionToolArea.tsx` — `handlePointerCancel`,
`src/tools/singleRowColumnMarquee.ts` — `singleRowMarqueeRect`'s doc comment.

## 151. Hand, Zoom and Rotate View are absent because the view transform is commented out, and no document records that as a defect

**Problem.** Three of Photoshop's twenty toolbar slots have no implementation, and nothing states
the root cause anywhere in the tree. `toolbar-mapping.ts` (repo root) has no `hand`, `zoom` or
`rotate` entry. The store's view state is entirely commented out:

- `StoreContext.tsx` — `StoreData`'s commented-out `zoomDataRef` / `setZoomData` members, with only
  the type left live.
- `StoreContext.tsx` — `StoreProvider`'s whole commented zoom block, `// const zoomDataRef = useRef<ZoomData>({ dx: 0, dy: 0, zoom: 1 });` and the rest.
- `general-types.ts` — `export type ZoomData = { dx, dy, zoom }` is still a live export with
  **zero** live consumers. A type with no consumer is the residue of the removal.

**The `'zoom'` default is a trap, and it is the half nobody has written down.**
`Main.tsx` initialises `let interactionMode = 'zoom'` and the string `'zoom'`
is assigned by **no branch** in the file — the `if`/`else if` chain that assigns `interactionMode`
runs from its first `else if` to the `else EventHandler = DummyToolArea` that terminates it. So
`'zoom'` is not a mode anything enters; it is the value every tool without its own arm falls through
to, and it lands on a `display: none` div with no handlers. `Main.tsx` still carries the matching
`// transform: translate(${dx}px, ${dy}px) scale(${zoom})` on the `.zoom-container` div, and
`Main.scss`'s `.zoom-container` rule sets `transform-origin` with no `transform` to anchor.

**A second, smaller finding in the same cause.** `src/components/SidebarLeft/SidebarLeft.tsx`
has exactly one `<hr>`, and the comment above that `<hr>` justifies it by describing a
commented-out Zoom control: "The second `<hr>` this replaces stood between the colour cluster and
NOTHING — the commented-out Zoom control that followed it was deleted with it". The control it
reasons about is not in the file.

**Why it is not a wiring bug.** There is no view transform to wire. `usePointerPosition` maps
client coordinates to image pixels through a `scale` supplied by the host rather than owning a
transform of its own.

**Fix — start with the scope, not the Hand tool.** Three separate features each want one, and they
want the same one: pan/zoom, the space-drag temporary-pan every tool inherits, and tool cursors that
track the view (a brush tip circle is a screen-space circle). A `DocumentViewScope` owning
`{ dx, dy, zoom }`, with `usePointerPosition` and every pointer-to-image conversion reading from it,
is the shape the commented-out code was reaching for. Do not begin with a Hand tool; begin with the
scope and the three tools fall out of it.

Two smaller fixes that can land independently, and are cheap:

1. Replace the `'zoom'` default with something honest — `DummyToolArea` itself, or an explicitly
   named `UNHANDLED` — so the fallthrough is a decision rather than an accident that reads as a
   feature. As written, a reader must diff the whole chain to learn that `'zoom'` is never assigned.
2. Delete or reword the `<hr>` comment in `SidebarLeft.tsx`; the control it cites is gone.

**Why this is being refiled.** `4833e740` deleted the entry that carried it on the grounds that it
was "already carried by a tracked document". It is not. `docs/TOOLS-INVENTORY.md`'s "Navigation and
measuring" table has catalogue rows for the three names, and its "Zoom deserves one note of
accuracy" note records "The app has a zoom **interaction mode** on the canvas and **no Zoom tool**"
— a description, not a filed defect. `docs/TOOLS-TOO-HARD.md`'s "The Adobe tools the rail omits"
section repeats that one sentence. `docs/PHOTOSHOP-UX.md`'s "Confidence and provenance" section
lists the three only as "not Adobe-table-confirmed". The one surviving mention of the root cause is
`HANDOFF.md` §74, framed as a roadmap step ("belongs on its own branch"), which never names the
`'zoom'` fallthrough or the stale comment. Verified against `main@cf41f642`.

**Files.** `toolbar-mapping.ts` (repo root), `src/contexts/StoreContext.tsx` (`StoreData` and
`StoreProvider`), `src/contexts/general-types.ts` (`ZoomData`),
`src/components/Main/Main.tsx` (`interactionMode`, the `EventHandler` chain, the `.zoom-container`
div), `src/components/Main/Main.scss` (`.zoom-container`), `src/components/SidebarLeft/SidebarLeft.tsx`
(the single `<hr>` and the comment above it), `src/hooks/usePointerPosition.ts`

---

## 152. A touch device at 768px and above cannot reorder layers, and no document records it

**Problem.** Layer reordering is HTML5 drag-and-drop, and HTML5 drag does not fire on touch. At
768px and above the only layer list the app renders is the desktop one, so on an iPad in landscape
the rows cannot be reordered at all.

- `LayersTab.tsx` sets `draggable={editingLayerId !== layer.id}` on the layer row, with an
  `onDragStart` that reads `e.dataTransfer`, an `onDragOver` and an `onDrop`. There is no
  pointer-events reorder path anywhere in the file.
- The breakpoint is `useMediaQuery.ts` — `MOBILE_MEDIA_QUERY = '(width < 768px)'` — and
  `SidebarRight.tsx` hides the desktop aside with `max-md:hidden` below it. So the residual window
  is exactly `width >= 768px`, which includes the 768-1024px tablet band this suite already
  exercises (`e2e/OPEN_PROBLEMS.md` — its "P2 — the mobile bottom bar scrolls 615px with no
  affordance" entry runs at 1133x744).

**The phone case is not part of this and must not be claimed.** Below 768px the app ships explicit
reorder controls: `MobileLayersDrawer.tsx` renders ▲ and ▼ buttons — the `Move ${layer.name} up`
and `Move ${layer.name} down` pair — `disabled` at the ends of the list,
on `min-h-11 min-w-11` (44px) targets, calling `moveLayerAfter`. An earlier version of this entry
said layer rows "cannot be reordered on a phone", which that refutes. The tablet-width case is the
one that is live, and it is the one an earlier version did not name.

**Two companions, both still true.**

1. **No stylus discrimination.** `pointerType` appears in production code in exactly two places,
   both in a test fixture: the `pointerType` member of the fixture object in
   `src/__tests__/fixtures/pointer.ts`. `usePointerPosition` reads
   `button`, `pointerId` and `clientX/Y` and nothing else, and no tool reads `pressure`. So there is
   no stylus-versus-palm rejection and no pinch-zoom.
2. **Slider hit areas.** There is no `src/components/Common/TouchSlider.tsx`, and the options-bar
   sliders are 4-6px tall — `h-1.5` on every range input in `Draw.tsx` and in `Levels.tsx`, and on
   `Smudge.tsx`'s `SLIDER_CLASS`; `h-1` on every range input in `Transform.tsx`. The mobile tool
   sheet renders those same bars.

**Why it is not a wiring bug.** Touch reordering needs a pointer-events drag with a gesture
threshold, and the layers list has an existing HTML5 path with its own keyboard affordances to keep
in step. Slider sizing is a component decision that applies to every bar at once, not one control.

**Fix.** Three independent items, and the third is the only one with a worked answer.

1. Add a pointer-events reorder path to `LayersTab.tsx` beside the HTML5 one — pointerdown on the
   row's drag affordance, a movement threshold before it is a drag rather than a click, then the
   same `moveLayerAfter` the mobile drawer calls. Reuse the 3px threshold `onRailDrag` in
   `SidebarLeft.tsx` already uses for its own press-versus-drag decision rather than inventing a
   second number.
2. Read `event.pointerType` in `usePointerPosition` and skip a pen/touch gesture that the tool
   cannot use, so a palm resting on the canvas does not paint. This is the first consumer of
   `pointerType` the app would have, which is why the fixture has it and nothing else does.
3. Slider targets: a `TouchSlider` with a 44px touch box around the existing 6px track, applied to
   the shared bar rather than to one control. A discarded `docs/responsive-design-plan` branch had
   a 70-line candidate; **do not land that document** — its audit section is false, it asserts no
   mobile drawer or hamburger exists, that all chrome is `max-md:hidden` leaving a blank canvas, and
   that `BottomToolbar.tsx` is an unintegrated stub, while `main` has `MobileMenuDrawer.tsx`,
   `MobileShell.tsx` and `e2e/mobile-shell.spec.ts`. Take the component, re-derive the document.

**Why this is being refiled.** `4833e740` deleted the entry and named no reason for it. It is not
routed anywhere: `e2e/OPEN_PROBLEMS.md`'s "P3 — no mobile or HiDPI project, and no touch anywhere"
is a Playwright-configuration coverage entry (one project, zero
`hasTouch`/`isMobile`/`touchscreen`) and never names `draggable`, layer reordering, `pointerType` or
slider hit size. `docs/FEATURES.md`'s "Mobile" section records the mobile gap as "No pinch-zoom and
no two-finger pan" and asserts drawing works on touch, which is a different claim. Verified against
`main@cf41f642`.

**Files.** `src/components/SidebarRight/LayersTab.tsx` (the layer row's HTML5 drag handlers),
`src/components/SidebarRight/SidebarRight.tsx` (the `max-md:hidden` aside),
`src/hooks/useMediaQuery.ts` (`MOBILE_MEDIA_QUERY`), `src/components/Mobile/MobileLayersDrawer.tsx`
(the ▲/▼ pair), `src/hooks/usePointerPosition.ts`,
`src/components/ToolbarsRight/Draw/Draw.tsx`, `src/components/ToolbarsRight/Levels/Levels.tsx`
(their range-input track classes)

---

## 153. The main-worktree guard runs after the edit, so a subagent fan-out rooted in main is still unstopped

**Problem.** `docs/ORCHESTRATION.md`'s "Worktrees" section states the rule — tracked-file changes
happen in a worktree, main is for reading and merging — and the commit path is now a program. The
write path is not, and that asymmetry is the defect.

`scripts/main-worktree-guard.mjs` runs first in `.husky/pre-commit` — the bare
`node scripts/main-worktree-guard.mjs` line — and refuses a commit made from the main worktree
(override `ALLOW_MAIN_COMMIT=1`, honoured only on an exact `1` by `decide()`), pinned by
`scripts/__tests__/main-worktree-guard.test.mjs` whose last describe, "the guard is actually
installed", asserts exactly that. The guard states its own limit in the header block headed "WHAT IT
DOES NOT DO, because the limit is load-bearing":

> It runs AFTER the edit, not before it. A session that writes into the main worktree and never
> commits is not stopped here; its files are still uncommitted, and they are still in a checkout
> every other session is reading. … Closing the write side is a process fix, not a program.

`docs/ORCHESTRATION.md`, under "The rule is enforced at the commit, not by the reader", says the
same thing: "What it does **not** do is stop the write … the write side is the process rule above,
and the guard is the floor under it."

**Nothing fills the gap.** A `task` subagent inherits the calling session's working directory, and
`AGENTS.md`'s headline instruction is "LAUNCH AS MANY SUBAGENTS AS THE TASK NEEDS" — so a fan-out
rooted in a main-rooted chat is mechanically a write into `main`, and `main` is where most root
chats sit. Two root-level defaults would close it, and neither exists:

1. Nothing creates the worktree before the first edit. `task` cannot create one for itself, so this
   has to happen at the root — and `kilo.jsonc` cannot express it, because tool permissions match a
   path glob and have no term for the working directory. There is no pre-tool-use hook in
   `kilo.jsonc` or in any tracked agent definition, and no script under `scripts/` runs
   `git worktree add` (`repoRoot()` in `scripts/worktree-inventory.mjs` runs only
   `git worktree list --porcelain`).
2. Nothing stops `agent_manager` `mode: 'local'` from putting an editing session in the root
   checkout. That mode exists by construction to start sessions in the caller's directory.

Note the audit gap: `.kilo/` is gitignored (the `.kilo` line in `.gitignore`), so an agent-definition
or Agent Manager surface cannot be verified from a worktree. What is verifiable from the tracked tree
is that `kilo.jsonc`'s `permission` block contains only the Playwright window-opening `deny` rules
and no working-directory term.

**Why this is being refiled, in this form.** `4833e740` deleted the entry and classified it under
"fixed on main". Part one is fixed and demonstrably intact. Part two was the entry's own point —
it said so in its own text ("Fix, part two — still open, and it is the larger half") — and it is
still open. An entry that is half fixed is not an entry that is fixed.

**Fix.** Both halves are defaults in a tool rather than rules in a document, which is the whole
difficulty: (1) a root-level hook or launcher that provisions the task's worktree before any edit
tool is available, and (2) a refusal, or at minimum a warning, for `agent_manager` `mode: 'local'`
at a root checkout. Until those exist the guard is worth exactly what it says it is: a floor under a
process rule, converting "rogue commits nobody can attribute" into "a dirty tree the next
`git status` names".

**Files.** `scripts/main-worktree-guard.mjs` (its header's "WHAT IT DOES NOT DO" block, and
`decide()`), `.husky/pre-commit` (the guard invocation),
`scripts/__tests__/main-worktree-guard.test.mjs`, `docs/ORCHESTRATION.md` ("Worktrees", and "The rule
is enforced at the commit, not by the reader"), `kilo.jsonc` (`permission`), `AGENTS.md` (delegation
section)

## 156. `fix/overnight-test-red` must not be merged: it restores an attribute a written prohibition forbids, and its one remaining change is a decision the operator has already refused

The branch is 12 commits that fixed a genuinely red suite, and merging it is still wrong.
Two of its changes block that, for different reasons, and one of those reasons has since
stopped applying — which is the part worth re-deriving rather than trusting.

**The blocker: it reverses `1dcc25cb`.** `renderToolGroup` in `SidebarLeft.tsx` changes

```
-  aria-pressed={identity === undefined ? group.some((tool) => tool.name === toolName) : undefined}
+  aria-pressed={isGroupActive}
```

`identity` present _is_ the three-dots tile — the code's own comment says the tile is the
one caller that passes an `identity` — so the branch adds `aria-pressed` to the overflow
tile. `e2e/OPEN_PROBLEMS.md`'s "P2 — a collapsed tool's selection assertion is GROUP-level, so it
passes for any member of the collapsed set" entry forbids this in bold: restoring `aria-pressed`
there
"would announce a pressed toggle for whichever hidden tool happens to be selected, on a
control whose only job is to open a menu — the exact defect `1dcc25cb` corrected." That same
entry calls it a product change to be decided deliberately, with no
`docs/OVERRIDES.md` entry. Per `AGENTS.md` the prohibition outranks the branch, an agent may
not add an override to settle it, and the operator has now refused it explicitly.

**The second reason is stale, and merging on it would be regressive.** The branch replaces
the assertion `gives every non-primary worktree a curated entry, so none is undocumented`
with `requires a curated entry for the worktree this suite runs from, if it holds work`,
narrowing a machine-wide invariant to one directory. That rule **no longer exists on
`main`**: it was removed on purpose, and `describe('the curated table')` in
`scripts/__tests__/worktree-inventory.test.mjs` carries a header explaining why —
it demanded a curated entry for every live in-repo worktree, which is what an in-flight task
looks like for its whole life, so it was red from the first minute of every task in every
OTHER checkout too, and it compared a COMMITTED file against LIVE machine state that nothing
can make agree. The replacement asserts the RISK instead, over the real repository with the
curated entry REMOVED, pinning that no curated field except `mustNotPrune` can move a verdict.
Merging the branch would therefore not narrow that rule; it would **reintroduce a weaker
version of a rule `main` deliberately deleted.**

**Fix.** Do not merge this branch, for either reason. Its landable parts were worth taking
and were taken as fresh commits against `main` rather than as a merge: the GTM/font removal
in `index.html`, the `runRecordPath` option in `scripts/e2e-run.mjs`, the `toolbar-fit`
1→8 split. The rest is either already superseded by `main` in a stronger form
(`e2e/text-tool.spec.ts`'s colour helper, the `type-crop` and Text-tool descriptions, which
`8bf2cc7e` and `92d6a2f9` replaced with a fuller audit, and the `TEST-FLAKES.md` renumber) or
refused. Two further changes are excluded and should stay excluded: the branch's `AGENTS.md`
hunk rewrites the local-gate table to an OLDER shape than main's, dropping `test:e2e:unit`
from `gate:verify` and removing `test:staged` from the commit hook; and its
`e2e/sidebar-flyout.spec.ts` hunk relaxes a `beforeEach` from `page.goto('/')` to
`waitUntil: 'domcontentloaded'`, a readiness reduction nothing has reviewed. If the product
does want `aria-pressed` on the three-dots tile, it goes into `docs/OVERRIDES.md` in the
operator's hand — an agent records the finding and stops, which is what this entry is.

**Files.** `fix/overnight-test-red:src/components/SidebarLeft/SidebarLeft.tsx` (`renderToolGroup`),
`fix/overnight-test-red:scripts/__tests__/worktree-inventory.test.mjs` (the
`it('requires a curated entry for the worktree this suite runs from, if it holds work')` title),
`scripts/__tests__/worktree-inventory.test.mjs` (`describe('the curated table')`),
`e2e/OPEN_PROBLEMS.md` (the GROUP-level collapsed-tool assertion entry), `AGENTS.md` (model policy,
overrides)

## 157. A worktree directory git no longer tracks is unreachable by the disposal path, because disposal only accepts registered worktrees

`.kilo/worktrees/stale-citations` was a 28K directory holding no source, no `.git` and no
branch: `node_modules/.vite/vitest` (empty scratch) and `.kilo/e2e-last-run.json`, a run
record naming `runId 2026-09-30T22-44-59-212Z-70299`, pid 70299, port 53969 — a dev server
that died about a day before it was found. The directory's birth time was 2026-10-01T00:44,
matching the run record, so it was a real worktree that was pruned out of
`git worktree list` while the directory itself stayed.

`npm run dispose -- stale-citations` answers `no worktree "stale-citations"`, because it
resolves its argument against the registered set. So the one class of leftover the sweep
exists to remove is the one class it cannot name: the tool refused the only directory it
could not prove was junk, and the directory stayed forever holding a port number from a dead
server. This is now the WHOLE of the defect — the instance was removed by hand after both
its files were checked against `isRegenerableIgnored()` and returned `REGENERABLE` for both
(`.vite` and `.kilo` are both on the list), but **the path that let it accumulate is
unfixed and will produce another one.**

**Fix.** Give disposal a second resolution path: when the argument is not a registered
worktree, fall back to `lstat` on the literal path and refuse only if it is missing, is not
a directory, or is not under `.kilo/worktrees/`. Report what it found before removing it —
a directory with tracked-looking content and no `.git` is a finding, not an obstacle, and
the refusal message should say which of the three conditions matched. `protectedContentOnDisk`
and `isRegenerableIgnored` are already exported from the module and answer the
"is there anything here worth keeping" half of the question, so the fallback can reuse them
rather than re-deriving the judgement. The `e2e-last-run.json` writer is the `RUN_RECORD`
constant in `scripts/e2e-run.mjs`, keyed on `REPO_ROOT`, which is why a pruned worktree leaves
one behind: nothing in the e2e runner cleans its own record.

**Files.** `scripts/dispose-worktree.mjs` (argument resolution, `locateInventory`),
`scripts/dispose-worktree.mjs` (`isRegenerableIgnored`, `protectedContentOnDisk`),
`scripts/e2e-run.mjs` (`RUN_RECORD`)

## 158. The worktree-inventory suite reads the shared main checkout, so its verdict depends on whether main happens to be clean

**Problem.** `worktree-inventory.test.mjs` calls `liveWorktreeFacts()`, which reads every
worktree git reports — including the MAIN checkout, located by `listWorktrees(cwd)[0].path`
precisely so the answer does not depend on which worktree the suite was invoked from. Two
consequences, and the second is the defect.

`classify()` marks the primary worktree `STATUS.LANDED` **unconditionally** — the `wt.isPrimary` arm
of the status ladder — before any
look at its working tree: `isPrimary` short-circuits ahead of the `uncommitted && ahead === 0`
arm that would otherwise report `UNCOMMITTED_ONLY`. So the main checkout holding uncommitted
work is still classified `landed`.

The test `protects that shape in a worktree NOBODY has written anything down about`
in `worktree-inventory.test.mjs` filters to `r.inRepo` and asserts nothing there is
unreported. The main checkout is in that set. Its own comment claims "creating a worktree,
and this agent's own worktree, change nothing here" — true of worktrees this agent creates,
and false of the one worktree every agent shares.

Measured on 2026-10-01: with two untracked files in the main checkout, the suite failed with
`ph (curated: NONE): ahead=0 onMain=true dirty=0 untracked=2 -> status=landed ... expected [Array(1)]
to deeply equal []`. Move those two files aside and it passes, with no code change. The suite
is green or red depending on whether a concurrent session left a file in `main`.

This is not a regression and it is not caused by any branch in flight; it reproduces on
pristine `main` whenever main is dirty. It is reported here because the next session to hit
it will read it as its own.

**Fix.** Two separable decisions, and the second is a judgement call rather than a repair.

1. Make the test hermetic. Either exclude the primary worktree from the derived set with a
   stated reason — it is never a disposal candidate, and `dispose-worktree.mjs` refuses
   `main-worktree` outright — or give the test its own fixture repository, which
   `makeRepo()` in this same file already provides for the `git.mjs` cases.
2. Decide whether `isPrimary` should short-circuit ahead of the working-tree facts. If the
   main checkout is genuinely never a candidate, the current order is right and only the test
   needs changing. If it should still report uncommitted work, the `isPrimary` arm has to
   move below the `uncommitted` arm, which changes the inventory's output for every run and
   belongs to whoever owns `WORKTREES.json`'s meaning.

**Files.** `scripts/__tests__/worktree-inventory.test.mjs` (the
`it('protects that shape in a worktree NOBODY has written anything down about')` case),
`scripts/lib/worktree-inventory/classify.mjs` (`classify()`, its `wt.isPrimary` status arm)
---

## 159. The reported post-crop stroke offset has no matching current-code diagnosis

**Problem.** A post-crop stroke was reported in the wrong vertical band, but the recorded diagnosis
does not match the current call path. The observation remains unresolved; do not apply the proposed
frame subtraction until the current reproduction is traced end to end.

**Reported measurement, 2026-10-02; not reverified against current HEAD.** Cropping to document
`(80,270)-(720,570)` — a `640x300` document with a non-`{0,0}` origin — then drawing a bar across
the middle of the cropped document:

|                                                                  | read bands                                |
| ---------------------------------------------------------------- | ----------------------------------------- |
| **control**: a bar on the UNCROPPED document, at 50% height      | `[false, true, false]` — strip 1, correct |
| **after the crop**: a bar on the CROPPED document, at 50% height | `[true, false, false]` — strip 0          |

The recorded measurement detected ink in strip 0 while the uncropped control landed in strip 1.
However, the comment in `e2e/crop-history.spec.ts` says the post-crop bar renders no ink, and the
test does not assert its pixels; these are conflicting observations, not a confirmed current result.

**Call-path conflict.** The cited `drawBar()` selects `draw`, which is implemented by
`DrawToolArea`, not `usePaintStroke`. On pointer-up, `DrawToolArea` converts canvas-local points to
document coordinates, computes the new layer's document-space bounds, then rebases the committed
points to that layer's local origin. `createLayerFromTool` stores those coordinates, and
`drawLayerSource` subtracts the document-frame origin from the layer position. The proposed change
to `usePaintStroke.toDocumentPoint()` therefore does not affect this reproduction, and blindly
subtracting the frame in the draw path risks applying the origin twice.

**Nearby but unrelated helper.** `src/util/layer-space.ts` rebases document points onto the
**layer** origin for six stroke tool areas (`documentPointsToLayerLocal`, 9 callers). That handles
layer-local coordinates, not the document-frame origin, and is not called by this `draw` path.

**What would close it.** Reproduce the exact crop-and-draw gesture against current HEAD and record
the committed tool-layer position and local points, the document frame, and pixel bounds before and
after rendering. Trace those values through `createLayerFromTool`, layer source creation, and
`drawLayerSource` to identify where ink is shifted or lost. Only after confirming a defect should
the responsible transform be changed; keep layer-local coordinates and frame-origin adjustment
applied exactly once. If reproducible, add a post-crop pixel-band assertion to
`e2e/crop-history.spec.ts` with the uncropped control above. Do not weaken existing crop-history
assertions or add an accepted console error.

**Files.** `src/components/Main/DrawToolArea.tsx` (the cited `drawBar()` path),
`src/contexts/useLayer.ts` (`createLayerFromTool()` and `applyDocumentCrop()`),
`src/contexts/layer-utils.ts` (tool-layer source creation),
`src/contexts/layer-renderer.ts` (`drawLayerSource()` frame adjustment), and
`e2e/crop-history.spec.ts` (the
`test('crop, then a bar, then one undo leaves the crop in place and takes only the bar back')` case;
it checks history and dimensions, not the post-crop bar's pixels).
---

## 160. The accessibility gate misses incomplete contrast checks and several live surfaces

`ThemeContext.tsx` hard-codes `DEFAULT_THEME = 'dark'` and the
`prefers-color-scheme` fallback is gone, so dark is what every first-time visitor sees. The e2e
suite pins itself to **light** (`e2e/fixtures/extended-test.ts`'s `pinnedTheme` auto fixture),
because its pixel oracle — `hasDarkPixels`, `getStrokeAnalysis`, `measureInk` — reads "there is
nothing here" out of a near-white pixel and is calibrated against the light workspace checkerboard.
That pin is correct and its header says why. This entry is its cost, and the cost is not the pin.

**The gap.** The one test that runs with the pin released
(`e2e/document-dialogs.spec.ts`, the `test('with nothing stored the document starts dark')` case)
asserts the
`dark` class on `<html>` and the string in `localStorage`. It reads **no pixel**, so it would stay
green if every `dark:` Tailwind variant in the app stopped applying. No other spec exercises a
single `dark:` class. **Nothing measures how dark renders.**

**The measured contrast failure is fixed.** The dock's collapse glyph is a single `«`/`»` character
at `text-sm`, in the collapse-glyph `<button>` in `SidebarRight.tsx`. Its colors now exceed AA in
both themes:

- light: `text-gray-600` (#4b5563) on `bg-gray-200` (#e5e7eb) = **6.10:1**
- dark: `dark:text-gray-300` (#d1d5db) on `dark:bg-gray-700` (#374151) = **7.00:1**

WCAG AA for normal text is **4.5:1**. The glyph remains an axe `incomplete` check because its text is
too short to evaluate, and `e2e/accessibility.spec.ts` does not assert the `incomplete` bucket. That
is still a coverage gap: future contrast regressions on controls axe cannot judge can go unnoticed.

**Remaining coverage work.** The dock glyph's visible contrast is corrected, but the automated
gate still does not assert `incomplete`, and the live flyout and mobile toolbar findings below
remain unaddressed. Update the stale accessibility-test header to describe the current scans and
their limitations before relying on it as an audit record.

### Also live, and found while measuring the above

Both reproduced in **light and dark**; neither is dark-specific.

- **`region`, moderate**, on the flyout/tooltip portal wrapper, with the flyout open
  (`AnchoredOverlay.tsx`'s `createPortal()` wrapper `style` object). A real violation at 1115 audited
  nodes, in a region the file's header lists as unscanned.
- **`aria-allowed-role`, minor** and **`region`, moderate**, on the
  `<nav role="toolbar" data-testid="mobile-bottom-bar">` in `MobileBottomBar.tsx`.
  `role="toolbar"` is not permitted on `nav`. Visible at 500x800, 309 nodes audited.

### `e2e/accessibility.spec.ts`'s header is stale in five places, and reading it costs the next session an hour

Every one of these was fixed in the **same commit that added the file** (`6982cd35`), and the
header describes the state that commit fixed:

- The header's "The dark theme is NOT scanned" bullet says dark reports two extra `color-contrast`
  violations on the panel tab labels, citing
  `dark:text-gray-400` at `PANEL_TAB_CLASS` in `PanelGroup.tsx`. That class is now
  `dark:text-gray-300`
  (**7.00:1**), and a dark scan of the shell reports **0** violations. Measured: light and dark are
  both clean in all three scanned regions — shell, New Image dialog, Draw options bar.
- The header's "## THIS FILE CURRENTLY FAILS, AND THAT IS THE DELIVERABLE" section, and the
  four-violation attribution block under it, describe a red suite. `npm run test:e2e -- accessibility` is
  **3 passed, 0 violation(s)**.
- The header's "Export menu" names a surface this app does not have — `DesktopHeader.tsx` renders
  File (New/Open/Save) and Tools menus only.
- The header's "The scans are per-state, not per-app" bullet says the Save dialog is unscanned. It
  was measured here: 0 violations, 45 nodes, both
  themes. (Not added to the gate, so the header is still right about the gate and wrong about the
  state.)
- Dark is **cleaner** than light by one node: `.text-lg > span` (the same `«`) is `incomplete` in
  light and passes in dark.

**Fix.** Rewrite the header to describe the current state and keep it a measurement rather than a
narrative: state the three scanned regions, their node counts, that both themes report 0, and that
`incomplete` is not asserted — which is what let the glyph through.

**Files.** `SidebarRight.tsx` (the three collapsed-dock `«`/`»` glyph buttons),
`AnchoredOverlay.tsx` (`createPortal()`'s wrapper `style`),
`MobileBottomBar.tsx` (the `<nav role="toolbar">`),
`e2e/accessibility.spec.ts` (its header — "The dark theme is NOT scanned", "`incomplete` is NOT
asserted", "The scans are per-state, not per-app", "## THIS FILE CURRENTLY FAILS, AND THAT IS THE
DELIVERABLE" and its four-violation attribution block — plus `expectNoViolations()`'s doc comment),
`e2e/fixtures/extended-test.ts` (`pinnedTheme`), `e2e/document-dialogs.spec.ts` (the
`test('with nothing stored the document starts dark')` case)

---

## 164. No stroke geometry is aligned to the pixel grid, so a 1px line is two half-grey rows

`src/tools/shape.ts` — `setShapeCtx()`, `src/tools/draw.ts` — `setupDrawCtx()`, `src/util/draw.ts` —
`drawPen()`

Neither context setup contains a half-pixel offset, a coordinate snap, or any `Math.round` on a
point. `setShapeCtx` (`shape.ts`) sets `strokeStyle`, `fillStyle`, `lineWidth`,
`lineCap`, `globalAlpha` and `setLineDash` and nothing else; `setupDrawCtx` (`tools/draw.ts`)
adds `globalCompositeOperation`, `lineJoin` and `lineCap`. A `lineWidth: 1` horizontal stroke at
an integer y therefore covers `y ∈ [y-0.5, y+0.5]` — row `y-1` at 50% and row `y` at 50% — a
2px band of grey where the user asked for a 1px line. Visible at DPR 1, and orthogonal to the
retina upscale: it is about where geometry lands within a pixel, not how many pixels the surface
has.

**Re-derive Adobe's rule from Adobe before implementing anything here.** There is no entry in
`docs/OVERRIDES.md`, and per `AGENTS.md`'s ladder the product's own behaviour is the source of
truth for what Photoshop does. Two facts make a naive fix wrong: the thickness slider reaches
half-integers (`step="0.5"` in `src/components/ToolbarsRight/Figures/Shape.tsx`), so "crisp" is
undefined for a 1.5px stroke and any snap rule is a policy choice; and only axis-aligned strokes
can be snapped this way, so a 45° line would stay soft — a half-measure that looks fixed in a
demo.

**This is the one candidate that collides with a gate.** Alignment changes _document_ pixels, so
it moves the committed raster, therefore the exported file, therefore the baselines in
`e2e/export/visual-regression.spec.ts`, which `AGENTS.md` forbids re-recording to accommodate a
change. Raising the display resolution (D2c) does not.

**Files.** `src/tools/shape.ts` (`setShapeCtx()`), `src/tools/draw.ts` (`setupDrawCtx()`),
`src/util/draw.ts` (`drawPen()`), `src/components/ToolbarsRight/Figures/Shape.tsx` (the thickness
slider's `step`), `e2e/export/visual-regression.spec.ts`

---

## 165. Nothing in the suite can detect a change to a canvas backing store

`e2e/check-dpr.spec.ts` (`CSS_POSITION_TOLERANCE`), `e2e/helpers/screenshot-scale.ts`
(`imageBoundsToCss()`)

`imageBoundsToCss` derives its scale from the decoded capture's extent over the measured box's
extent, so it is invariant under capture scaling: `check-dpr.spec.ts` passes identically whether
the store is 1×, 2× or 8×. Its tolerance is 25 CSS px (`CSS_POSITION_TOLERANCE`, declared beside
the imports, and asserted by the file's three `line start`/`line end`/`line shifted in Y`
expectations), roughly 50× the measured pointer-mapping error, so it distinguishes
"mapping is DPR-invariant" from "mapping is grossly broken" and nothing finer. It is the only
`page.goto('/')` in the suite under an emulated `deviceScaleFactor: 2`; every other 2× test uses
`page.setContent` on synthetic HTML. Two further sites divide by a canvas's own extent
(the `scale`/`offsetX`/`offsetY` block in `e2e/selection-marching-ants.spec.ts`, and the same
block in `e2e/selection-gestures.spec.ts`), so
doubling the store halves the derived scale and leaves the CSS position unchanged — equally blind.

The three overlay stores (`tool-overlay-canvas`, `rect-overlay-canvas`, `selection-ants-canvas`,
the three `<canvas>` elements in `src/components/Main/Main.tsx`) are compared against nothing, not
even each other, so
a change that raised one and not the others is undetectable.

**The relation to pin is `store / data-fit-document-* === 1`, in BOTH a dpr-1 and a dpr-2
context** — the dpr-2 copy is load-bearing, not redundant, since a dpr-conditional raise passes
at dpr 1. The right-hand side comes from the app's own `data-fit-document-*`
(`publishFit()` in `src/hooks/usePointerPosition.ts`, from the store's `totalSize`), which is a
different subsystem from `resizeCanvas`.

**Do not write `canvas.width === box.width * devicePixelRatio`.** It is false today twice over:
`resizeCanvas()` in `src/util/canvas.ts` assigns the width in JS, so no device property is in the
causal chain;
and the workspace `<canvas>` is `h-full w-full object-contain` in `Main.tsx`, so the store is a
_document_
quantity and the box enters only through the contain fit, on the **binding axis** alone. At
1280×720 the fit is height-limited (583/600 = 0.9717), so the width-axis form is red today
(777.3 vs 974). `e2e/text-tool.spec.ts` already rejects the DPR form in writing, for captures.

**Files.** `e2e/check-dpr.spec.ts`, `e2e/helpers/screenshot-scale.ts` (its module header, and
`imageBoundsToCss()`), `e2e/selection-marching-ants.spec.ts` (its contain-fit mapping),
`e2e/selection-gestures.spec.ts` (the same block), `src/components/Main/Main.tsx` (the four
overlay and workspace canvases), `src/hooks/usePointerPosition.ts` (`publishFit()`),
`playwright.config.ts` (no `deviceScaleFactor`; `devices['Desktop Chrome HiDPI']` exists with the
same 1280×720 viewport, and nothing in `e2e/` reads `window.screen`, so a second project would not
move any layout arithmetic — but it would put the six known 2× failures in
`e2e/OPEN_PROBLEMS.md`'s "P3 — no mobile or HiDPI project, and no touch anywhere" entry into the
default run)

---

## 166. The raster and PSD export branches size from different fields, and nothing reconciles them

`src/contexts/export-canvas.ts` — `renderExportCanvas()`'s extent comparison,
`src/contexts/psd-utils.ts` — `savePsd()`'s composite allocation

`renderExportCanvas` derives its extent from `documentFrame` and ignores its `size` argument
whenever the frame is valid. `savePsd` does the opposite: it sizes the composite from `size`
(`canvas2d(size.width, size.height)`) and uses the frame only for layer offsets. A second
asymmetry in the same path: the PSD branch of `handleImageSave()` in
`src/contexts/useFile.tsx` gates the frame on truthiness
alone, so an invalid-but-truthy frame reaches `savePsd` unvalidated, while the raster branch
validates it with `isValidDocumentFrame`.

**Unreachable today, and that is the whole risk.** Every store writer that sets a frame re-derives
`totalSize` from it (the five `documentFrameSize(nextFrame)` call sites in
`src/contexts/StoreContext.tsx`), and
the one reducer arm that could set `size` alone — the `SET_SIZE` arm of `reducer()` — has
no dispatcher anywhere; the only non-test reference is the commented-out `SET_SIZE` dispatch inside
`StoreProvider`. A future
dispatcher is what turns a comment defect into a silent one-document-two-sizes bug.

**Fix.** Reconcile them at the boundary rather than documenting the gap: have the raster branch
size from `size` and take only the origin from the frame, or make both branches read one field.
Whatever is chosen, the `isValidDocumentFrame` check should move to the shared boundary so the
two branches cannot disagree about what a valid frame is. Both halves are now
pinned: the extent at `src/contexts/__tests__/export-canvas.test.ts`, and the origin — through
the call site, which is where a frame can be dropped — at `src/contexts/__tests__/useFile.test.tsx`
("renders the export surface from the staged documentFrame, not from size alone"), which gives
the frame a non-zero origin and an extent that disagrees with `size`.

**Files.** `src/contexts/export-canvas.ts` (`renderExportCanvas()`), `src/contexts/psd-utils.ts`
(`savePsd()`), `src/contexts/useFile.tsx` (`handleImageSave()`'s PSD branch),
`src/contexts/StoreContext.tsx` (the `documentFrameSize()` call sites, `reducer()`'s `SET_SIZE`
arm, and the commented-out `SET_SIZE` dispatch)

## 167. `Edit ▸ Transform` is one item where Adobe has a submenu, and every item in it is blocked on the same two constraints

**Problem.** `Edit` carries exactly one item, `Free Transform`
(the `Edit` menu's only `<li>`, in `src/components/DesktopHeader/DesktopHeader.tsx`), because that
is where Adobe puts it at
the top level. Adobe's `Edit ▸ Transform` **submenu** is a different surface, it is unbuilt, and it is
where a user who knows Photoshop looks for eleven commands. Adobe's own page enumerates them —
"You can find these commands under `Edit > Transform`" —
<https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/transformation-options-in-adobe-photoshop.html>
(fetched 200 on 2026-10-01 with a default `curl` User-Agent; it 403s a browser-shaped one):

| Adobe's item    | Adobe's description                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Scale           | "Resizes the selected content horizontally, vertically, or both."                              |
| Rotate          | "Rotates the selection around a reference point."                                              |
| Skew            | "Slants the content vertically or horizontally by moving its sides."                           |
| Distort         | "Stretches or compresses content freely by moving individual corners or edges."                |
| Perspective     | "Applies perspective by moving one corner, causing the opposite corner to move symmetrically." |
| Warp            | "Bends and reshapes content using a customizable grid or preset warp styles."                  |
| Rotate 180°     | "Rotates the object by 180 degrees."                                                           |
| Rotate 90° CW   | "Rotates the object 90 degrees clockwise."                                                     |
| Rotate 90° CCW  | "Rotates the object 90 degrees counterclockwise."                                              |
| Flip Horizontal | "Flips the selection along the vertical axis."                                                 |
| Flip Vertical   | "Flips the selection along the horizontal axis."                                               |

A twelfth, **`Again`** — Adobe's repeat-the-last-transform command — belongs in the same submenu and is
**attested rather than page-confirmed**: Adobe's current helpx page does not list it, and the source
that does is Adobe's own Photoshop user manual ("Repeat a transformation": "Choose `Edit > Transform >
Again`"). Re-derive the membership before building the item; do not add it because this entry says so.

**Two constraints, and the first one blocks every item including the ones that already exist here.**

1. **`patchToolArgs` alone does not update the canvas.** It is the only setter a menu item can reach
   from outside a tool bar, and it is pure state: `patchToolArgs` is
   the `useCallback` of that name in `src/contexts/useCurrentTool.tsx`, and all it does is call
   `_setToolArgs`, which
   writes the `currentArgs` ref, saves `lastSavedSettings` and publishes React state. Nothing in that
   chain touches a layer. **The pixels move only when `tempUpdateLayer` runs**
   (`src/contexts/useLayer.ts`), which the options bar calls explicitly on **every** control
   change, immediately before `setToolArgs`:

   ```ts
   const throttledOnChange = (newArgs: TransformToolArgs) => {
     // This is a transient preview. History is created only when the dirty
     // layer is committed, so applying the latest value synchronously cannot
     // create one history entry per slider frame.
     tempUpdateLayer({ toolArgs: newArgs });
     setToolArgs(newArgs);
   };
   ```

   `throttledOnChange` in `src/components/ToolbarsRight/Transform/Transform.tsx`. So a `Scale`
   menu item that presets
   args and stops there moves the options bar and nothing else — and every item is the same "preset the
   args" operation, so this is not one item's problem. **`Warp` is a second, separate gap**: it is a
   grid deformation, and `TransformToolArgs` has no warp member at all. `resetArgs`
   (the `const resetArgs: TransformToolArgs` in `Transform.tsx`) is `rotate` / `mirrorH` / `mirrorV` /
   `skewX` / `skewY` / `trapezoid` /
   `resizeX` / `resizeY` and nothing more.

2. **`Rotate 180°` is outside the rotate slider's range.** The slider is `min={-90}` `max={90}`
   (the `#rotate-slider` range input in `Transform.tsx`). The bar's own `180°` button does not go
   through the slider — it writes
   `rotate: (rotate + 180) % 360` (the same `180°` button) — so a value the slider cannot represent is
   already reachable, and a menu item that presets `rotate: 180` lands the options bar in a state its
   own control cannot display. `Scale` has the mirror problem: `resizeX`/`resizeY` are percentages, so
   Adobe's absolute Width/Height percentages need a document-size read the menu does not currently do.

**Fix.** Solve both, in that order, and only then add items. Constraint 1 is load-bearing: either a menu
item reaches `tempUpdateLayer` the way the bar does, or the args-preset path grows a preview step — and
that decision collides with the transient-preview contract in the comment above `throttledOnChange`,
which is what keeps a slider drag from writing one history entry per frame. Constraint 2 is a control
question, not a computation one: reconcile the slider's range with the `±90` button pair
(`handleRotateLeft` / `handleRotateRight`), which already wraps through 360.

**Files.** `src/components/DesktopHeader/DesktopHeader.tsx` (the `Edit` and `Image ▸ Adjustments`
menus), `src/components/ToolbarsRight/Transform/Transform.tsx` (`resetArgs`, `throttledOnChange` and
its transient-preview comment, `handleRotateLeft`/`handleRotateRight`, the `180°` button, the
`#rotate-slider` range input), `src/contexts/useCurrentTool.tsx` (`patchToolArgs`, `_setToolArgs`),
`src/contexts/useLayer.ts` (`tempUpdateLayer`)

## 169. Seven of Photoshop's eleven menus are still missing, so most of its commands have no menu surface at all

**Problem.** The bar is **five** menus — File, Tools, Image, Edit, Window
(the five `header-*-menu-button` triggers in `DesktopHeader.tsx`). Adobe's is eleven: File, Edit,
Image, Layer,
Type, Select, Filter, 3D, View, Window, Help. Two of the five that exist are nearly empty: `Edit` holds
one item, and `Image` holds one submenu.

The gap is not cosmetic. A user who knows Photoshop reaches for `Select > Deselect`,
`Select > Modify > Feather`, `Layer > New Adjustment Layer`, `View > Zoom In` and `Filter > …` and finds
nothing. Worse, several of those are **unreachable entirely**, not merely unreachable from a menu: the
app has no selection inverse, no morphological grow or shrink, and no blur-based feather over a selection
(`src/util/selection.ts` exports no such function), and no adjustment layers at all
(the unsupported-key warning list in `src/contexts/psd-utils.ts` names `adjustment`, `mask` and
`clipping`, and says they are not preserved on import).

**The documentation consequence is the part to fix first.** `docs/TOOLS-TOO-HARD.md` files the Select
gaps as capability absences and justifies them with a menu that does not exist — "There is no menu
surface that could host them". There **is** a menu bar now; there is no `Select` menu on it. Adding that
menu is separable work from the selection-model work, and conflating the two is how a menu gap got filed
as an algorithm gap in the first place.

**Fix.** Add the missing top-level menus in Adobe's order, each carrying the commands the app can
already do and a **disabled** item for each it cannot — the shape `Image ▸ Adjustments` already uses
(the `MenuHostItem` rule that an item is enabled by having a `toolName` and nothing else, applied by the
`disabled={toolName === undefined}` attribute on the menu item button).
Start with **`Select`**: its honest contents are the smallest, because Select All and Deselect are
trivial and Feather / Grow / Modify / Inverse are `disabled` items until the model work lands. Then
**`Layer`**, almost all of it disabled while adjustment layers do not exist. **`View`** and **`Filter`**
follow the same rule. **`Type`** last of the plausible ones; **`3D`** is a candidate for never shipping
at all, and should be decided rather than deferred.

**Files.** `src/components/DesktopHeader/DesktopHeader.tsx` (`MenuHostItem`, `ADJUSTMENTS_ITEMS`
and their doc comments, and the five menu triggers), `src/util/selection.ts`,
`src/contexts/psd-utils.ts` (the unsupported-key warning list),
`docs/TOOLS-TOO-HARD.md` (the Select and Mask and Select ▸ Modify entries), `docs/FEATURES.md`

## 171. `color`'s and `levels`' `imageProcessor` is unreachable from every production call site, which leaves two files maintained on a path nothing runs

**Problem.** `src/tools/colors.ts` and `src/tools/levels.ts` export only an `imageProcessor`, and both
tools declare `commit: 'layer-operation'` (the `color` and `levels` entries in
`src/tools/toolProcessors.ts`). This entry existed to
record that the reachability claim was UNPROVEN, because it had been derived from the single call site in
`useLayer` and five others had not been traced. All six are traced now, and the claim holds for these two
tools:

- `useLayer.ts` — closed by the `commit === 'layer-operation'` arm of `tempUpdateLayer()`, which
  appends the
  retained operation, redraws and returns.
- `useHistory.ts`'s `applyRasterTool` dependency — closed by replay: the
  `commit === 'layer-operation'` arm in `history-replay.ts` re-appends the
  retained operation for a `layer-operation` tool and `continue`s, so the raster branch is never taken for
  either id.
- `materialization.ts`'s creator path — closed by `sourceBitmap()`'s `processor?.creator` refusal, which
  neither tool satisfies. **This module is mounted**, and its mount is why that refusal is load-bearing
  rather than decorative: `durable-compositor.ts` is its sole non-test importer, and `StoreContext.tsx`
  is `durable-compositor.ts`'s, through `composeDurableDocument()` in
  `publishDurableNavigationPresentation()`. Two gates precede the creator call, not one.
  `durableSourceKindForTool()` (`history-adapter.ts`) returns `null` for `color` and `levels`, so a
  layer source for either stays `legacy-tool`; `sourceBitmap()` throws on that kind outright, and
  `publishDurableNavigationPresentation()` refuses the whole document before materialization runs.
  Relaxing either gate without the other still cannot reach the call.
- `materialization.ts`'s raster-operation application — reached only by an `apply-raster-processor`
  operation, and
  the `commit === 'layer-operation'` arm of `history-adapter.ts` maps every `layer-operation` tool to
  `apply-filter`, whitelisting exactly
  `['blur', 'color', 'levels']`.
- `layer-utils.ts`'s `createLayerFromTool()` — needs a `tool` layer source, and `createLayerFromTool`'s
  callers are the text,
  draw and shape paths.
- `layer-renderer.ts`'s `getLayerBitmap()` — gated by `isVectorSource`, whose set is the six shape ids.

**`transform` is not in this class and must not be lumped with them.** It is `commit: 'affine-operation'`
(the `transform` entry in `src/tools/toolProcessors.ts`), which falls past that early return: the
trapezoid path calls
`applyRasterTool` at replay time, and the trapezoid arm of `history-adapter.ts` emits
`apply-raster-processor` with
`processorId: 'transform'`. Its processor runs.

**Why it matters.** If a processor is unreachable then the CSS-filter string (`buildColorsFilter` /
`buildLevelsFilter`, the two functions in `src/tools/functions.ts`) is the whole of the capability, and the
`OffscreenCanvas` work in both files is maintenance on a path nothing runs. That is worth knowing before a
real Levels and a real Black and White are built on top of either.

**Fix.** Decide, and record the decision where the next session reads it: either delete the two
processors and their `imageProcessor` entries, since replay and materialization are both closed, or keep
them and say in `docs/TOOLS-TOO-HARD.md` that they are the raster implementations waiting behind the
canvas-filter requirement, so the two files are not later mistaken for dead code. Do not delete
`transform`'s processor: it runs.

**Files.** `src/tools/colors.ts`, `src/tools/levels.ts`, `src/tools/toolProcessors.ts` (the
`color`/`levels`/`transform` entries), `src/contexts/useLayer.ts` (`tempUpdateLayer()`),
`src/contexts/history-replay.ts` (its `layer-operation` arm),
`src/contexts/history-adapter.ts` (its `layer-operation` and trapezoid arms),
`src/contexts/materialization.ts` (`sourceBitmap()` and the raster-operation application),
`src/contexts/layer-utils.ts` (`createLayerSource()`),
`src/contexts/layer-renderer.ts` (`getLayerBitmap()`, `vectorToolNames`), `docs/TOOLS-TOO-HARD.md`

## 172. Whether `Image ▸ Adjustments` bakes pixels or creates adjustment layers is unanswered, and it changes the durable schema

**Problem.** The operator signalled on 2026-10-01 that Levels, Colors and the other
`Image ▸ Adjustments` commands "will be implemented", and named this as the load-bearing question
before any of that work starts. **It is still unanswered, and it is an architecture decision rather
than a UI one.** The two answers are not the same amount of work and they do not produce the same
document:

- **Baked pixels.** `Image ▸ Adjustments` applies a retained filter operation to the active layer.
  The machinery exists — `layer.operations[]` re-rendered as a CSS filter string by `getLayerFilter()`
  (`src/contexts/layer-renderer.ts`, applied inside `drawLayerSource()`). The gap is only that the
  operations cannot
  be re-edited and there is no Properties panel.
- **Real adjustment layers.** Each adjustment becomes its own layer with its own settings and a mask.
  This needs a layer kind, a settings payload that survives serialization, a mask, and a Properties
  panel that can write back settings no tool owns — plus a history story, because an adjustment's
  parameters change without changing pixels and the linear history model has no entry for that.

**Why it is a question and not a defect.** Nothing is broken; something is undecided, and the
undecided thing is which document model the app has. `loadPsd()`'s unsupported-key warning list in
`src/contexts/psd-utils.ts` refuses
`adjustment`, `mask` and `clipping` on import, so a PSD written by Photoshop with any of them loses
them on the way in today. Choosing baked pixels leaves that refusal in place for a feature that is
one Photoshop adjustment; choosing adjustment layers makes it the first thing to fix. **This cannot
be derived from the tree**, because both answers are implementable and Adobe does not choose between
them for you — Photoshop has both, and which one a clone offers is a product decision.

**Needed by:** before the first real adjustment is built. Building `Levels` against the wrong answer
means re-doing the durable path, and `AGENTS.md`'s architecture-status note is explicit that the
legacy `HistoryItem[]` path is the production replay authority while the durable document is still a
shadow projection — a second schema change on top of an in-flight cutover is how that work gets
harder to finish, not easier.

**Answer (operator writes this line and nothing else):**

**Default if unanswered — baked pixels on the active layer, and the adjustment-layer refusal in
`psd-utils.ts` stays.** It is the smaller change, it is the only one the existing operation stack can
support, and it is reversible later because a baked adjustment can be re-expressed as a layer while
the reverse is lossy. Recorded as an assumption by the merging agent on 2026-10-01. Note what the
default does NOT settle: it does not make the adjustment re-editable, and it does not make the
Properties panel exist, so either answer still leaves `docs/TOOLS-TOO-HARD.md`'s adjustment-layers
entry open.

**Files.** `src/contexts/psd-utils.ts` (`loadPsd()`'s unsupported-key warning list),
`src/contexts/layer-types.ts` (`FilterLayerOperation`, `AffineLayerOperation`, `LayerOperation`),
`src/contexts/layer-renderer.ts` (`getLayerFilter()`), `src/contexts/history-model.ts`, `AGENTS.md`
§Architecture
status, `docs/TOOLS-TOO-HARD.md` (the adjustment-layers entry), `docs/FEATURES.md`

## 173. `color`, `levels` and `transform` are unreachable below 768px, because the rail is not the only thing `toolbarMap` drives

**Problem.** The rail removal deleted one three-wide group from `toolbarMap`, and `toolbarMap` is also
the source for the **mobile** tool bar and tool sheet: `src/components/Mobile/mobile-tools.ts` derives
`mobileToolGroups` from it, consumed by `MobileBottomBar.tsx` and `MobileToolSheet.tsx`.
So the three left mobile as a side effect of a decision that was about the rail.

Their only new host is `Image ▸ Adjustments` and `Edit ▸ Free Transform` in
`src/components/DesktopHeader/DesktopHeader.tsx`, and the header `<header>` element is
`max-md:hidden`. The
mobile drawer (`MobileMenuDrawer.tsx`) carries New / Open / Save / Theme and nothing else. The
breakpoint is pinned at `md` = 768px (the `--breakpoint-md` custom property in `src/index.scss`, and
`MOBILE_MEDIA_QUERY` = `'(width < 768px)'` in `src/hooks/useMediaQuery.ts` — the band Tailwind's
`max-md:` compiles to, as that file's own doc comment on `MOBILE_MEDIA_QUERY` states, and the
constant §152 already cites for this same breakpoint; `TABLET_MEDIA_QUERY` beside it is the
**768–1024px** band and does not describe this one), so
**at every viewport width under 768px there is no UI path to any of the three.** Before this change
they were in the mobile tool sheet (`git show 9a99fe2a:toolbar-mapping.ts` lines 62-64), so this is a
capability regression, not a pre-existing gap.

This contradicts the decision's own terms — `docs/PHOTOSHOP-UX.md`'s rail bullet records "the
capability is to be restructured, **not dropped**" — and the tablet band (768-1023px) is unaffected
because the header is visible from 768 up.

**Why it is filed and not fixed.** The operator's 2026-10-01 instruction: file it, do not fix it.
Mobile parity is a separate piece of work from the rail removal, and every fix trades against a
regression the operator should choose between.

**Fix — three options, none free.** (a) Have `mobileToolGroups` append a command group built from
`extraTools`; it needs labels re-authored, because `extraTools` is a bare `readonly ToolName[]`, and
it lengthens a bar already measured overflowing its own width by 542px at 744px. (b) Add
`Image ▸ Adjustments` and `Edit ▸ Free Transform` to `MobileMenuDrawer` — most faithful to Photoshop
and keeps mobile a command surface, but needs `ADJUSTMENTS_ITEMS` extracted out of
`DesktopHeader.tsx` into a module both hosts import, plus a two-level submenu inside a modal drawer
that closes on every action. (c) Split the rail's view of `toolbarMap` from the mobile view across
four read sites in `SidebarLeft.tsx`; cheapest, and it re-creates the two-lists divergence this
change closed.

**Files.** `toolbar-mapping.ts`, `src/components/Mobile/mobile-tools.ts` (`mobileToolGroups`),
`src/components/Mobile/MobileBottomBar.tsx`, `src/components/Mobile/MobileToolSheet.tsx`,
`src/components/Mobile/MobileMenuDrawer.tsx`, `src/components/DesktopHeader/DesktopHeader.tsx` (the
`<header>` element), `src/hooks/useMediaQuery.ts` (`MOBILE_MEDIA_QUERY`)

---

## 174. The discard prompt has no Save option, and adding one is a product decision

**Problem.** `ConfirmDialog` (`src/components/ConfirmDialog/ConfirmDialog.tsx`) is the app's
replacement for the six native `window.confirm()` guards, and its footer is Discard / Cancel.
Photoshop's prompt before a modified document is replaced carries a third button, and which
buttons it carries is the part that has not been decided here rather than the part that was
implemented around.

**Why it is not simply "add a Save button".** The app's only save is Save As to a NEW file:
`openSaveImageDialog` always proposes `"<name> (copy)"`
(the `proposedName` the dialog is rendered with, in `src/contexts/useFile.tsx`) and `SaveDialog`'s
own title is `Save File As...`
(the dialog's own `<h2>` in `src/components/SaveDialog/SaveDialog.tsx`). There is no path that writes
back to the file
the document was opened from, and no save point to return to — `hasUnsavedChanges` is a boolean
with no `savedRevision` to compare against, and undo always ends dirty
(`projectPublishedTimeline()` in `src/contexts/StoreContext.tsx` hard-codes
`hasUnsavedChanges: true`). So a Save
button on the discard prompt would have to open Save As, and then RESUME the interrupted action —
open the New Image dialog the user asked for, or continue the file open. Whether the user should be
able to do that at all, or whether the interrupted action should simply be abandoned after a save,
is a decision about product behaviour and belongs to the operator.

**What is decided and does not need revisiting.** The guard itself is complete against the
document's actual contents: `hasDiscardableWork` (`src/util/document-dirty.ts`) covers committed
history, an unplaced text box in `currentArgs`, and an in-flight tool transaction in
`previewLayers` — the last of which the store's `hasUnsavedChanges` cannot see, because a live
tool drag dispatches nothing for the whole gesture. The prompt's wording is unchanged from the
native `confirm()` calls it replaced, so the question being put to the user did not change with the
widget.

**Fix.** Decide whether the discard prompt should offer Save. If it should, the pieces it needs are
a real save point first (a revision or history index to compare `hasUnsavedChanges` against, so
undo can return to clean), then Save As, then a resume of the interrupted action — and the resume is
the part with a user-visible choice in it, because the alternative is that saving abandons the New.
If it should not, `docs/OVERRIDES.md` is where the deviation from Adobe belongs, and that file is
the operator's to write.

**Files.** `src/components/ConfirmDialog/ConfirmDialog.tsx`,
`src/contexts/UnsavedChangesContext.tsx`, `src/contexts/useFile.tsx` (the `proposedName` the save
dialog is rendered with), `src/components/SaveDialog/SaveDialog.tsx` (its own title),
`src/contexts/StoreContext.tsx` (`projectPublishedTimeline()`), `docs/FEATURES.md`

## 178. `fix/rail-drop-draw` is parked on a premise OVR-2 voided

**Problem.** The branch deletes the `draw` tool; OVR-2 in `docs/OVERRIDES.md` keeps the tile, so
its premise is void. It is still a live ref at `603356ac` and carries a broken assertion —
`e2e/history-panel.spec.ts`'s `drawRows` locator
(`historyRows(page).filter({ hasText: /^draw/ })`, used by the
`test('the panel lists one row per committed edit, newest first')` case) repoints the stroke filter
to `/^brush/`, then still asserts
`toContainText('draw')`.

**Why it is parked.** Insurance only. OVR-2 marks Dashed Pen and Spray a temporary hold on controls
the paint bar lacks, so `draw` may be deleted later and this is the work for that day.

**What is needed.** Do not merge it; do not dispose of it. If `draw` is deleted, re-derive the
removal from `main` — do not resurrect `603356ac`, which is far behind `main`
(`git rev-list --left-right --count main...fix/rail-drop-draw` — 646 behind, 1 ahead at the time of
writing, and the behind figure grows every time anything lands) and carries the mutant above.

## 179. `fix/migration-review-sweep` cannot merge, and one of its hunks reopens a blank-canvas defect

**Problem.** `5d388e02` is 1 commit ahead and ~180 behind, and 16 of its 24 changed files are also
changed on `main` since the merge base. **Both figures move every time anything lands**, so take
them from the commands rather than from this sentence:
`git rev-list --left-right --count main...5d388e02` (behind, then ahead), and

```bash
comm -12 <(git diff --name-only main...5d388e02 | sort) \
         <(git diff --name-only "$(git merge-base main 5d388e02)" main | sort) | wc -l
```

for the overlap.

It cannot be merged as a commit, and it must never be cherry-picked whole: one hunk narrows
`drawLayersToCanvas`'s previous-pixel snapshot to resize-only, which is exactly the change `d5d8db65`
made in the other direction. `main:src/contexts/layer-renderer.ts`'s
`drawLayersToCanvas()` snapshots in EVERY case and
says why — `resizeCanvas` resets a resized canvas to transparent and `clearRect` empties one whose
dimensions already matched, so a `drawImage` throwing between them left the document blank. The branch
reinstates that window and pins the reinstatement in `layer-renderer.drawLayersToCanvas.test.ts`'s
snapshot assertion.

Three of its production fixes also landed on `main` under different names, so a merge produces two
taxonomies or a silent winner: `presentation-evaluator.ts`'s `PresentationFilterRefusal` against
`main`'s `FilterArgumentUnrenderableError` (`src/util/canvas-filter.ts`) and `evaluatePresentationForDraw`;
`history-append.ts`'s `hasAsset` against `main`'s `registryResolvesAsset` (4f8bdcbb); and
`layer-renderer.filters.test.ts`, which re-points a `getLayerFilter` that `main:layer-renderer.ts`
still exports, so merging it deletes a symbol main's own tests use.

**What survives, and is worth re-applying.** `presentation-evaluator.parity.test.ts` (+783) —
cross-checks `materializeLayer` against `drawLayerSource` on filter string, matrix, bounds and call
order, two independent implementations against literal fixtures; the best test in the branch.
`durable-compositor.refusal.test.ts`'s negative cases, `history-append.merge.test.ts`'s key-order
reversal, and the `history-append.create.test.ts` cases that fix an `if (…) return;` that made a
reader-throwing case vacuous. One case in the refusal file does not test what it claims:
`durable-compositor.refusal.test.ts`'s abort case
builds its abort with `new AbortController().abort()`, which
in jsdom is a real `DOMException`, so it stays green on the defect `isAbortError` exists to catch.

**Three decisions this branch takes and cannot.** `.kilo/plans/history-migration-finalisation.md` §8
`SD-8` records "per-layer refusal vs whole-document rejection in materialization" as
_"taken in code, recorded nowhere… the ruling is still the operator's"_; this branch narrows the
refusal and then hard-codes the narrowed taxonomy into ~10 test cases, which settles SD-8 by test
rather than by ruling, and `docs/OVERRIDES.md` has no entry. Second, `presentation-evaluator.ts`'s
`validateBounds: false` opt-out is guarded only by convention where `main` makes it a
compiler-enforced rule. Third, grading `opacity` against the live record decides part of §92, whose
own text says the decision comes before the edit.

## 181. A branch sweep under-reports unmerged work, and two hardening branches are unmerged because of it

**Problem.** Ancestry alone is not a completeness test. `test/infra-suite-hardening` is not an ancestor
of `main`, yet `git diff --stat main...test/infra-suite-hardening` is empty — it landed by cherry-pick
roughly a hundred commits ago, and `git rev-list --count main..` still reports 2 ahead. A sweep that
asks only "is this branch an ancestor of main" reports live work as pending.

Running the per-file blob comparison instead found five branches whose unit-test work was genuinely
absent from `main`. Three of the five have since landed, which is why the count is two:
`docs/no-line-numbers` carried the citation resolver and its test, and `docs/citation-anchors` +
`fix/saveLayerCanvas-citations` were the same two commits at an earlier tree, so all three are on
`main` together. What remains is `fix/migration-review-sweep` (see §179) and
`docs/luna-psd-currency` (+809 lines to the citation guard). Neither has an entry in
`.kilo/agent-manager.json` at all, which is why §121's structural blindness went unnoticed rather than
being the only cause of it.

**Also unaccounted for.** Eight `agent-manager.json` worktree entries point at directories that no
longer exist and branches that exist in no ref, in no reflog entry and in no dangling commit:
`fix-usehistory-tests`, `wip/fix-replay-coordinator-tests`, `wip/fix-history-adapter-safety-tests`,
`wip/fix-useapp-psd-tests`, `wip/fix-userect-tests`, `wip/fix-layerstab-tests`, `audit-scripts-tests`,
`audit-docs-claims`. Those sessions committed nothing and nothing is recoverable. And two commits sit
on no branch at all: `0a2f7f2b` (board refusals get tests) and `f3811b65`, a `git stash` commit of
`docs/no-line-numbers` whose content is already covered and which additionally carries placeholder
table alignment that would trip the guard it introduces.

**What is needed.** A sweep that compares blobs per test file, not just ancestry, before reporting a
branch as landed. Recover `0a2f7f2b` or drop it deliberately. Do not recover `f3811b65`.

## 182. A branch whose every commit is already on `main` is refused disposal, and a branch with nothing left in it is refused too

**Problem.** `fix/vacuous-assertions` (4 commits) and `fix/blind-gates` (2 commits) are landed —
every one of the six has a `git patch-id --stable` that matches a commit on `main`, and their content is
on `main` as of `4c07778c`. `node scripts/dispose-worktree.mjs` refuses both anyway, with
`The inventory says action: "at-risk", not "dispose"`. The generator counts commits with
`git rev-list --count main..<branch>`, which is reachability, so a cherry-picked or rebased branch
reads as "2 ahead of main" forever. This is the same under-reporting as §181 one layer down: there the
lie was in a sweep's own logic, here it is in the field the whole disposal path gates on.

`docs/ORCHESTRATION.md`, under "Removal goes through one program", says the only field in a curated
entry that moves a verdict is
`mustNotPrune`, and that it applies to "a branch git already calls disposable" — which these are not.
`summary`, `note`, `issues` and `landed` are documentation. So there is no supported way to express
"landed, but not by reachability", and `dispose-worktree.mjs` has no `--force` by design.

**The harder half is `fix/unit-tests`.** Its two commits are genuinely not on `main`, and after the
audit recorded in `4c07778c` there is nothing in them worth landing: the production fix is superseded
by main's mark-and-sweep retirement, the still-valid test cases are now on `main`, and the rest is dead
or vacuous. Its curated entry calls it "the only holder of the #16 and #17 fixes", which was true on
2026-09-27 and is stale now — and the branch's last piece of its own is stale with it. Both of those
prescribed works have landed: the append boundary now forwards its own diagnostics into
`durableDiagnostics` on the `COMMIT_DOCUMENT_EDIT` payload instead of discarding them, and
`planHistoryAppend()` withholds `durableEntry` when `validateTimeline()` produces an `error`
diagnostic. The two tests the older entries said that change would break are gone from
`history-append.test.ts`, replaced by an end-to-end duplicate-id suite that asserts the withheld plan
and the reconversion it falls back to. So the branch is superseded outright, and remains permanently
`at-risk` because "2 ahead" and "worth keeping" are the same signal to the generator.

**What is needed.** Either the generator compares patch-ids rather than commit reachability, so a
cherry-picked branch reads as landed; or a disposition an operator can state meaning "reviewed, keep
nothing" that is not `mustNotPrune`, which is what all three branches need. Until one of those exists,
`git branch -D` and `git worktree remove --force` are the only paths to them, both are gated in
`kilo.jsonc`, and defeating that gate is not the answer — which leaves the operator as the only party
who can retire them.

## 183. A fresh document opens the paint bar on `Custom`, because the seeded brush matches no preset

**Problem.** `defaultSettings.brush` is `alpha: 0.9`, `lineWidth: 10`,
`smoothing: PAINT_SMOOTHING_DEFAULT` (10) and `blendMode: 'source-over'`. The `Hard Round` preset is
`lineWidth: 10`, `alpha: 1`, `smoothing: 0`, `blendMode: 'source-over'`. `matchPaintPreset()`
compares all four fields, so the seeded bar matches nothing and returns the empty string, which
`Paint.tsx`'s preset picker renders as its `Custom` row. The user opens a blank document, picks the
Brush, and is told their tip is a hand-tuned one they have not tuned.

`matchPaintPreset()` is right and `brush.test.ts` — the `it.each(mismatches)` case — pins it
correctly: an empty string is the honest answer for a bar that is not a named tip. The defect is
that the SEED is not a named tip, and it is not obviously which of the two numbers is wrong:

- `settings.ts`'s own comment argues `smoothing: 10` is deliberate, being "Photoshop's own default",
  and that it is what makes a brush stroke smoothed where the legacy `draw` tool was not.
- On that reading the mismatch is `alpha: 0.9`. Photoshop's default brush opacity is 100%, and
  `Hard Round`'s `alpha: 1` agrees with Adobe while the seed does not.
- On the other reading the mismatch is the preset: if smoothing 10 is the app's intended default
  stroke, then the tip that means "the default" is `Hard Round` at smoothing 0, and no preset
  describes what a new document actually starts with.

**Affected.** `src/tools/settings.ts` (`defaultSettings.brush`),
`src/tools/brush.ts` (`PAINT_PRESETS` and `matchPaintPreset()`), and the `Custom` row's render in
`Paint.tsx`'s preset picker. Pinned, correctly, by `src/tools/__tests__/brush.test.ts` — the
`it('reads a freshly seeded paint bar as Custom')` case asserts the current answer, so a fix that
moves the seed must move that assertion with it, and one that moves a preset must not.

**What would close it.** A decision on which field is wrong, then a test that asserts a freshly
seeded bar resolves to a preset label. Do not add a fourth field to the comparison to make the seed
match: the four are the tip's identity, and a field that exists only to be permissive is how a bar
ends up claiming a tip it is not.

**Provenance.** This entry's predecessor lived only on the `brush-toolbar` branch, which is in no
ref of this repository; `.skills/photoshop-tool-creation.md` records that the underlying material
has since landed and that these claims are mainline. The finding outlived the branch, and the
branch's own entry died with it, which is how it came to have no entry at all.

## 185. The Magic Wand discards every matched region except the largest, on every click

**Problem.** `createMagicWandSelectionFromImageData()` in `src/util/magicWand.ts` traces boundary
loops, classifies them into outer contours and holes, and then keeps exactly one outer contour:
`selectLargestBoundaryLoop()` returns the single loop with the largest absolute area. Every other
matched region is dropped. The utility does not warn or log this reduction; the options bar now
discloses it when Contiguous is unchecked.

It is not gated on an option. The bar renders `Contiguous`, the checkbox writes `contiguous`, and this
reduction runs unconditionally on every click — unchecking Contiguous feeds the same call, so the loss
bites hardest exactly when the user has asked for the whole image rather than one region.

**Where it is already recorded.** The header comment on `src/util/floodFill.ts` states that the wand
"keeps only the largest outer loop", for the sibling module's own reasons, and `selectLargestBoundaryLoop()`'s
own neighbour explains the magnitude comparison that drops the rest. The Magic Wand options bar now
states the limitation when Contiguous is off, and its `appNotes` records the underlying single-polygon
constraint. These disclosures mitigate the surprise but do not make the selection include every
matching region. The `floodFill.ts` comment also cites the reduction by line range, and those citations
have drifted past the end of the file it points at.

**Distinct from the recorded hole refusal.** The same function also refuses the whole selection when
any hole is present. That refusal is recorded, but for a different tool: the sentence lives in the
**Quick Selection** record in `src/tools/descriptions/selection.ts` — a grown region, not a wand click
— and `docs/TOOLS-TOO-HARD.md` — Regions with holes quotes the same case. Keeping only the largest
contour is a different loss on a different condition, and it is the one with no record anywhere.

**Affected.** `src/util/magicWand.ts` — `selectLargestBoundaryLoop()`, and
`createMagicWandSelectionFromImageData()` as its caller, which already holds every contour before the
reduction; `classifyBoundaryLoops()` is what separates outer contours from holes for it.

**What would close it.** Keep every outer contour and commit them as subpaths, which needs the
selection to hold more than one loop — the representation `docs/FEATURES.md` — Selection already
declines. The options-bar warning is an interim mitigation; keep this entry open until the selected
geometry can represent and commit every matching region.

## 187. The Brush's `Mode` row promises 29 blend modes and the bar renders 16

**Problem.** The Brush's `Mode` row in `src/tools/descriptions/paint.ts` describes what the bar offers
as "the 27 layer blend modes — Dissolve among them — plus the two the painting tools add, Behind and
Clear". That is twenty-nine. `Paint.tsx` renders `{PAINT_BLEND_MODES.map(...)}`, and
`PAINT_BLEND_MODES` in `src/tools/brush.ts` holds sixteen. So the row states the app offers thirteen
values it does not, and the row is data — `npm run docs:tools` renders it into `docs/TOOLS.md`, so the
generated per-tool specification carries the overcount as the app's own description of its bar.

**The comment on `PAINT_BLEND_MODES` states the counts and names all thirteen, and nothing checks
them.** It is a comment, so `brush.test.ts` — which pins the sixteen values exhaustively — cannot see
it, and a mode added to the array would leave the comment quietly wrong. The array is a closed literal
union precisely because `src/contexts/layer-utils.ts` reads a value back off stored history, but
nothing requires a new member to be one Photoshop lists or one a canvas can express. That gap is the
whole of what is left on this side, and it is a documentation check rather than a code one.

One of the thirteen needs a caveat a future editor could get wrong. `plus-lighter` **is** a canvas
value, and for opaque pixels it computes `src + dst`, which is what Linear Dodge (Add) does — it
diverges only for translucent strokes. The comment's claim is that there is no _exact_ equivalent,
which holds; a reader who takes it as "no such value exists" would be wrong.

**What is already right.** The Brush's `appNotes` in the same file state the shortfall correctly —
"sixteen canvas compositing operations rather than Photoshop's 29 for this tool" — and the reasoning
beside the comment is sound: the canvas compositing set has no equivalent for the rest, and offering one
would ship a dead option.

**Owned, so recorded not fixed: the four blend-mode `Mode` rows.** `src/tools/descriptions/paint.ts`
carries the twenty-seven phrasing in four rows — the Brush, the Pencil, the Paint Bucket and the Clone
Stamp — and each states what Photoshop offers while the two rows beside it in the same file state
what the bar renders.

**The two halves need different fixes, and only two of the four rows have a control to describe.**
`PaintBucket.tsx` and `CloneStamp.tsx` contain no `blendMode` reference at all; their rows are
`status: 'missing'` and their own `appNotes` say the control is absent outright. Writing "the sixteen
the component renders" into those two would be a new falsehood in a data file. Their rows are already
right about Photoshop and already say the control is missing, so what they need is the twenty-seven
sentence marked as Adobe's rather than read as the app's — the same fix as the `status` field, not a
new count.

The Brush and the Pencil are the two that render a control, because both live in `Paint.tsx`, which
maps `PAINT_BLEND_MODES`. Each row overcounts — the Brush's says twenty-nine and the Pencil's
twenty-eight — and each is contradicted by its own `appNotes` in the same file, which already states
sixteen correctly. Those two are the whole of the correction: state the sixteen the component renders
and keep `appNotes` as the statement of the shortfall.

**That is filed rather than fixed because the row is data and the generated file is spoken for.**
`npm run docs:tools` renders these rows into `docs/TOOLS.md`, and both files are claimed by work in
flight — `src/tools/descriptions/paint.ts` by `fix/rail-drop-draw`. Editing the source without
regenerating leaves the two inconsistent, and regenerating rewrites a file another branch is editing.

**Related, and the same phrase in a third file.** `src/tools/descriptions/paint.notes.md` cites the UXP
`BlendMode` enum to establish that Dissolve is one of the twenty-seven, and writes it as "`DISSOLVE` in
the list at the UXP constants reference, alongside `PASSTHROUGH` and the 25 others". The enum has
**twenty-eight** members — the twenty-seven real modes plus `PASSTHROUGH`, which the Layers panel lists
separately — so "the 25 others" is twenty-six. The same file gets the count right further down, where
it calls `PASSTHROUGH` "a twenty-eighth entry", so the file contradicts itself. The four rows above
are not what propagates it — they are being told to state sixteen and stop citing a Photoshop census —
so this is a fix to that file alone. `docs/luna-psd-currency` claims it.

**Affected.** `src/tools/descriptions/paint.ts` — the Brush, Pencil, Paint Bucket and Clone Stamp
`Mode` rows; `src/tools/descriptions/paint.notes.md` — the enum citation; `docs/TOOLS.md`, which
regenerates from the first; `src/tools/brush.ts` — the doc comment on `PAINT_BLEND_MODES`, whose
counts and enumeration no gate checks.

**What would close the `brush.ts` half.** A source-reading test that asserts the comment's counts and
names against `PAINT_BLEND_MODES` — the same technique the three `readFileSync` tests under
`src/contexts/__tests__/` already use — so a member added to the array that is neither on Photoshop's
list nor a canvas value fails instead of quietly making the comment wrong. That is a check on prose,
which is unusual, and it is worth it only because the alternative is a comment whose whole value is
that a reader can trust its count.

## 189. Three fields on a tool's replay declaration are read by tests and by nothing else

**Problem.** `ToolProcessorDefinition` in `src/tools/toolProcessors.ts` gives every tool a `replay`
descriptor carrying a kind, a determinism flag, a raster requirement and a version. Across the whole
repository the first three have **zero production reads**. Every read of them is in
`src/tools/__tests__/tool-processors.test.ts`, in `color-replacement.test.ts`, or in the fixture
literal at `src/contexts/__tests__/durable-replay.layer-operations.test.ts`. Production reads only the
version, at seven sites across three files, through `operationForTool()` in `history-adapter.ts` and
the version guards in `history-append.ts` and `materialization.ts`.

The unimplemented kind is a declared member of both the commit-kind and the replay-kind unions, and
no production branch compares either field against it. An unimplemented tool reaches production only
by falling through to the shared throw, which the
`it('rejects an unimplemented tool with an unsupported-history-feature diagnostic')` title pins. So
a tool that declares itself deterministic when it is not, or declares that it does not need
rasterising when it does, is not detected by anything that runs in a browser.

**Why the blast radius is bounded, and why it still matters.** Production re-derives pixels by
re-running the processor rather than by trusting the flag, and the route is chosen by the commit
kind, so a wrong flag does not by itself corrupt an export today. What it removes is the only
non-test enforcement of a set of claims the project states as truth. The single enforcement point is
the rosters in `tool-processors.test.ts` — the
`it('keeps the %s replay kind aligned with its commit kind')` title among them — so a determinism
flag set on a wall-clock tool ships as a silently irreproducible commit with a green suite.

The gap is specific to these three fields, and that is what makes it a defect rather than a
convention: the sibling declaration fields on the same type _are_ read in production.
`requiresCanvasFilter` gates five production sites, `compositesOntoInput` is read on the raster path in
`history-append.ts`, `commit` is read at roughly twenty, and `creator` is what `materialization.ts` — the
refusal in `sourceBitmap()` — checks before it will render a vector source. Four fields enforced,
three not, with nothing recording the difference.

**Affected.** `src/tools/toolProcessors.ts` — the `replay` descriptor on
`ToolProcessorDefinition`; `src/contexts/history-adapter.ts` — `operationForTool()`, which is where a
version is already read and where one assertion would go; `src/contexts/materialization.ts`, which
already refuses on `creator` and could refuse on the raster requirement the same way.

**What would close it.** One production assertion at the durable write point in `operationForTool()`,
rejecting an unimplemented replay kind — it needs no schema change, because the commit kind is already
in scope there. The raster requirement is not fixable this way: it is recorded nowhere, so there is no
stored value to refuse against. Enforcing it means first deciding that the durable operation should
carry the flag, which is a schema decision rather than an assertion.

## 190. The triangle's geometry is recorded but under-pinned, and the one pin that exists will move with any fix

**Problem.** `drawShape()` in `src/tools/shape.ts` places the triangle's vertices from the drag box's
two half-extents with an even angular step, so the result is a regular three-sided polygon only when
the box is square, and `normalizeShapeGeometry()` squares that box when Shift is held rather than
forcing an equilateral result. Both halves are already recorded — `src/tools/descriptions/shape.ts`,
the `triangle` entry's `appNotes`, and `src/tools/descriptions/shape.notes.md`. What is not recorded is
how little stands
behind them.

**What is pinned, and what is not.** `shape.test.ts` — the
`it.each(['triangle', 'polygon'] as const)('keeps %s geometry consistent with the other figures')` case —
asserts both halves of `normalizeShapeGeometry()` for the triangle: the unconstrained drag passes
through unchanged, and Shift squares the box. So a fix to the squaring **will** turn that case red and it
has to move with the behaviour. What is not pinned is anything about _where the vertices land_.

Everything that touches what is rendered measures the other three figures and only counts the
triangle. `paint-tools.test.ts` — the
`it('draws the figure each geometry variant is registered for, not a generic shape')` title — asserts
`strokeRect` called with real coordinates for the rectangle, `ellipse` with real coordinates for the
oval, and `moveTo`/`lineTo` with real coordinates for the line, then asserts only call counts for the
triangle and the polygon. The asymmetry is inside a single test, so it is not a matter of which file
someone chose to extend. `shape.test.ts` — the `it.each` pairing triangle with three vertices, and the
`it('leaves the triangle at three whatever the field says')` case — likewise assert counts.

**And nothing watches from outside.** `e2e/keyboard-shortcuts.spec.ts` cycles the bar's figure readout
with `Shift+u` and asserts it passes through Triangle and Polygon, so both figures are reachable
end-to-end. It asserts the figure's _name_; it never draws one, and no other spec under `e2e/` draws a
polygon or a triangle at all — the polygonal lasso is a different tool. A regression in the inscribed
placement would reach a user with the whole suite green.

**Affected.** `src/tools/shape.ts` — the `figure === 'triangle' || figure === 'polygon'` branch of
`drawShape()` and the `shiftKey` arm of `normalizeShapeGeometry()`;
`src/tools/__tests__/shape.test.ts` — the `it.each` case that pins the squaring for triangle and
polygon, and the two vertex-count cases; `src/tools/__tests__/paint-tools.test.ts` — the
figure-dispatch case.

**What would close it.** Fix the placement, move the squaring assertion with it, and give the triangle
the coordinate assertion its three siblings in that test already have. An e2e path that draws the
figure is the stronger version of the same coverage and is proportionate to a figure the suite can
currently only cycle by name.

A branch named `fix/shape-truth` exists and is ahead of `main`; read its diff before starting, since
it may already carry part of this.

## 193. A paragraph box whose type outgrows the document commits the overflow as cropped pixels

**Problem.** `calculateNewRect`'s paragraph arm returns `trimRect2(newRect, imageSize)`, so every
edge of a paragraph box is clamped into the document. That clamp is what makes Adobe's overflow icon
reachable — the icon reports the lines against the box's height, and a box that could grow past the
document's bottom edge could never outgrow its own height — and `e2e/text-tool.spec.ts` pins it.

The consequence is that a paragraph box whose content needs more height than the document has is
clamped to the document, and the lines below that edge are cropped rather than overflowing. The layer's
canvas IS the box (`createLayerFromTool` takes `pos` from the rect and `layer-utils`' `createLayerSource`
sizes the creator's canvas at `size: pos`), so the committed layer is the one-line-tall file the type
was laid out in. A point box does not have this problem: it clamps its ORIGIN and lets its extent be
whatever the content needs, so ink past the document edge belongs to the layer.

**Affected.** `src/util/rect.ts` — `calculateNewRect`'s paragraph arm and its final
`trimRect2(newRect, imageSize)`. Pinned by `e2e/text-tool.spec.ts` — the overflow-icon test.

**What would close it.** One of three, and they are mutually exclusive, so this is a product decision
rather than a bug fix:

- Let the paragraph box grow past the document's bottom edge. Closes the crop, and makes the
  overflow icon unreachable — a box that always grows to fit cannot overflow — which deletes a
  shipped Photoshop feature and its e2e.
- Keep the clamp and disable Apply while the draft overflows. Keeps the icon, costs the user a
  control they cannot use until they make room, and invents a gate Adobe does not document.
- Report the overflow against the box the user DRAGGED rather than the grown one, so the icon
  survives a growing box. `renderText` is handed only the final rect and has no knowledge of the
  drag, so `calculateNewRect`'s return type would have to carry it.

**Provenance.** Found by review of the Type tool against its own requirements document, not by a
failing test: no current run trips it, which is exactly why the clamp was allowed to stand.

## 197. Multi-layer bedrock conversion remains intentionally unavailable

**Problem.** New documents and opened images begin with one bedrock layer. The enabled predicates
in `SpongeToolArea()`, `DodgeToolArea()`, `BurnToolArea()`, `SmudgeToolArea()`,
`CloneStampToolArea()`, `GradientToolArea()`, `EraserToolArea()` and `FillToolArea()` refuse that
layer, and `usePaintStroke()` returns without preview or commit when disabled. The desktop Layers
panel now exposes `convertBedrockLayer()` for the lone-bedrock case, but refuses to flatten a
multi-layer stack. A user who opens a multi-layer document and chooses Burn, Sponge, or a sibling
pixel tool still gets the intentional no-op until a safe atomic conversion exists.

`e2e/sponge-tool.spec.ts` pins the refusal on the backing layer and the explicit
conversion route separately. Neither may be weakened into an implicit flatten.

The pixel processors and the durable `apply-raster-processor` operation are not the blocker: the
same tools work on a non-bedrock layer, and the durable model already has the generic operation
shape. `mergeAllLayers()` is an explicit Flatten-like command, not an automatic tool prerequisite.

**What is needed.** Add an atomic durable conversion for a multi-layer stack without silently
destroying layers. Keep the bedrock refusal and do not auto-merge from a rejected pointer gesture.
The conversion must be durable-replayable and must not depend on a mutable presentation canvas. If
the product instead chooses to relax the refusal or require flattening, that is an operator decision
and must be recorded in `docs/OVERRIDES.md` before implementation; an agent must not make that
deviation.

The safe first slice is the one-layer case: `convertBedrockLayer()` reuses the existing
`NEW_LAYER_ACTION` boundary while preserving the Background name, and refuses to flatten a
multi-layer stack. It is `create-layer`, not `merge-document` — naming the bedrock layer's own id
makes `replayHistory`'s create arm replace the record rather than add a second one, and the durable
shadow derives the same `create-layer` operation from the same entry. A future multi-layer Background
conversion cannot reuse `replace-layer-source` either: it admits only `EditableDurableLayerSource`,
so it deliberately cannot carry the raster a Background conversion needs. That needs its own
raster-admitting operation, or an equivalent atomic history action; reusing Flatten for it would
silently destroy the stack.

**Files.** `src/components/Main/SpongeToolArea.tsx`, `DodgeToolArea.tsx`, `BurnToolArea.tsx`,
`SmudgeToolArea.tsx`, `CloneStampToolArea.tsx`, `GradientToolArea.tsx`, `EraserToolArea.tsx`,
`FillToolArea.tsx`; `src/hooks/usePaintStroke.ts`; `src/components/SidebarRight/LayersTab.tsx`;
`src/contexts/useLayer.ts` — `mergeAllLayers()`; `src/contexts/history-model.ts` —
`DurableOperation`; `src/contexts/history-adapter.ts` — `legacyHistoryToDurable()`.

## 198. The citation gate checks `AGENTS.md` for everything except line numbers, so this file's citations are ungated

**Problem.** `scripts/__tests__/agents-citations.test.mjs` enforces the citation rule, and its coverage
is narrower than the rule. `LINE_NUMBER_GATED` holds `AGENTS.md`, `docs/DOCUMENTATION.md` and
`docs/README.md`, so the line-number leg skips every other tracked document — this one included.
`staleCallForms()` is invoked only against `readAgentsMd()`, and `staleHandoffRefs()` takes this file as
its _target_ while validating the references in `AGENTS.md` alone. So no backticked call and no `§N` in
this file is checked by anything.

Two further limits are structural rather than a missing path. `CALL_FORM` requires a trailing `()`, so
a bare constant, a type, a union member or an `it('...')` title is invisible to the call-form leg by
construction — and those are the forms most of this file uses. And no leg of the test reads a sentence
for meaning, so even full coverage could not catch a claim that is confidently false.

**Affected.** `scripts/__tests__/agents-citations.test.mjs` — `LINE_NUMBER_GATED`, and the two
assertions that pass `readAgentsMd()`.

**What would close it.** Two steps, in order. Run `scripts/resolve-citations.mjs` over this file and
repair what it reports, then add this file to `LINE_NUMBER_GATED` and invoke `staleCallForms()`
against it. Widening `CALL_FORM` to accept a
constant, a type and a test title is a separate change and needs its own migration, because it will
flag every bare identifier in every gated document.

## 199. Replay budget runner is dormant until a durable production surface owns it

**Problem.** `defineReplayBudget()` and `runReplayUnderBudget()` now provide a pure cooperative
runner with active-time, step-count, deadline, abort, stale-revision, and explicit over-budget
outcomes. No production replay path constructs a budget or calls it. Wiring it before the durable
materialization boundary is safe only if it stages a result and never publishes partial work.
The runner now contains cleanup failures as failed outcomes and falls back from a suspended
`requestAnimationFrame`.

**What is needed.** Choose the first durable production surface and give it an explicit materialization
caller, revision token, user setting, and publication policy. On an over-budget result, prompt for
explicit raster-baseline acceptance; never rasterize automatically. Close the empty-history baseline
failure and asset publication transaction before exposing that prompt. Keep this runner out of
production until that surface is staged and failure-safe.

**Files.** `src/contexts/replay-budget.ts` — `runReplayUnderBudget()`;
`src/contexts/materialization.ts` — `materializeDocument()`; `src/contexts/useHistory.ts`;
and the empty-history/baseline tests.

## 201. Brightness/Contrast is proportionate but LINEAR, where Adobe's normal mode is nonlinear

**Problem.** `buildLevelsFilter()` (`src/tools/functions.ts`) now drives Adobe's Brightness and Contrast
proportionately over Adobe's own travels — Brightness ‑150..+150, Contrast ‑50..+100 — and that fixed the
clipping the old exponential curve caused. It is still not Adobe's curve. Adobe pairs the two words
itself: "In normal mode, Brightness/Contrast applies proportionate (nonlinear) adjustments to the image
layer, as with Levels and Curves adjustments." The **nonlinear** half is absent, and no formula for it is
published by Adobe or by any reverse-engineering source found. What is measurable is that it is not any
affine map: a `+20` brightness reads `10→11`, `128→145`, `250→253`, and those three deltas are
mutually inconsistent with any constant scale and with any constant offset.

Two consequences, both in the positive half of both controls, because the negative half is exact. A CSS
`brightness(f)` is a clamped pure multiply, so it can never CREATE a white that was not already white, and
`contrast(f)` clamps, so every `f > 1` clips every input past `0.5 + 0.5/f`. At `Contrast +50` the knee
is 212.5 and a channel above it loses its tonal separation for good. The app's `e2e/levels.spec.ts` pins
`244` there specifically because it is a NON-clipped reading; raising the contrast factor turns that pin
into a saturated `255` that proves only that the channel saturated.

**Affected.** `src/tools/functions.ts` — `buildLevelsFilter()` and `proportionateFactor()`; the boundary
is stated on `buildLevelsFilter()`'s doc comment and in `src/tools/descriptions/transform.notes.md`, which
`npm run docs:tools` carries into `docs/TOOLS.md`.

**What would close it.** A per-channel lookup table applied per pixel, which is the same mechanism
`docs/TOOLS-TOO-HARD.md` records as absent for Adobe's real Levels — a CSS filter string cannot express an
arbitrary LUT. That is a new raster path, not an edit to this one: `presentation-evaluator.ts` builds the
string and `layer-renderer.ts` assigns it to `ctx.filter` on an ordinary canvas, so the operation would
have to carry a table instead of a filter and gain a read-back it does not currently have. Whoever takes
it should re-derive the curve from Photoshop measurements rather than from this entry, because the entry's
contribution is the boundary and not the shape.

**Provenance.** Fixed 2026-10-04 on `fix/levels-proportionate-curve`: the proportionate curve, Adobe's
travels, the non-clipping negative half and the exact-black `brightness(0%)` endpoint all landed there.
This entry is only the part that did not.

## 202. `docs/DOCUMENTATION.md` states the presentation-cache rule more strongly than the reducer enforces it

**The problem.** `docs/DOCUMENTATION.md` — the section on a documented constraint beating a
cleaner design — says that if `docs/` says the presentation cache is published through a typed
action, then a refactor that promotes a cache outside reducer publication "has not improved
the code — it has broken a rule that exists for a stated reason". Read literally that makes
`PROMOTE_LAYER_PRESENTATIONS` the violation it names, because promotion does not go through
publication.

**What the code actually does.** Two reducer arms write the presentation cache, and each has
its own guard. `PROMOTE_LAYER_PRESENTATIONS` re-checks `isSamePresentationCanvas` per record
and rewrites only the records that differ. `PUBLISH_RUNTIME_PRESENTATION` replaces `layers`
wholesale, and `dispatchAction` refuses that arm unless `layersDifferOnlyByPresentation`
proves the publication moved no durable layer state. The whole-tree guard is applied on the
publication path and NOT on the promotion path — so the guarantee "a publication cannot move
durable state" is enforced, and the guarantee "promotion cannot silently drop durable state"
is enforced per record by a different, weaker check. Nothing enforces a rule about promoting
outside the reducer, because `PROMOTE_LAYER_PRESENTATIONS` is itself a reducer action.

`AGENTS.md` carried the correction in its architecture-status section until 2026-10-04, when
that section was cut for duplication with `docs/ARCHITECTURE.md` and
`docs/ARCHITECTURE.md` §"The presentation cache". Cutting the paragraph removed the only
document that said the documented rule was stronger than the code, which is why the finding
is filed here rather than left to the next reader of `docs/DOCUMENTATION.md`.

**What would close it.** Reword `docs/DOCUMENTATION.md` so the constraint names the guard
rather than the shape: the rule is that a publication must be refused unless
`layersDifferOnlyByPresentation` holds, and promotion must re-check
`isSamePresentationCanvas` per record. Whether that is the intended invariant, or whether
`PROMOTE_LAYER_PRESENTATIONS` should also carry the whole-tree guard, is an architecture
judgement and belongs to the operator.

---

## 203. No Playwright assertion distinguishes the durable authorities, and no seam exposes the cursor or the published layers

**Problem.** Durable status IS already reachable from Playwright — `ErrorBoundary.tsx` renders
`error-boundary-durable-status`, and `DevStatusStrip.tsx` renders `dev-status-strip` with
`data-status={durableStatus}`. The strip is DEV-gated, and `playwright.config.ts` runs
`npm run dev` as its `webServer`, so it is reachable in every e2e run. What does not exist is any
exposure of the durable CURSOR or of WHICH LAYERS were published from a durable composition: no
`window` hook in `src/`, nothing in `e2e/helpers/` or `e2e/fixtures/`.

The only durable assertions in `e2e/` are the status string and two absence checks —
`error-boundary.spec.ts` reads `error-boundary-durable-status`, and also asserts
`dev-status-strip` and `error-boundary-durable-status` are absent outside an error. None of them
reads a cursor or a published-layer set, so the history specs pass identically whether a navigation
published durable pixels or the mount declined it.

**Consequence.** Browser evidence cannot prove that navigation published durable composition, nor
that a declined composition left the legacy presentation in place. The pixel differential proves the
compositions agree; nothing proves the browser ever shows them.

**Fix.** Extend the existing seam rather than inventing one: put the durable cursor and the published
layer ids beside `data-status` on `DevStatusStrip`, which already reaches Playwright. Add one
history-navigation spec asserting a published durable composition and one asserting the declined
fallback. Assert the seam values, not pixel colours — the pixel claim belongs to
`history-migration.pixel-parity.test.ts` and is duplicated nowhere.

**Files.** `src/components/DevStatusStrip/DevStatusStrip.tsx`, `src/contexts/StoreContext.tsx`,
`e2e/error-boundary.spec.ts`, and the history navigation specs

---

---

## 206. Export parity was never proven for any layer, and the first export axis could not fail

**Problem.** The pixel differential's export axis mounted durable compositions into the legacy
records and then called `renderExportCanvas()` on both sides. That comparison was structurally
incapable of failing. The mount keeps the LEGACY record's `pos`, `visible`, `opacity`, `blendMode`
and `operations`, and `renderExportCanvas()` is handed the legacy frame and size on both sides; the
only durable input was a `tmpCanvas` swap. And because `durablePresentationIsRendererIdentical()`
(`StoreContext.tsx`) accepts a layer only when it has no retained operations and
`isEqual(bounds, existing.pos)`, the bitmap it accepted was a byte-identical copy of the legacy
record's own — 30 accepted mounts, zero differing bytes, on every cursor.

**Measured, not inferred.** Stamping the durable compositor's layer 7px off turns the RUNTIME axis
red and leaves the OLD export axis at zero differing bytes: `renderExportCanvas()` places by
`layer.pos` and never reads `materialized.bounds`, and the accept predicate required those two to be
equal, so the one value worth comparing was equal by precondition. The blindness was **every
cursor**, not the six declines the mount records.

**Consequence.** Export parity is unproven for every layer kind, including plain raster and blank —
not merely for the transformed, filtered and text layers the six declines name. A reader of the green
suite would reasonably conclude the opposite. This is the "simultaneously live and uninformative"
shape §1 records about the mount itself, one level down.

**Fixed here.** The export axis now derives the durable side entirely from the durable composition:
`pos` from `materialized.bounds`, `visible`/`opacity`/`blendMode`/`order`/`name` from the durable
replay layer's own snapshot, `operations` empty because the retained presentation is already baked in,
and size and frame from the durable replay rather than the legacy one. Nothing on that side is read
off legacy replay. The same 7px mutation now turns the export axis red on 30 cursors, so it is a
gate. Run in `src/contexts/__tests__/history-migration.pixel-parity.test.ts` —
`durableExportRecords()`.

**What is still owed.** Export parity is now _enforced_, but two of the scenarios remain unproven in
BOTH directions for jsdom reasons rather than compared-and-agreed: `filter chain`, because
`PixelContext` records `ctx.filter` without applying it, and `text source`, because `fillText`
rasterizes nothing. Those are the two `it.fails` titles naming the limitation. Widening
`durablePresentationIsRendererIdentical()` remains the production question, and it is now separable
from the harness: the harness no longer depends on the mount.

**Files.** `src/contexts/StoreContext.tsx` — `durablePresentationIsRendererIdentical()`,
`src/contexts/export-canvas.ts` — `renderExportCanvas()`,
`src/contexts/__tests__/history-migration.pixel-parity.test.ts` — `durableExportRecords()`

---

## 207. The history-panel differential cannot be built without a durable title mapping, and none exists

**Problem.** RQ-4 names history-panel state as one of the surfaces that must agree. `HistoryTab.tsx`
labels each row with `getHistoryItemTitle()` (`useHistory.ts`) — a pure function of a **legacy**
`HistoryItem`, dispatching on `layerSource.kind`, `actionName` and `TOOL_ACTION`. The durable document
carries `operation.kind` and has no title field anywhere in the tree; no `durableEntryTitle` exists.
Only `item.disabled` and `entry.enabled` correspond field-for-field, so a title differential has
nothing to compare today.

**Why this is filed and not built.** The `operation.kind` to title mapping is a **product decision**,
not a derivation — `apply-raster-processor` to a processor id, `apply-affine-transform` to
"transform", `set-document-frame` to "crop", and a tool source to its tool name are all choices about
what the panel should say. Inventing one inside a test would make every assertion about the invention
rather than about the two models. Pinned as a fact in
`history-migration.pixel-parity.test.ts` — the `it('has one authority today: the durable document
carries no title to difference')` title — so the limitation is visible in the suite rather than only
here.

**Fix.** Derive `durableEntryTitle()` from `operation.kind` in production, mirroring
`getHistoryItemTitle()`'s existing vocabulary so the panel's wording does not change at cutover, and
add the panel-state axis beside the pixel axes. The wording itself is the operator's call if any
durable kind has no legacy counterpart; every kind in the union has one today.

**Files.** `src/contexts/useHistory.ts` — `getHistoryItemTitle()`,
`src/components/SidebarRight/HistoryTab.tsx`, `src/contexts/history-model.ts` — `DurableOperation`,
`src/contexts/__tests__/history-migration.pixel-parity.test.ts` — the `history-panel state` describe

## 213. `type-crop.ts`'s `appRef` line numbers are 60–110 lines off and reach a generated document

**Problem.** `docs/TOOLS.md`'s "In this app" column carries five `Text.tsx` line numbers, every one wrong
by 60–110 lines: the row labelled "Font family" resolves to a comment about tool switching, and the row
labelled "Commit / Cancel" resolves to the start of a `{/*` comment. They come from the
`appRef` values in `src/tools/descriptions/type-crop.ts`, so editing `docs/TOOLS.md` is wrong — the data
is the fix, then `npm run docs:tools`. `tool-descriptions.test.mjs` only fails when a line is PAST EOF,
which is why a citation that drifted by a hundred lines cannot fail any gate.

**Affected.** `src/tools/descriptions/type-crop.ts` — the seven `appRef` values; the generated
`docs/TOOLS.md` follows from them.

**What would close it.** Re-derive each `appRef` from the current `Text.tsx`, or relax `appRef` to accept
a unit citation the way the rest of the documentation rules do. There is a rule conflict behind this and
it is the operator's to settle: `AGENTS.md` bans `file.ext:‹line›` in every tracked document,
`tool-descriptions.test.mjs` documents `REF_PATTERN` as the only form `appRef` accepts, and
`docs/TOOLS.md` is excluded from the citation check because it is generated — so the banned form is
enforced nowhere the form is mandatory.

## 214. An interrupted merge with no `MERGE_HEAD` is never detected or anchored, so its conflicted paths exist only in a working tree

**Problem.** `.kilo/worktrees/migration-review-sweep` sits mid conflict-resolution: **12 unmerged
paths** in 24 dirty entries, `AUTO_MERGE` and `MERGE_MSG` present with **no `MERGE_HEAD`**, on a
**detached HEAD** at a commit on `main`. Its owning session and its two conflict-resolving
subagents last wrote there at 2026-10-03 16:38Z and stopped. **The conflicted content is in no
commit on any ref**, so that working tree is the only copy — and this entry exists because it
nearly was not: nothing in the repository detects this state, and the salvage convention already in
use here (a commit under `refs/keep/salvage/` whose own message states the tree carries conflict
markers and is **not** a resolution) had not been applied. It has been now, at
`refs/keep/salvage/migration-review-sweep-partial`.

**It made `npm run test` red on `main`, and that symptom has since cleared for an unrelated
reason — recorded here so the next reader is not misled.** The inventory suite failed with
`migration-review-sweep … status=unreadable … (tip unreadable or detached)`, from a case that
correctly refuses to let a green run mean "the guard checked everything". The cause was
`classify()` reaching `undecided` for a worktree whose tip it cannot name. A separate change —
`classify.mjs` now reading recent I/O as `in-use` "whatever git says" — reclassified it, the
`undecided` branch stopped firing, and the suite is green with the worktree's 12 unmerged paths
still there. **So the red suite was a symptom and the unmerged paths are the defect**, and they
are still unmerged.

**Affected.** `scripts/lib/worktree-inventory/classify.mjs` — the detached / unreadable-tip path,
now correctly `in-use` rather than `undecided`, which is why the suite is green. The absent
program is the gap: nothing anywhere checks for `AUTO_MERGE` with no `MERGE_HEAD`.

**What would close it.** A check that finds an interrupted merge state and **anchors it** rather
than leaving it as the only copy, with a message recording that the tree is not a resolution —
`docs/ORCHESTRATION.md` names the shape under _Worktrees_ — _After any interrupted or abandoned
merge_ — and there is no program behind it. **The disposition of the 12 unmerged paths belongs to
the operator**, because only the operator may stop a writing chat, and that is deliberately not
decided here.

## 216. An agent cannot release its own recorded ownership, so `npm run dispose` refuses its own caller

**Problem.** `collectOwnership()` keys every signal on the worktree's **absolute path** and never
calls `resolveIdentity` — verified, zero references in the program. There is no "unless the holder is
me" anywhere. Liveness is recency-only over recorded writes, so the chat that wrote in a worktree is
its own live writer for the whole window. Run `npm run dispose` on a worktree you have been working
in and it refuses itself, with text addressed to somebody else.

**There is no escape from inside the agent.** No `--force` exists — the CLI rejects the flag
outright, because a dirty tree is a finding rather than something to override — and
`--max-age-minutes` is ceiling-clamped to the same 15 minutes the inventory-freshness check
imposes. The only exit is `npm run swarm -- release <issue> --force`, which is the operator's move.

Measured over the program's own refusal line: **24 sessions on 2026-10-01 and 2026-10-02, 35 to
date.** Each escalated to the operator; each left landed, inert branches behind.

**Affected.** `scripts/dispose-worktree.mjs` — `collectOwnership()` and the `board-claim`,
`board-lock` and `derived-live-writer` entries of its `REFUSALS` table.
`scripts/lib/worktree-inventory/classify.mjs` — the live-window constant.
`docs/ORCHESTRATION.md` — _Removal goes through one program_, which now names the deadlock and does
not fix it.

**What would close it.** An owner-side release recording **who** released **which** claim and
**when**, refusing a live board agent or a peer with recent I/O, and distinguishable in
`WORKTREES.json` from an operator override. A bare flag on `dispose` is not enough: it must be
auditable in the inventory, or it becomes the `--force` this repository keeps declining to build.
The operator's own rule releases a chat's write ownership when its branch is merged, which makes
this automatic on a landing — so the gap is a chat that finishes work it will never land: an
abandoned feature, or one folded into another branch.

## 218. The no-line-numbers gate covers three markdown documents, and 1,932 citations live outside it

**Problem.** `scripts/__tests__/agents-citations.test.mjs` enumerates `git ls-files '*.md'`, and
`LINE_NUMBER_GATED` names exactly three paths. Everything else is caught only while it is _dirty_,
by the assertion that the maintained corpus carries no citation — which means **a migrated document
can regress silently the moment it reaches zero**.

Two verified consequences. **`docs/LAYERS-PANEL.md` was migrated by hand, is in the maintained
corpus, and is not in `LINE_NUMBER_GATED`**, so it has zero citations today and nothing would report
a re-added one — the same state as `HANDOFF.md`, `docs/TESTING.md` and `TEST-FLAKES.md`. And
**`MIGRATION_NEXT_STEPS_SUNDAY.md` carries 139 citations while being excluded outright**, because
`docs/README.md` lists it as a point-in-time report. That exclusion is right for the retired-symbol
leg, whose mentions in such a document are all true. It is **wrong for the line-number leg**, where
139 unswept coordinates are residue no assertion reports.

Extending the gate to source files is **a 271-file migration, not a scope change**: 1,932 citations
across 740 tracked non-markdown files, 459 of them in `e2e/*.spec.ts` and 42 in
`scripts/__tests__/*.mjs`. Two thirds sit in `src/tools/descriptions/*.ts` and in e2e comments.

**Affected.** `scripts/__tests__/agents-citations.test.mjs` — `trackedMarkdown()`,
`LINE_NUMBER_GATED`, `DOCUMENTS_NOT_CHECKED`. `docs/README.md` — the point-in-time table.

**What would close it.** Decide, and write the reason into the document either way: either widen
`LINE_NUMBER_GATED` to every maintained document, so a clean one is pinned rather than merely quiet,
or state that the gate is a migration's to-do list and not a permanent invariant. The source-file
question is separate and larger, and the honest answer may be that comments in `.ts` are not prose
and the rule should not reach them.

## 219. Nothing stops a test from asserting on a path another process owns, and all three repairs are prose

**Problem.** Every existing instance of this defect was repaired **by hand, with a comment describing
the repair rather than a check**. `scripts/__tests__/e2e-run.test.mjs` asserted
`isPortFree(await findFreePort())` — two binds with the port released in the gap — which
`scripts/e2e-run.mjs` explicitly disclaims. `reservePort`, the production mechanism that exists
_because_ one pick is not a guarantee, had **zero** test references. The repair was hardened,
mutation-proved green, and 0 losses were observed in 10,250 find→check→bind cycles — so it declined
to assert a trigger it had not seen and said so in the file.

That honesty is the right call and it leaves the class open. `node_modules` walking up to the parent
checkout, `.kilo/e2e-last-run.json`, the e2e queue sentinel and the board database are all shared,
and nothing enforces it. A scan that claimed three live siblings in that file was wrong within a day
of the repair, which is this repository's own failure class and the reason the class needs a check
rather than a fourth repair.

**Affected.** `scripts/__tests__/e2e-run.test.mjs`; `scripts/lib/**` for the shared-path helpers;
`node_modules` resolution, `.kilo/e2e-last-run.json`, the e2e queue sentinel, `board.db`.

**What would close it.** A rule with a check behind it: a test in this repository may not **write** a
path outside a per-test temp directory, and the machine-shared paths get an explicit allowlist for
reads. `scripts/__tests__/suite-budgets.test.mjs` already derives every spawning suite from the tree
and asserts the derived set against a hard-coded list, so the mechanism for a derived inventory
exists here already.

## 220. The merge guard cannot see a branch that committed a stale file, and no merge-time check can

**Problem.** `merge-takeover-guard.mjs` compares a merge result against one whole side's content, and
it is now good at that — the seven shapes an adversarial review measured as silent passes are closed,
and it reports correctly on all 407 merges on `main` with no verdict changed. What it still cannot
see is the defect **upstream** of it: a branch that _committed_ a stale copy of a tracked file, from
a checkout sitting at another HEAD. The merge inherits it. That is the shape `git add -A` in a
worktree at another HEAD produces, and it is the one that cost this repository 17 files and 1,835
lines with no conflict anywhere in it.

No check at merge time can distinguish that from a deliberate edit, because the information does not
exist in the trees — whether the branch's author knew lives in the commit message. Two shapes are
reachable today:

- **`git add -A` in a worktree that is not at `main`**, committing the stale content. The guard sees
  only that the result is one whole side's blob, which it now reports as shape 1 — but by then the
  stale commit is already on the branch and the loss happened when it was written.
- **`git merge --squash -X ours`**, which produces a staged tree identical to HEAD's, so `git commit`
  answers "nothing to commit", there is no commit, no `MERGE_HEAD`, and neither hook fires. The
  branch's payload disappears with no event to hang a check on. Plain `--squash` is fine and stages
  the real merge result.

**Affected.** `scripts/merge-takeover-guard.mjs`; `docs/ORCHESTRATION.md` — the
`merge-takeover-guard` limits, which now names this.

**What would close it.** A check in the **branch's own** hook, where a diff against `main` has two
sides to compare: for each path the branch changed whose result equals some ancestor's content and
is not the merge-base content, report it — and make it discriminating rather than universal by
requiring that the branch's first-parent line contains no merge commit. `.husky/pre-push` already
runs in the branch and already has `main...HEAD`. Do **not** solve this by making the merge guard
refuse more; it is already refusing correctly, and widening it fires on ordinary landings.

## 221. The unit suite still has brittle assertion and fixture gaps

**Problem.** A hardening pass over the suite raised the net test count by 96 and replaced the
assertions that pass on any non-null value, but five classes of test defects remain, each with the
evidence and concrete fix below.

The remaining test defects, each with the fix that was proven to work:

- `src/components/SidebarLeft/__tests__/SidebarLeft.flyout-hardening.test.tsx` addresses flyout rows by
  position — `screen.getAllByRole('menuitemradio')[0].focus()` and an `items[0]` → `items[1]` pair.
  Insert a tool at the top of the brush group and both assertions silently check a different element
  and still pass. The sibling `SidebarLeft.keyboard.test.tsx` now addresses the same rows by their
  `aria-label`, which is the tool's own label from `toolbar-mapping.ts`, so the replacement is copied
  from there; the source also renders `data-testid="tool-flyout-item-<name>-<slug>"` already.
- Over a hundred layout assertions in eight files assert a Tailwind class string through
  `toHaveClass`, concentrated in `HistoryTab.test.tsx`, `LayersTab.test.tsx`,
  `ToolbarHorizontal.test.tsx`, `SidebarLeft.tablet.test.tsx`, `SidebarRight.test.tsx`,
  `SidebarLeft.workspace.test.tsx`, `SidebarLeft.flyout-hardening.test.tsx` and `ToolTooltip.test.tsx`.
  jsdom applies no stylesheet, so each claim is that a token is present in the class attribute; two
  visually identical states can carry different tokens and two visually different states can carry
  none. `ToolTooltip.test.tsx` is the extreme case: its entire content is class-token assertions.
  Where the source exposes state — an `aria-expanded`, an `aria-selected`, a `hidden` attribute —
  assert that instead. Where it exposes nothing, the class string is the only observable and the entry
  should be closed as a source gap rather than a test gap.
- `src/__tests__/fixtures/canvas.ts` exports a third `createMockCanvasContext` under the same name as
  the one in `src/test/setup.ts`, and it is the narrower of the two: no `filter`, and no
  `getImageData`, `putImageData` or `createImageData`. It does carry `quadraticCurveTo`, so the
  earlier claim that it lacked that method was wrong. Because the fixture has no `filter` key at all,
  every one of its consumers — 28 files under `src/` — receives a context without one, so a
  `ctx.filter` or read-back assertion added to one of them silently compares against `undefined`.
  Aligning it with `src/test/setup.ts` is the fix, and it is not free: adding `getImageData` changes
  what the production code believes a canvas can do, so those consumers have to be re-run and read.
- The client-to-canvas coordinate conversion is covered in exactly one place. Every tool-area suite
  mocks `usePointerPosition` with `getLocalCoords` as the identity function, so every expected
  coordinate in them is a product of that mock, and the mock is not a simplification production could
  satisfy: against a store whose container is a bare div, jsdom's all-zero `getBoundingClientRect()`
  gives the contain fit a zero scale to divide by. A wrong zoom or offset conversion — the defect that
  would misalign every stroke under a crop — is therefore pinned only by
  `src/hooks/__tests__/usePointerPosition.test.ts` and by e2e. Whoever wants a component suite to
  reach it has to give the store a measured rect, not another mock.
- A hand-copied literal table drifts, and one already did. `src/tools/__tests__/tool-processors.test.ts`
  copied a seven-chip list into every pen-family card; `main` then re-pointed two of those cards at
  their own groups and the table went stale silently, in the same shape four other hand-copied tables
  in the same change still have. The surviving shape is a `configKey` column carrying the test's own
  claim, resolved through `placeholderToolGroups` — the form
  `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx` already uses. Copying the
  chips instead is the defect, and a comment arguing against importing them is the tell.

**Provenance.** Found 2026-10-04 on `test/harden-units` by a three-way read-only triage of every test
file. The authors mutated their own new assertions to show they could fail, and two independent
reviewers who had read neither the triage nor the authors' reasoning then found more: a
cannot-fail style assertion whose double started on the asserted value, two hand-copied literals with
no independent derivation, an arithmetic restatement of a sibling assertion, and the stale chip table
above, which is the only one of them that was a merge artefact rather than a defect present from the
start. The fixture divergence was left unfixed because the mandate was
test files only.

## 223. The harvest gate sequence cannot dispose the worktree the harvest just gated

**The problem.** `scripts/dispose-worktree.mjs` refuses `derived-live-writer` when the inventory
record's `derivedLive` is true or `writeHistory.derivedChatIds` is non-empty. Two of the four arms
that produce `derivedLive` are call histories inside the worktree — `writeHistory` from the write
calls, and `shellHistory` from bash calls whose `workdir` is under it, per the header of
`scripts/lib/worktree-inventory/writes.mjs` — so a chat that ran the gates in a worktree is the chat
the refusal is about. `--no-live-writers "<why>"` does **not** clear it: `classify()` in
`scripts/lib/worktree-inventory/classify.mjs` keeps `derivedLive` beside the suppressed `live`
precisely so an override cannot erase its own evidence, and `dispose` reads `derivedLive`.

**The consequence, which is the finding.** `.skills/worktree-merge-harvest.md` §Step 5 runs the
gates from inside the branch's worktree and §Step 6 then calls `npm run dispose`, so **a harvest
cannot complete its own removal**. Every sweep that hit this correctly refused to defeat the gate,
which left landed branches accumulating behind a gate nobody could open.

**What the refusal does and does not tell you.** Only the **write** arm names a chat id, and it
expires at `LIVE_WINDOW_MS`, thirty minutes. The **I/O** arm is `RECENT_IO_WINDOW_MS`, four hours,
and comes from recent shell commands in the worktree; the separate `readHistory` is not part of
`derivedLive`. The refusal still prints "a chat" for this arm because it does not identify the
shell actor. The **session** and **board** arms print no id either — `chatLive` is `session.directory`
plus `time_updated`, and `liveAgent` is a board row, so neither is a record of a call inside the
directory. `docs/ORCHESTRATION.md` —
§"`derived-live-writer` can refuse the session that is asking" — is the one home, and both skills
defer to it rather than restating it.

**What is missing.** A lever that is **safe**. The shape that would close this without weakening the
guard is a self-scoped one: a refusal is cleared when the named `derivedChatIds` are **this session's
own** ids and nothing else is live, recorded in `ownership.suppressed` beside the signals it
overrode, so the file stays auditable rather than believed. The current evidence is not sufficient
to implement that safely: `resolveIdentity()` uses `KILO_RUN_ID`, which subagents inherit, while
`rootSessionId()` rolls their calls up to the parent and the inventory emits no per-actor liveness
for the worktree. A matching root id therefore cannot prove that a child is not still using it.
Also, `ownership.suppressed` is a global flag for the all-worktree `--no-live-writers` override,
not a per-worktree release record. A safe implementation needs actor-level recent activity and a
per-worktree audit trail before it can clear any refusal; until then, retain the fail-closed
behavior and do not use the global override as a workaround. Whether an agent may clear its own
name at all is an architecture judgement and belongs to the operator. The global
`--no-live-writers` override remains unsafe and is not a self-scoped release.

## 228. Every shape draws unfilled by default, and no entry records whether that is the ruling

**Problem.** A rectangle drawn on a fresh document is stroked and never filled, because the shape
args seed no `hasFill`: `src/tools/settings.ts` seeds `backgroundColor: null` and no `hasFill` key,
so `Figures/Shape.tsx` renders `filled-toggle` unchecked and `drawShape()`'s gate —
`args.toolMode !== 'path' && !!args.hasFill && !!args.backgroundColor` — is false on its first
conjunct. The colour half is not the blocker: `Shape.tsx` adopts the store's `backgroundColor`, and
`StoreContext.tsx`'s `initialState` carries `#ffffff`, so ticking `Filled` does fill. The default is
the whole of the question.

Whether Adobe's own shape tools fill by default was **not established** while filing this. Adobe's
current [Shape, Path, and Pixel mode options](https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html)
page says Fill Color controls the center of shapes, but does not say whether Fill starts enabled.
The default-keyboard-shortcut reference settles a different question — whether a Draw tool has a
letter — and returns no row either way for shapes. So this entry records the app's behaviour without
asserting what Photoshop does.

**Affected.** `src/tools/settings.ts` — the `shape` default; `src/components/ToolbarsRight/Figures/Shape.tsx`
— `filled-toggle` and `handleFillToggle()`; `src/tools/shape.ts` — `drawShape()`'s `hasFill`
conjunct; `src/tools/__tests__/tool-settings.test.ts` pins the seeded table with `toEqual`, so it
refuses a flip until it is re-derived.

**Blocker.** The Adobe page documents Fill Color's purpose but not the enabled state of a newly
created shape. The component's unfilled default also prevents the Filled checkbox from changing
from uncontrolled to controlled; keep that default for this technical reason, not as a claim about
Photoshop, until a version-specific Photoshop observation or an operator ruling settles the UX. If
the eventual ruling differs from this app, add a shape-specific decision to `docs/OVERRIDES.md`:
OVR-2 is about the Draw tool, not shapes. Preserve the `!!args.backgroundColor` half of the fill
gate either way; it prevents a filled figure without a colour from painting with whatever
`fillStyle` the shared overlay last carried.

---
