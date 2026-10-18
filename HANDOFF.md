# Handoff

Open defects in this code. [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) is the rule: **fixed and
verified DELETES the entry**, a tombstone is not a record, and this file is scoped to `history` by
`SCOPE_BY_FILE`. Where a finding belongs in another document, that document is named in the entry.

Numbering is stable and gaps are expected — a deleted entry's number is not reused.

For imports, retire numbered entries with an explicit list heading such as `### Items 3, 8 — deleted`.
A descriptive numbered heading ending in a status word is ambiguous and makes `swarm import`
refuse the batch; remove the status word for a live entry.

### Items 0, 2-4, 5-10, 11-30, 33-44, 46-54, 56-62, 64-65, 67-73, 75, 77, 82, 84-85, 87-93, 96-97, 100-102, 104-106, 111-112, 115, 117-118, 122, 125-134, 136-138, 141-142, 144-145, 149-150, 154-155, 157-158, 161, 165-166, 168, 170, 175-177, 180, 186-188, 190-192, 194-196, 198-200, 202-203, 204-208, 210-213, 220, 222, 224-227, 229-230 — deleted

Numbers only, and that is deliberate. This heading is the machine-readable record that keeps the
board from re-filing a number as new work
(`scripts/lib/agent-board/handoff-import.mjs` `deadNumbers`), so the numbers have to outlive the
entries. What must not outlive them is prose — a "fixed in `abc123`" line per entry is the
tombstone the lifecycle rule forbids, because it invites a reader to trust a claim instead of
re-deriving the code. So this is a list and nothing else; each number was deleted on verification,
and the verification is `git log`, not this file.

## 1. P0 — durable replay remains staged presentation authority, with append/reorder publication

**Problem.** Two modules the migration was built around — `replay-coordinator.ts` and
`replay-checkpoints.ts` — were imported by nothing outside `src/contexts/__tests__/`, and have
been deleted rather than left as an unimported coordination layer that a later surface could
mount by accident. The two durable modules that remain:

| module                            | non-test importing files                                              |
| --------------------------------- | --------------------------------------------------------------------- |
| `src/contexts/materialization.ts` | 1 — `durable-compositor.ts`                                           |
| `src/contexts/durable-replay.ts`  | 3 — `StoreContext.tsx`, `materialization.ts`, `durable-compositor.ts` |

Production still uses legacy `HistoryItem[]` → `replayHistory` (from `resetHistoryTo` in
`useHistory.ts`) for logical navigation and compatibility state. `StoreContext.tsx` now composes
the mapped durable cursor after that transition and publishes a separate
`durableRenderProjection` selected by the pending/durable/legacy `renderSelector`; successful
eligible committed append/reorder transitions run the same composition in the background while
keeping the legacy selector immediately visible; source-backed imports/replacements and
frame-changing commits remain legacy until their ownership or frame-parity gates are explicit. The
legacy layers remain the logical replay record. `durableDocument`,
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

**Why it matters.** Navigation and eligible committed append/reorder are user-visible durable
projections, and export has its own guarded projection. Durable logical state remains
legacy-authoritative. Every additional surface must keep the same staged publication and lease
ownership contract; frame changes and previews remain on the complete legacy path, and the
migration is not a full authority cutover yet.

**Trap for whoever wires it.** Neither the affine composition nor the vector-argument rescale is
duplicated, so the drift warning this entry used to carry is withdrawn — `materialization.ts` owns no
affine arithmetic of its own. `renderRetainedSegment()` hands the retained operations to
`evaluatePresentation()`, and `presentation-evaluator.ts` — `getPresentationAffine()` composes them
through `multiplyAffineTransforms()`. The rescale has a single owner as well:
`presentation-evaluator.ts` — `scaleVectorArgs()`, which `materialization.ts` imports directly and
`layer-renderer.ts` imports for the legacy path, so the two paths cannot diverge on it. Navigation
and eligible committed append/reorder are now staged callers; source-backed imports/replacements,
frame changes, previews, and the
remaining surfaces still need independent parity gates before they are mounted.

**Rotated crop is now an explicit logical operation, but its presentation gate remains closed.**
The Crop panel and keyboard commit pass the pending angle; one history entry carries the frame and
global affine, and both `replayHistory()` and `replayDurableDocument()` apply it to every extant
layer. `e2e/crop-history.spec.ts` verifies the imported red/blue fixture rotates correctly and one
undo/redo restores the exact pixels. Do not add `SET_DOCUMENT_FRAME_ACTION` to background
presentation: the affine materializer reports bounds `-1,0,65,64` while the legacy evaluator
reports approximately `0,0,64,64` for the same 64px rotated fixture. The test intentionally observes
legacy presentation on commit and renderer-incompatible fallback on redo; resolve this pixel-grid
difference and add exact browser parity before enabling the durable frame gate.

**Also wrong at the boundary.** The legacy compatibility path reads `layer.tmpCanvas` before
`layer.bitmap` through `getLayerBitmap()`, with vector-source handling between those fallbacks;
the durable selector renders its complete projected layer record after materialization. Wiring
the durable path without reconciling these paths changes pixel-tool results.

**Fix.** Keep the runtime, export, history-panel and preview projections independently gated, then
make the remaining presentation authority explicit across editor surfaces. Keep legacy logical state
as the authority until each projection is staged, lease-safe and failure-contained; append/reorder
background publication is guarded, unsupported-source fallback and the raster/blank browser seam are
pinned by tests, and nested `args.enabled` parity is explicit; previews still need proof before
retiring the compatibility replay.

**Files.** `src/contexts/materialization.ts`, `src/contexts/layer-renderer.ts`,
`src/contexts/presentation-evaluator.ts`, `src/contexts/StoreContext.tsx`

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
as PSD. "One exported `MAX_RASTER_PIXELS`" would have to reconcile **five** constants, not one. That
consolidation remains an open decision; the BMP encoder now uses the existing 100 MP document cap
without changing any other codec ceiling.

**The GIF loader and SVG encoder use the document ceiling; the SVG loader remains unbounded.**

| codec | loader budget | encoder budget | check before the allocation it bounds?     |
| ----- | ------------- | -------------- | ------------------------------------------ |
| avif  | yes           | yes            | yes                                        |
| tiff  | yes           | yes            | yes                                        |
| bmp   | 100 MP        | 100 MP         | yes — before pixel readback and allocation |
| gif   | 100 MP        | 65535/axis     | yes — before data-URL encoding and decode  |
| ico   | 256/axis      | 1..256/axis    | yes, on both                               |
| svg   | **none**      | 100 MP         | yes — before PNG readback                  |
| psd   | yes           | yes            | yes — the reference implementation         |

`psd-utils.ts` — `validateSize()` runs ahead of the decoder, the same ordering `tiff-utils.ts` —
`assertIfdWithinBudget()` has, so the PSD column is the shape the others were measured against
rather than an exception to it. What the table leaves open is the loader column for `svg`.

**The ICO loader ceiling is this build's rule, not the format's, and it narrows what opens.** A DIB
entry declares its geometry in a header and a PNG entry only in the stream the browser decodes, so
`ico-utils.ts` reads the former directly and the latter out of the PNG's `IHDR` chunk before
handing the bytes to the browser. Both are held to the same 256 the encoder enforces, so that a file
which opens can be saved back. The consequence worth knowing before changing it: an ICO whose
selected entry decodes above 256 on either axis — a 512×512 PNG entry, which Windows opens, because
it takes that geometry from `IHDR` too — is refused here. Round-trip coherence is the reason, and
loosening the load side reintroduces documents this build then cannot write.

**The BMP decoder's amplification and encoder readback are bounded.** `decodeBmp()` rejects a raster
above `MAX_CREATABLE_DOCUMENT_PIXELS` (100 MP) before validating the pixel payload or allocating its
RGBA output. This is the largest document the app can create, so BMP can still open every canvas
size this build supports without introducing a sixth raster ceiling. A 20000×40000 1-bpp BMP that
previously needed 100 MB on disk and allocated **3.2 GB** is now rejected from its header.
`encodeBmp()` rejects canvases above the same limit before reading back pixels or allocating its
output buffer. `encodeSvg()` applies the same cap before `canvas.toDataURL('image/png')` reads back
and base64-encodes the raster embedded in the SVG. The GIF loader checks its 13-byte header and
logical screen descriptor before wrapping the file in a data URL or invoking the browser decoder.

**Still unbounded:** `image-load-save-utils.ts` — SVG files still pass through `loadImageFile()`
without a pixel ceiling before the whole file is base64-encoded and handed to `new Image()`.

**Files.** `src/contexts/bmp-utils.ts`, `src/contexts/image-load-save-utils.ts`,
`src/contexts/avif-utils.ts`, `src/contexts/tiff-utils.ts`,
`src/contexts/affine-transform.ts`, `src/contexts/psd-utils.ts`, `src/contexts/svg-utils.ts`,
`src/contexts/__tests__/image-load-save-utils.signatures.test.ts`

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
(retired) names in that form — and the omissions are exactly where the migration's own boundary lives:

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
and they are already drifted: `toolIcons.test.tsx` — `toolIconNames` holds a 46-name union by hand;
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

## 78. Three rail defects §74 does not name, and no test can catch any of them

**Validated by an independent audit pass over `toolbar-mapping.ts` against Adobe's own
documentation, 2026-09-29.** §74 carries the inventory; these are the mechanical consequences,
and each is a one-line fix.

**1. Two tools render the letter `B`, and the real `B` handler never reaches one of them.**
The `draw` entry in `toolbarMap` gives the non-Photoshop `draw` entry `shortcut: 'B'`, the same
letter the Brush entry gives. The badge is rendered from the map, while
`AppKeyboardShortcuts.tsx` puts `b` on the brush group, so pressing it can never select `draw`.

**2. Three Photoshop groups are collapsed into one flyout.** The app's six-entry flyout combines
Brush, Pencil, Color Replacement, Eraser, Magic Eraser and Paint Bucket, while Adobe's shortcut
table distinguishes the B, E and G groups. The app's G handler already cycles Gradient and Paint
Bucket, but Gradient remains in its own tile.

**3. Nothing asserts that two tools cannot share a letter.** `toolbar-mapping.test.ts` checks the
shape shortcut group but does not assert that different groups do not claim the same shortcut. The
future assertion must allow variants that legitimately share a group leader's letter.

**These are filed, not fixed.** Deleting `draw` and regrouping the flyout are §74's work; doing
either here would land a deletion without the replacement rail.

**Files.** `toolbar-mapping.ts`, `src/components/SidebarLeft/SidebarLeft.tsx`,
`src/components/AppKeyboardShortcuts.tsx`, `src/components/SidebarLeft/toolbar-mapping.test.ts`

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

## 123. Most pointer moves of a stroke still re-rasterize the stroke's whole bounding box

**Problem.** `tempUpdateLayer` is the sanctioned live-pixel writer for a stroke in progress. The
stroked `draw` pen path and the additive Eraser brush, Dodge, Burn and Sponge paths now append from
the previous endpoint, but spray, block strokes and the remaining processors still read the bitmap
from the hook closure rather than accumulating a safe delta:

`src/contexts/useLayer.ts` now calls the processor-specific incremental helpers for those four
additive paths; the remaining processors take the full argument list on every move.

For those remaining paths, `previewLayersRef.current[id]` is written but not read back as the next
invocation's input, so each move redoes the work for the entire region the stroke has touched so far.
A short stroke is cheap; a long drag over a large canvas is quadratic in the distance travelled, and it
gets worse the longer the stroke runs.

**Reproduce.** Drag one continuous stroke across a large canvas and profile `tempUpdateLayer`. Cost
per event grows with the bounding box covered SO FAR, not with the delta.

**Fix.** Extend the same processor-specific accumulation contract to the remaining paths, or document
the cost as a known limit. A persistent
canvas handle in the processor contract would work, but it must NOT go in `args`: the durable
conversion whitelists the tool-arg shape, and a canvas in `args` would either void the document or
require a migration. Put it outside `args`.

**Files.** `src/contexts/useLayer.ts` — `tempUpdateLayer()` and the processor-specific incremental
guards; the remaining processor modules still need the same contract.

## 124. An ordinary tool commit can move the document's size

**Problem.** A tool commit is supposed to change pixels, not the document. A reproduction harness
exists that measures `totalSize`, `documentFrame` and the canvas backing store across commits, and it
has never been run to a verdict. Four production entry points, all of them live code:

1. ten Rectangle commits, then ten undos and ten redos — the canvas backing store and the footer's
   `totalSize` text must never move
2. crop, then five more commits, then three undos and three redos — the pre-crop cursor must stay at
   the pre-crop size and every later cursor at the cropped one
3. a 64×64 document opened from a fixture, then five commits and five undo/redo rounds (the import is
   async, so it must be polled, and the opened size must be passed in rather than the seeded default)

**The former mobile-shell trigger is closed.** `MobileLayersDrawer.tsx` now calls
`createBlankLayer` without `isBedrock`, passes the document-frame position, and the
`MobileLayersDrawer.test.tsx` test titled `creates an ordinary blank layer covering the document
frame` pins that contract. Adobe documents that the Layers-panel New Layer control creates a regular
pixel layer above the selected layer; Background is a separate, explicitly converted layer type.

The remaining work in this entry is the store-level size and display measurement for entry points 1–3.

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

**What the green run does NOT cover.** Scenarios D and E are deliberately assertion-light: they
assert only `expect(rows.length).toBeGreaterThan(0)`, a tautology, and `console.log` the rest. They
remain diagnostic rather than verdicts for the store-size and display measurements. The mobile blank
layer's regular-layer contract is covered separately by `MobileLayersDrawer.test.tsx`; the remaining
measurement work is the document-size and on-screen display invariant for entry points 1–3.

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

---

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
