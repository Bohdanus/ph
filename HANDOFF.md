# Handoff

Open defects in this code. [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) is the rule: **fixed and
verified DELETES the entry**, a tombstone is not a record, and this file is scoped to `history` by
`SCOPE_BY_FILE`. Where a finding belongs in another document, that document is named in the entry.

Numbering is stable and gaps are expected — a deleted entry's number is not reused.

For imports, retire numbered entries with an explicit list heading such as `### Items 3, 8 — deleted`.
A descriptive numbered heading ending in a status word is ambiguous and makes `swarm import`
refuse the batch; remove the status word for a live entry.

### Items 0, 2-4, 5-10, 11-30, 33-44, 46-54, 56-62, 64-66, 67-73, 75, 77, 81-82, 84-85, 87-93, 95, 96-97, 100-102, 104-106, 108, 111-112, 114, 115, 117-118, 122, 125-134, 136-138, 141-142, 144-145, 149-150, 154-155, 157-159, 161, 165-166, 168, 170, 175-177, 180, 185-188, 190-192, 194-196, 198-200, 202-203, 204-208, 210-214, 220, 222, 224-227, 229-232 — deleted

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

| module                            | non-test importing files                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/contexts/materialization.ts` | 2 — `durable-compositor.ts`, `durable-render-projection.ts`                                                                                                                          |
| `src/contexts/durable-replay.ts`  | 8 — `StoreContext.tsx`, `materialization.ts`, `durable-compositor.ts`, `useCurrentTool.tsx`, `useFile.tsx`, `export-canvas.ts`, `durable-render-projection.ts`, `DevStatusStrip.tsx` |

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
inside that function. Production readers of the durable fields from `useStore()`:

- `useCurrentTool.tsx` — reads `durableDocument` and `durableStatus` in `CurrentToolProvider`;
  this is a production reader on every load (the provider wraps the entire app) and uses them
  to hydrate tool args for the active layer when `durableStatus === 'current'`.
- `DevStatusStripContents` in `DevStatusStrip.tsx` — gates its body on `import.meta.env.DEV`.
- `ErrorBoundaryFallback` in `ErrorBoundary.tsx` — renders only after a region has thrown (`ErrorBoundary.render`).

The earlier claim that the fields are "read by nothing outside that file" was false and is
withdrawn. The two DEV/thrown-gated readers remain non-production in practice; the
`CurrentToolProvider` reader is live on every load but only consumes the document when
`durableStatus === 'current'` (i.e. a durable plan already exists), so the migration remains
staged: the legacy `replayHistory` is still the primary path and durable hydration is a
conditional supplement. The
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
undo/redo restores the exact pixels. Its direct browser differentials now prove byte-identical
legacy/durable composition for a 90-degree single-raster crop (materialized bounds `0,0,64,64`), a
non-quarter 37-degree crop with two differently positioned raster layers, Arial point text, serif
paragraph text, non-centered right-aligned monospace point text, blank, vector-shape, and Draw paint
sources, plus a three-transition mixed-source sequence. The sequence checks every durable cursor
against its corresponding legacy composition: a 37-degree frame transform, a frame-only transition,
and a -17-degree frame transform. The text cases cover left, center and right alignment; the rotated
fixtures use non-zero frame origins. Exact quarter-turn matrices avoid a phantom edge from
`cos(pi / 2)` floating residue. These fixtures establish composed-pixel parity; only the 90-degree
case pins exact materialized bounds. The remaining parity cases assert source pixels and
materialized-layer presence but not exact fractional bounds. They do not close the general frame
gate. Do not add `SET_DOCUMENT_FRAME_ACTION` to background presentation: additional angles, vector
tool variants, blank opacities, paint tools, text styling/rotation combinations and frame sequences
remain unproven, and retained affine operations remain unapproved. The UI test intentionally
continues to observe legacy presentation on commit and renderer-incompatible fallback on redo.

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
`src/contexts/presentation-evaluator.ts`, `src/contexts/StoreContext.tsx`,
`src/contexts/useCurrentTool.tsx`

---

## 31. The selection baseline lookup must stay unbounded over the whole timeline

**Problem.** `deriveSelectionBaseline` (`selection-baseline.ts`) is deliberately unbounded. It
starts from the `previousSelectionState` of the first enabled `SELECTION_ACTION` on the timeline,
then rewinds through earlier disabled selection rows only while each row's validated next snapshot
exactly matches the baseline accumulated so far. If every selection row is disabled, the first row
is a baseline witness only when both snapshots are valid. This treats disabled rows as absent while
preserving selections that existed outside the recorded history. Both consumers take the timeline
wholesale — `replayHistory` in `history-replay.ts` and `legacyHistoryToDurable` in
`history-adapter.ts` — so the durable baseline and legacy replay start from the same snapshot, which
is the parity property `0659ce9` extracted this rule to own.

Bounding the lookup by replay target looks like a correctness fix, but it would reintroduce a
data-loss bug. A `SELECTION_ACTION` entry's `previousSelectionState` carries the selection that
existed _before_ that action. When replay targets an earlier cursor, this later entry may be the
only record of the pre-action selection; bounding the lookup would make the baseline inaccessible
and turn undoing a tool-switch deselect into a silent visual no-op. The original framing — "a
selection can be created by a gesture that writes no history entry" — was accurate before
`00a170dc` routed selections through committed history entries; the current requirement is the
equivalent later-entry `previousSelectionState` witness. A disabled creation can also be reflected
in the `previousSelectionState` of a later enabled move. Rewind that earlier disabled row only when
its `nextSelectionState` exactly matches the later snapshot; a mismatch marks an intervening
selection change and keeps the later snapshot authoritative. Multiple tests pin these rules:

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

- `selection-baseline.test.ts` explicitly passes the whole timeline to the helper while replaying
  at an earlier cursor, and `selection-replay.parity.test.ts` compares legacy and durable selection
  state at every cursor. It also covers disabled create/move/clear chains and detached replay
  results. Keep both consumers aligned.

**Related frame baseline.** `replayHistory()` also scans the whole history for the first
`SET_DOCUMENT_FRAME_ACTION` and seeds `documentFrame` from its `previousFrame`. Bounding that lookup
at the target would lose the pre-crop frame when replaying before the first crop; the test
"replays before the first crop from its recorded previous frame, not the current cropped frame"
pins this. This is the analogous frame-baseline rule, distinct from the selection helper.

**Fix.** Keep `deriveSelectionBaseline()` unbounded over the whole timeline and preserve its exact
disabled-row rewind rule. Any future selection authority migration must keep the baseline and replay
tests as tripwires; bounding one consumer or accepting a mismatched disabled snapshot would reopen
the parity divergence this helper exists to close.

**Files.** `src/contexts/selection-baseline.ts` (`deriveSelectionBaseline`), `src/contexts/history-replay.ts`,
`src/contexts/history-adapter.ts` (`legacyHistoryToDurable`), `src/contexts/__tests__/useHistory.test.tsx`,
`src/contexts/__tests__/history-replay.test.ts`, `src/contexts/__tests__/selection-baseline.test.ts`,
`src/contexts/__tests__/selection-replay.parity.test.ts`

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

## 45. The codecs' raster ceilings disagree, and 80 MP AVIF export is an explicit limit

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

| ceiling                             | value       | where                                                |
| ----------------------------------- | ----------- | ---------------------------------------------------- |
| largest document the app can create | 100,000,000 | `MAX_CREATABLE_DOCUMENT_PIXELS` in `raster-utils.ts` |
| affine transform                    | 67,108,864  | `MAX_AFFINE_PIXELS` in `affine-transform.ts`         |
| PSD                                 | 67,108,864  | `maxPixels` in `psd-utils.ts`                        |
| AVIF, open and save                 | 80,000,000  | `MAX_AVIF_PIXELS` in `avif-utils.ts`                 |
| TIFF, open and save                 | 200,000,000 | `MAX_TIFF_PIXELS` in `tiff-utils.ts`                 |

The two 64 MP constants are the same number written twice, independently, in files that do not
import each other. A 100 MP document can be saved as BMP, GIF, SVG and TIFF, but not as AVIF and not
as PSD. "One exported `MAX_RASTER_PIXELS`" would have to reconcile **five** constants, not one. That
consolidation remains an open decision; the BMP encoder now uses the existing 100 MP document cap
without changing any other codec ceiling.

**The GIF and SVG loaders preflight intrinsic dimensions against the document ceiling.**

| codec | loader budget          | encoder budget         | check before the allocation it bounds?        |
| ----- | ---------------------- | ---------------------- | --------------------------------------------- |
| avif  | yes                    | yes                    | yes                                           |
| tiff  | yes                    | yes                    | yes                                           |
| bmp   | 100 MP                 | 100 MP                 | yes — before pixel readback and allocation    |
| gif   | 100 MP                 | 65535/axis             | yes — before data-URL encoding and decode     |
| ico   | 256/axis               | 1..256/axis            | yes, on both                                  |
| svg   | 100 MP / 64 MiB source | 100 MP / 64 MiB source | yes — before data URL and native image decode |
| psd   | yes                    | yes                    | yes — the reference implementation            |

`psd-utils.ts` — `validateSize()` runs ahead of the decoder, the same ordering `tiff-utils.ts` —
`assertIfdWithinBudget()` has, so the PSD column is the shape the others were measured against,
rather than an exception to it. SVG files are limited to 64 MiB before buffering, and intrinsic
dimensions are checked against the document ceiling before data-URL creation and native image
decoding. `encodeSvg()` also refuses the browser's `data:,` canvas failure sentinel and exported SVG
source strings over 64 MiB, so every successful flattened export fits the import source limit. The
importer has one bounded embedded-raster path matching this app's `encodeSvg()` output: a single
direct PNG data image whose PNG signature, IHDR CRC, IHDR dimensions, root dimensions, and image
viewport all agree. It extracts that PNG and loads it directly instead of asking the SVG renderer to
decode a nested image. Before `FileReader`, the preflight refuses nested data-URL image/document
references outside that wrapper, `<feImage>`, SVG `<foreignObject>`, resource references scoped by a
`data:` `xml:base`, animated `href` changes on image-like elements, and data URLs in CSS
`url()`/`image()`/`image-set()` resources. External non-data references are left to secure SVG
image-mode rules, which treat them as network errors and prevent fetching. Image-element fragment
references are refused because they can recurse through the complete SVG document; same-document
`<use>` and paint-server references remain allowed. Unsupported relative units, sizing expressions,
and stylesheets that could affect root dimensions are refused; decoded-image validation remains the
final guard for auto/percentage dimensions resolved by the browser. This is intentionally narrower
than the SVG format: embedded JPEG/other raster formats and foreign HTML content are not imported
through this path. CSS custom-property values are analyzed as a bounded, global may-flow graph across
stylesheets, inline styles, presentation attributes, and animation values. Unused and inert-only
custom properties are allowed; resource-capable properties, `@import`, and unknown properties that
use `var()` are sinks. Alias and fallback references are followed without resolving selectors,
cascade, inheritance, `@scope`, or media conditions, so impossible flows can still be refused. Malformed
CSS and analysis-limit exhaustion fail closed. This follows the dependency semantics in [CSS Variables
Level 1 §2.3](https://www.w3.org/TR/css-variables-1/#cycles) (sourced), with conservative resource
sinks grounded in [CSS Images Level 4](https://www.w3.org/TR/css-images-4/), [CSS Masking Level
1](https://www.w3.org/TR/css-masking-1/), [Motion Path Level 1](https://www.w3.org/TR/motion-1/),
and [SVG 2 painting](https://www.w3.org/TR/SVG2/painting.html) (sourced). URL scheme checks use the
[WHATWG URL Standard](https://url.spec.whatwg.org/#concept-basic-url-parser) parser so ASCII tab and
newline normalization occurs before classifying `data:` URLs (sourced).
Standalone PNG imports validate the `IHDR` and enforce the same pixel ceiling before `FileReader`;
APNG frame chunks are rejected before decode in both the standalone PNG and flattened-SVG paths.
Standalone JPEG and WebP headers are checked against the document pixel ceiling before image
decode. JPEG preflight checks the first scan for DNL and bounds marker/scan work; DNL-bearing,
hierarchical, differential, and zero-height JPEGs are rejected because their effective dimensions
are not bounded by the supported header path. WebP preflight validates RIFF extents, VP8/VP8L
dimensions, VP8X feature flags, chunk order, animation-frame bounds, and a cumulative chunk limit.
Animated WebP is passed to the browser image decoder after the canvas and frame checks, matching the
existing flattened-image import behavior. Decoded dimensions remain checked after browser decode.

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

The manifest is a historical ownership snapshot, not a complete boundary. Re-deriving from the
first `Files` paragraph of each current numbered entry gives **77 distinct `src/` paths**: 32 are in
the manifest and 45 are not. The count excludes §134's old directory-form reference because §134
has been deleted; it does not include paths mentioned only in problem prose or this section's table.
The current unlisted paths are:

| not in the manifest                                                   | live entries whose `Files` line names it |
| --------------------------------------------------------------------- | ---------------------------------------- |
| `src/components/ConfirmDialog/ConfirmDialog.tsx`                      | 174                                      |
| `src/components/Common/ToolTooltip.tsx`                               | 148                                      |
| `src/components/DesktopHeader/DesktopHeader.tsx`                      | 98, 116, 167, 169, 173                   |
| `src/components/Main/CropToolArea.tsx`                                | 86                                       |
| `src/components/Main/SpongeToolArea.tsx`                              | 197                                      |
| `src/components/Main/TextToolArea.tsx`                                | 86                                       |
| `src/components/Mobile/mobile-tools.ts`                               | 173                                      |
| `src/components/Mobile/MobileBottomBar.tsx`                           | 173                                      |
| `src/components/Mobile/MobileHeader.tsx`                              | 98                                       |
| `src/components/Mobile/MobileLayersDrawer.tsx`                        | 152                                      |
| `src/components/Mobile/MobileMenuDrawer.tsx`                          | 98, 173                                  |
| `src/components/Mobile/MobileToolSheet.tsx`                           | 173                                      |
| `src/components/SidebarLeft/__tests__/SidebarLeft.rendering.test.tsx` | 78                                       |
| `src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts`        | 78, 119                                  |
| `src/components/SidebarLeft/toolIcons.tsx`                            | 116                                      |
| `src/components/SidebarLeft/use-toolbar-overflow.ts`                  | 148                                      |
| `src/components/ToolbarsRight/Colors/Color.tsx`                       | 147                                      |
| `src/components/ToolbarsRight/Draw/Draw.tsx`                          | 152                                      |
| `src/components/ToolbarsRight/Figures/Shape.tsx`                      | 164                                      |
| `src/components/ToolbarsRight/Levels/Levels.tsx`                      | 152                                      |
| `src/components/ToolbarsRight/Smudge/Smudge.tsx`                      | 152                                      |
| `src/contexts/UnsavedChangesContext.tsx`                              | 174                                      |
| `src/contexts/__tests__/history-replay.test.ts`                       | 31                                       |
| `src/contexts/__tests__/selection-baseline.test.ts`                   | 31                                       |
| `src/contexts/__tests__/selection-replay.parity.test.ts`              | 31                                       |
| `src/contexts/__tests__/image-load-save-utils.signatures.test.ts`     | 45                                       |
| `src/contexts/avif-utils.ts`                                          | 45                                       |
| `src/contexts/bmp-utils.ts`                                           | 45                                       |
| `src/contexts/durable-replay.ts`                                      | 94                                       |
| `src/contexts/history-model.ts`                                       | 172, 197                                 |
| `src/contexts/image-load-save-utils.ts`                               | 45                                       |
| `src/contexts/layer-types.ts`                                         | 172                                      |
| `src/contexts/presentation-evaluator.ts`                              | 1                                        |
| `src/contexts/psd-utils.ts`                                           | 45, 147, 169, 172                        |
| `src/contexts/svg-utils.ts`                                           | 45                                       |
| `src/contexts/tiff-utils.ts`                                          | 45                                       |
| `src/hooks/__tests__/useRect.drag.test.ts`                            | 86                                       |
| `src/hooks/useAnts.ts`                                                | 86                                       |
| `src/hooks/useMediaQuery.ts`                                          | 152, 173                                 |
| `src/hooks/usePaintStroke.ts`                                         | 197                                      |
| `src/hooks/useSelectionAnts.ts`                                       | 86                                       |
| `src/tools/descriptions/focus.notes.md`                               | 146                                      |
| `src/tools/descriptions/focus.ts`                                     | 146                                      |
| `src/tools/draw.ts`                                                   | 164                                      |
| `src/tools/sponge.ts`                                                 | 146, 147                                 |

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
session-store one. It takes the first `Files` paragraph of each numbered entry. Run it from this
worktree; resolve the ignored manifest from the shared Git directory because the manifest is not
present in this worktree's `.kilo/`.

```bash
manifest="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.kilo/reviews/2026-09-27-untouched/scope/EXCLUDED-touched-by-prior-campaigns.txt"
awk '/^## [0-9]/{f=0;s=0;next} f&&/^\*\*[A-Z]/{f=0} !s&&/^\*\*Files\.\*\*/{f=1;s=1} f' HANDOFF.md \
  | grep -o '`src/[^`]*`' | tr -d '`' | sort -u > /tmp/handoff_paths.txt
comm -23 /tmp/handoff_paths.txt <(sort "$manifest") | wc -l   # -> 45
```

`sort -u` makes the answer a count of distinct paths rather than entry-path pairs. Re-run the
extraction after numbered entries or their `Files` paragraphs change; do not rely on historical path
tables after a section is retired.

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

## 74. Photoshop toolbar roster: current implementation and unresolved default target

**Not a defect — a standing product requirement, recorded with its cost.** `AGENTS.md` carries
"The toolbar is a Photoshop clone — HARD REQUIREMENT". This entry records the source-backed roster
evidence, the implementation count, and the remaining uncertainty about Adobe's restored default
panel.

**The requirement.** The Tools rail must mirror Adobe's Tools panel: same tools, rendered names,
groups, and letters. An invented Photoshop tool is not relabelled into existence. `Draw` is the
explicit app-only **OVR-2 override** and is preserved; exclude it from Photoshop roster counts.
`color`, `levels`, and `transform` are `Image ▸ Adjustments` / `Edit ▸ Transform` commands, not rail
tools. The registry identifier stays free (`reposition` for the Move tool is fine); the rendered
label does not.

**Current code counts, which use different units.** `toolbar-mapping.ts` has **50 rendered entries**:
49 Adobe-named tools plus Draw, across 21 groups and four source sections. `SidebarLeft` lays those
groups out in one or two columns. The entries use 45 distinct rail `ToolName` identifiers because
flyout figures share the `shape` identifier. `availableTools`
has 53 registry IDs, including five shape aliases and the three command IDs; `ToolIconName` and its
hand-copied test roster each contain 59 icon names. None of these counts is a Photoshop default
panel total. `docs/TOOLS-INVENTORY.md` now lists 22 non-preview tool-panel candidates not mapped
to the rail (with default visibility unverified for some groups) and one separate default-off
Technology Preview. Adobe publishes no complete numbered default roster, so the historical
41/70/36/34 arithmetic is not a verified current target.

**Four corrections to the inventory in `AGENTS.md`, from a second research pass. Read these before
building the target list — the list as written ships a rail that is still not a clone.**

| `AGENTS.md` says                                                              | Actually                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection Brush is "Photoshop on the web, not the desktop panel" — exclude it | Adobe's own **desktop** page says "Select the Selection Brush tool **from the toolbar**". Include it.                                                                                                                                                                                                                                                                                  |
| Adjustment Brush has "zero Adobe pages" — exclude it                          | Two Adobe pages, "Select Adjustment Brush Tool **from the toolbar**". Include it; it is a large _feature_, which is a different decision from membership.                                                                                                                                                                                                                              |
| —                                                                             | **Remove tool** and **Content-Aware Tracing tool** are absent from the list entirely. Both are Adobe-documented, and the Remove tool's page says "In the Tools panel, select Remove tool." A sweep of Adobe's _overview tables_ misses both, because each has its own page instead. Content-Aware Tracing's own page confirms its **group**: "from the Pen tool group in the toolbar". |
| —                                                                             | **Artboard, Frame, Perspective Crop, Slice, Slice Select, Ruler** are also absent. All are in Adobe's own shortcut PDF.                                                                                                                                                                                                                                                                |
| The former toolbar-roster entry was numbered §68                              | The current roster requirement is recorded here as §74.                                                                                                                                                                                                                                                                                                                                |

Two that must **not** be added despite appearing in the shortcut PDF: **3D Material Eyedropper** and
**3D Material Drop** (the removed 3D feature), and **Rounded Rectangle** (CC-era, in neither 2026
enumeration). And the trap that produced the Clone Source false positive: **Adobe's Clone Source is
a panel** (`Window ▸ Clone Source`), not a Tools-panel entry. A name appearing in a panel's title is
how a tool gets miscounted.

**Group order remains a hypothesis, and the requirement says so.** Adobe publishes no page that
enumerates the Tools panel top-to-bottom. The 21-group order is reconstructed from third-party 2026
diagrams and cross-checked against Adobe for membership and named flyout families. Adobe now places
Note and Count in the Eyedropper family, Artboard in the Move group, and Content-Aware Move with Spot
Healing; Content-Aware Tracing is a default-off Technology Preview in the Pen group when enabled.
Still unresolved: the Frame separator; **Line before Star or Star before Line** in the Shape flyout;
Adjustment Brush's default group/visibility; and Content-Aware Tracing's exact Pen-flyout slot if the
preview is enabled. Note/Count default visibility and the total default roster still need a restored
Photoshop default-workspace reference.

**`toolbar-mapping.ts` documents unsupported Adobe tools as omitted and calls out Draw as the OVR-2
exception.** Keep that exception; Draw is not a Photoshop tool, but it must not be removed. The map
contains four source sections and 21 group arrays. `SidebarLeft.tsx` renders the groups in one or two
columns; the exact full-panel order and separator model remain hypotheses until checked against a
restored Photoshop default workspace.

**Current routing state.** `color`, `levels`, and `transform` are already absent from the toolbar map
and remain available as command IDs in `extraTools`; do not delete their processors or durable types
as part of a rail change. The `shape` flyout still maps six rendered entries through the `shape`
name and a `figure` value; registry aliases are a separate type-system count, not six additional map
names. `draw` remains as the explicit OVR-2 override. Its painting implementation may continue to
share the `buildDrawArgs` engine with Brush/Pencil; it is not a deletion candidate.

**Already implemented from the earlier low-cost list:** Single Row and Single Column Marquee,
Sponge, Red Eye, Star, Color Sampler, Ruler, Hand, Zoom, and Rotate View. They are not additions
remaining for this task. The measurement-family gaps are Note and Count; Adobe places them in the
Eyedropper family, and they are pixel-free like the existing Eyedropper/Ruler tools. The `Image ▸
Analysis` measurement scale remains a menu command, not a rail tool.

**The remaining inventory still contains architectural gaps:** Object/Selection Brush tools and
Content-Aware Move/Remove need selection or retouch primitives; History and Art History Brush need
retained-raster history; Type Mask tools need glyph-to-selection rasterization; Path Selection and
Direct Selection need a path model; Artboard and Frame need layer kinds the app does not have. The
current candidate list and its evidence live in `docs/TOOLS-INVENTORY.md`; Content-Aware Tracing is
separate because Adobe marks it default-off.

**View tools are implemented.** Hand, Zoom, and Rotate View now have dedicated rail mappings and
view state; Ruler is also implemented. They should not be counted as missing Photoshop tools. Any
future view-gesture or screenshot-baseline work is separate from the roster reconciliation.

**The first step remains a source-backed target set, not a guessed number:** once the restored
default roster is established, encode its label set and test it separately from flyout order and
layout. Adobe does not publish a full numbered default list, so the old 70/72 target cannot be used
as an oracle. Preserve the Draw override in its own explicit expected-set entry.

**Current roster-test coverage.** `toolIcons.test.tsx` now carries a 59-name icon union; the
`ToolIconName` type and test stay in sync. `tool-processors.test.ts` derives the processor and
pixel-free sets from registered tools, and checks its hand-copied icon/shape tables against those
sets. `SidebarLeft.rendering.test.tsx` pins the current primary-tile order; `toolbar-mapping.test.ts`
pins the shape flyout's six rendered entries. Neither currently asserts the exact source-verified
Adobe default label set, which remains blocked on the missing default-roster evidence.
`AppKeyboardShortcuts.tsx` — the doc comment above `brushGroup` asserts in prose that its cycle
groups match the mapping's groups;
**one of its seven does not** — the Pen tile is six wide and its cycle is three. Nothing tests that
claim. `extraTools` now has a production consumer: `DesktopHeader.tsx` imports it and spreads it into
`MENUS_EXCLUDE` at line 70, which excludes `color`, `levels`, and `transform` from the header's
Tools menu — this is the mechanism that enforces the Photoshop UX routing (header menus, not the
tools rail, own Colors/Levels/Transform). `availableTools` remains test-only. Both are test-pinned by
`toolbar-mapping.test.ts`'s two-way invariant.

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

## 78. The Draw shortcut collision and uniqueness gap are fixed; Gradient remains outside the Paint Bucket tile

Two of the three original findings no longer reproduce. The Draw entry in `toolbar-mapping.ts` has
no shortcut, and `toolbar-mapping.test.ts` now asserts both cross-entry/group uniqueness and the
Draw omission. The old claims that Draw still carries `B` and that no uniqueness test exists are
stale and are removed here.

The B/E shortcut groups are separate in the current rail mapping, so the former six-tool merged
flyout claim is also stale. One related Photoshop rail discrepancy remains: Paint Bucket and
Gradient are separate singleton tiles, so neither has a flyout, even though `G`/`Shift+G` cycles
between them. `SidebarLeft.rendering.test.tsx` pins the current separate-tile behavior. §74 owns the
toolbar roster/grouping decision; this audit does not authorize regrouping the tiles. Preserve the
keyboard cycle and resolve the rail grouping against the §74 requirement before changing layout.

**Stale research/test comments.** `eyedropper-draw.notes.md` still says the Draw `B` collision is
present; that prose is corrected in this pass. `paint-tools.spec.ts` still describes an
"erase-and-fill flyout" for Paint Bucket; `color.spec.ts` and `paint-tool-pixels.spec.ts` contain
outdated group counts, and `paint-tool-pixels.spec.ts` cites a source line instead of a stable
identifier. These test comments are left untouched in this pass because E2E/test-file edits are
outside the current safe edit scope.

**Files.** `toolbar-mapping.ts`, `src/components/SidebarLeft/SidebarLeft.tsx`,
`src/components/Common/AppKeyboardShortcuts.tsx`, `src/components/SidebarLeft/__tests__/toolbar-mapping.test.ts`,
`src/components/SidebarLeft/__tests__/SidebarLeft.rendering.test.tsx`, and the cited E2E specs.

## 83. The panel workspace mixes documented gaps with explicit scope deferrals and partial behavior

`feat/panel-docks` made the tools rail and the History/Layers dock draggable and resizable. The
behaviours and scope decisions below are transcribed from Adobe help pages in
`src/contexts/PanelLayout.tsx` and the panel docs; direct Adobe page fetches returned 403 during
the latest audit, so the repository's cited transcriptions were used for this verification. This
entry distinguishes actual implementation gaps from explicit deferrals.

**1. Panels cannot float.** "Dragging a panel out of its dock creates a floating panel that you
can position anywhere in the workspace"
(<https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/stack-floating-panels.html>).
Not implemented. `PanelLayout.tsx` explicitly leaves floating panels out of the model, and the
operator requirement in `docs/LAYERS-PANEL.md` retires the floating interaction. Treat this as a
scope decision, not an active defect unless that decision is renewed. The Window panel list and
panel-removal affordance belong to item 7; they are not evidence that floating is an unfiled gap.

**2. `Tab` and `Shift+Tab` do not hide panels.** "Press Tab to hide all panels... Press Shift +
Tab to hide all panels except the Tools panel and Options bar."
(<https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/hide-show-panels.html>).
Not implemented. `Tab` is already bound to close an open tool flyout (`SidebarLeft.tsx`), and a
global hide is a separate deferred feature. The Window menu has no `Collapse Panels` command; the
dock's click affordance collapses it to icons but is not an equivalent menu action. Any global
shortcut remains deferred until its interaction with the flyout is resolved.

**3. `PanelGroup` is draggable but not groupable.** Photoshop lets Layers/Channels/Paths be tab
GROUPS sharing one body. The hook does the vertical case of it and not the horizontal one, and
the group model only pays off once a third panel exists. The drag that would extend it is the
same `PanelGroup` header.

**4. A dock cannot be shorter than the workspace.** "You can prevent panels from filling all the
space in a dock. Drag the bottom edge of the dock up so it is separated from the workspace's
edge." The dock occupies the App grid's full-height `1fr` row and has no bottom-edge resize handle.
The internal divider between dock panels is an app-specific affordance; Adobe's cited wording
documents resizing a panel from its edge and the dock from its bottom border. The old
`useDockDrag` comment still incorrectly generalized that the divider was undocumented; it is
corrected in this pass.

**5. Panel icons in the icon strip are not draggable.** "To move a panel icon (or panel icon
group), drag the icon. You can drag panel icons up and down in the dock… or outside the dock."
The strip's icons are click-only buttons. In-dock icon reordering is a separate missing behavior;
dragging outside the dock overlaps with the explicitly retired floating interaction in item 1.

**6. A panel GROUP cannot be moved as a unit by its title bar.** "To move a panel group, drag
its title bar (the solid empty bar above the tabs)." This branch has no title bar: `PanelGroup`'s
header _is_ the tab, so there is no separate bar to grab. Item 3 is a different axis — grouping
several panels into one body, not moving a group.

**7. Workspace management is partial.** Adobe documents saving, switching, deleting and restoring
workspaces, and a workspace "remembers the size and position of panels". This app does persist one
unnamed arrangement under one key and can reset it, but has no save/switch/delete/restore workflow.
It also has no panel list to remove a panel from — Adobe says to select the panel name from the
Window menu — nor a per-tab **Close / Close Tab Group** context menu.

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

## 98. Console diagnostics remain the general operational-error channel, with existing local error surfaces

**Policy boundary.** The 2026-09-30 decision removed native `alert()` calls in favour of diagnostic
logging (`155ba7b8`), and there is still no general toast/snackbar surface in production `src/`.
However, the broader statement that the app has no user-facing error surface is false in the current
code. `SaveDialog.tsx` stores save/export failures in `saveError` and renders them with `role="alert"`;
`ErrorBoundary.tsx` also renders an alert fallback for caught render errors. The latter is mounted
around `Main` and `SidebarRight` only (`App.tsx`) and does not catch event-handler or asynchronous
failures. These local surfaces do not establish that the product has adopted a general operational
toast/banner policy. **Do not add a new app-wide error surface** without an explicit product decision.

**The remaining gap is narrower.** Save/export failures have inline feedback in `SaveDialog` and the
dialog remains the local interaction surface; this audit did not independently verify all retry-state
details. File-open and selection-copy failures inspected in this pass report through `console.error`,
and no general toast/snackbar implementation was found. Whether other operational failures should
gain local or app-wide user feedback remains a product-policy question, not a reason to claim that no
user-facing error surface exists. Entry §45's AVIF ceiling is a separate limit and does not establish
that every export failure is invisible.

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

**Coverage not established by this audit.** Unit tests pin some specific console-error paths, including
file-load/save and header actions, but this pass did not exhaustively map every report to a test. The
claim that no Playwright spec drives failed open, save, export or copy also needs a separate exhaustive
check before relying on it. `e2e/helpers/console-police.ts` is test instrumentation that captures and
fails on unaccepted console/page errors; it is not itself a runtime user-reporting channel.

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

---

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

## 120. The Move tool has seven missing controls and four unimplemented modifiers; implementation is unprioritized

`docs/TOOLS.md` — "Move Tool" — gives `reposition` a written `partial` verdict and lists nine
options-bar rows. Two are `partial`: Auto-Select and Show Transform Controls have behavior without
their corresponding visible controls. The other seven are `missing`: Tool Preset Picker,
Auto-Select Group/Layer, Align, Distribute, Align to, Width and Height. The modifier table also
records four missing behaviors: Alt-drag duplicate, Shift axis constraint, Shift-click selection
extension and arrow-key nudge. This section already tracks those gaps; the older claim that no HANDOFF
entry named them, and the instruction to add a duplicate entry, are stale.

**Current implementation evidence.** `Reposition.tsx` renders no Tool Preset Picker, Auto-Select,
Group/Layer, Align/Distribute, Align-to, or numeric transform controls. `MoveToolArea.tsx` always
hit-tests the topmost layer and draws a resize rectangle without a toggle. The code has no Move-tool
Alt-drag duplicate, Shift axis-lock, Shift-click multi-select, or arrow-key nudge path. The
`isLayerLocked()` checks in `useLayer.ts` now refuse edits/moves of locked layers; do not repeat older
claims that locked layers remain draggable. Multi-layer selection remains blocked by the missing
`selectedLayerIds` state described in `docs/LAYERS-PANEL.md` §4.

**Remaining work.** This entry is the tracking item. The gaps span distinct features: preset
management, transform-bar controls, alignment requiring multi-layer selection, and keyboard/pointer
gestures. No implementation priority or sequencing is established here. In particular, do not
implement alignment before the `selectedLayerIds` model exists, and do not claim Photoshop parity
for spring-loaded V behavior, lock dialogs, or transform-box behavior from the missing-control list
alone; `transform.notes.md` records those as separate divergences/product questions.

**Files.** `docs/TOOLS.md` — "Move Tool"; `src/components/ToolbarsRight/Move/Reposition.tsx`;
`src/components/Main/MoveToolArea.tsx`; `src/hooks/useRect.ts`; `src/contexts/useLayer.ts`;
`src/components/Common/AppKeyboardShortcuts.tsx`; `docs/LAYERS-PANEL.md`.

## 123. Most pointer moves of a stroke still re-rasterize the stroke's whole bounding box

**Problem.** `tempUpdateLayer` is the sanctioned live-pixel writer for a stroke in progress. The
Draw pen path, Draw block-stamp, Eraser brush mode, Dodge, Burn and Sponge paths now use
processor-specific incremental helpers. The earlier claim that Draw block-stamp still re-rasterizes
the full bounds is stale. Spray, Eraser pencil/block modes, Brush, Pencil, Smudge, Clone Stamp,
Gradient, and other raster processors still lack incremental accumulation:

`src/contexts/useLayer.ts` calls incremental helpers only when their tool-specific settings remain
compatible and the new points extend the previous path. Draw spray is excluded; eraser incremental
work is brush-mode only; Dodge/Burn and Sponge compare their relevant settings before reusing the
previous preview.

For non-incremental stroke paths, `previewLayersRef.current[id]` is written but not read back as the
next invocation's input, so each move redoes the work for the entire region the stroke has touched so
far. A short stroke is cheap; a long drag over a large canvas is quadratic in the distance travelled.
Gradient also performs a full-layer rasterization per pointer move; Sharpen and Red Eye are discrete
actions, not accumulating pointer strokes.

**Reproduce.** Drag one continuous stroke across a large canvas and profile `tempUpdateLayer`. Cost
per event grows with the bounding box covered SO FAR, not with the delta.

**Coverage.** `useLayer.incremental.test.ts` currently covers `getIncrementalStrokeArgs`, but not the
eraser, Dodge/Burn, or Sponge helper contracts. Existing Smudge and Gradient tests document their
full-source/full-layer behavior rather than pinning the cost shape.

**Fix.** Extend the remaining gesture processors with safe per-tool accumulation, or document the
cost as a known limit. A persistent canvas handle must NOT go in durable `args`: conversion
whitelists the tool-argument shape, and a canvas there would void the document or require migration.
Keep transient accumulation state outside `args`, and test reset conditions when settings or the
point prefix changes.

**Files.** `src/contexts/useLayer.ts` — `tempUpdateLayer()` and the processor-specific incremental
guards; the remaining processor modules still need the same contract.

## 124. An ordinary tool commit can move the document's size

**Problem.** A tool commit is supposed to change pixels, not the document. The store-level guard is
structural: `totalSize` changes only with `documentFrame`, and ordinary tool commits do not dispatch
a frame update. The remaining concern is display measurement across these three production entry
points, all of them live code:

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

**Current E2E harness.** The probe cases are now in the checked-in
`e2e/canvas-growth.spec.ts`; run them with `npm run test:e2e -- e2e/canvas-growth.spec.ts` from a
worktree. The old `salvage/probe-canvas-growth` instructions and hidden-probe paths are historical;
do not recreate or merge them.

**Store-level boundary.** `totalSize` is recomputed only from `updates.documentFrame`
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

**Current E2E coverage is partial.** The rectangle-commit test asserts backing-store dimensions and
Footer text after its commits/undo/redo, but not the canvas box or computed CSS dimensions. The
Draw-commit test asserts backing store, canvas bounding box, and page geometry, but not Footer text or
computed CSS size. The crop flow logs backing-store/Footer values but asserts only layer-row counts;
its three undo/redo steps match this entry's stated sequence but do not cross the crop boundary to
verify restoration of the pre-crop size. The opened-64x64 test asserts backing-store size after
commit/undo/redo; Footer is diagnostic-only and canvas box/CSS size are not measured. No inspected
scenario derives the letterboxed document rect with `containFit()`.

The remaining gap is therefore specific: Footer/backing-store assertions are incomplete in crop and
opened-document flows, and canvas `boundingBox()`, computed CSS width/height, and the on-screen
document rect are not consistently compared across the three §124 entry points. The Draw test does
assert a canvas box, so the earlier blanket claim that no test ever does is too broad. Keep the
measurement plan in `.kilo/plans/canvas-growth-display-measurement-plan.md` §3 as the worklist; no
E2E assertion change was made in this audit.

## 135. Symlinking a worktree's `node_modules` uses the parent compiler and must remain owner-aware

**Problem.** A shortcut for a worktree with no `node_modules` is to link the parent's dependency
tree. It appears to work — `tsc` and `vitest` both run — but it is not an isolated toolchain: the
`.bin/tsc` guard and compiler resolve through the parent `node_modules`, and package dependencies
also come from there. The child compiler inherits the worktree's current directory, so this alone
does not redirect its project/source inputs to the parent. Use a worktree-local install for a
reproducible toolchain.

`node_modules/.bin/tsc` is itself a **relative** symlink:

```
$ readlink node_modules/.bin/tsc
../../scripts/tsc-guard.mjs
```

So with a symlinked worktree dependency tree, the guard and its real TypeScript compiler resolve from
the parent checkout. The guard's compiler subprocess retains the invoking working directory; the
shared toolchain is the issue, not an automatic switch to the parent's source tree.

**Observed and fixed.** The tsc-guard installer tests once treated a symlinked `.bin` path as owned
because they compared logical path strings. Their write tests could then mutate the parent
checkout's `node_modules`. The ownership predicate in `tsc-guard.test.mjs` now compares physical paths;
non-owning tests return without writing, and a focused test pins that a shared symlink is not owned.
Read-only assertions intentionally inspect the guard that the current `.bin` resolves to.

**Fix / convention.** Either run `npm ci` in the worktree, or accept the symlink and know that
the compiler and dependencies come from its parent. If replacing a shared link with a local install,
remove the symlink itself first; do not let an install command mutate its target. The guard test's
writing cases are now owner-aware:

```
ls -l node_modules/.bin/tsc | awk '{print $NF}'     # a relative path means it escapes
```

`docs/ORCHESTRATION.md`'s "Worktrees" section documents the missing-dependency behavior: Node walks
up to the parent for `tsc`/`vitest`, while Vite does not. The previous attribution to `AGENTS.md`
was stale. Keep the distinction clear: parent toolchain/dependencies do not by themselves change the
child process working directory.

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

Moving them does **not** break `curated.mjs`: its nine `ref:` values are plain strings passed
through inventory assembly; no code resolves those refs against the filesystem. The current
`worktree-inventory.test.mjs` assertion checks only that a curated issue has a truthy `ref`, so it
would not catch a stale path. The actual path-existence gate is in `agents-citations.test.mjs`, which
derives exclusions from `docs/README.md`'s "Not maintained here" table and requires those paths to
remain tracked Markdown files. `docs-index.test.mjs` also requires every tracked Markdown file to be
accounted for in the index; updating the table to the archived path satisfies that lookup. Updating
`curated.mjs` refs is not required by those tests, but would keep the provenance links useful to
humans. Other prose references must be updated as part of any move.

The obsolete-file banners and references were rechecked. `TEST_ISSUES.md` says not to add to it;
`docs/next-target-useLayer.md` says not to work from it; `docs/save-settings-inconsistency.md` says
the plan is resolved/obsolete and its current status is also `Resolved` (the previous claim that it
headed a `Status: Open` section is stale). The inventory of cross-references should be re-derived
before a migration; the prior exact occurrence count is not treated as current evidence. The earlier
claim that `.skills/` contains no references was based on a search and should be repeated if the move
is undertaken.

These reports carry supersession/resolution signals, but deletion or archival is still a separate
repository-wide documentation migration. Do not delete them based only on this entry: enumerate and
update all cross-references, update the documentation index, then run the documentation citation and
index tests. `curated.mjs` refs are provenance strings, not the filesystem gate.

**Next step.** If archival is authorized, update `docs/README.md`'s "Not maintained here" table to
the new tracked paths (this is the filesystem gate), update human-readable `curated.mjs` refs and
all remaining prose references, and remove rows for any deleted files. Re-derive the reference list
from the tracked tree before editing. Verify with the relevant `agents-citations.test.mjs` and
`docs-index.test.mjs` tests; the truthiness assertion in `worktree-inventory.test.mjs` does not
validate ref paths. No archive/delete operation is performed by this audit.

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
inverted. The `mode` choice is isolated as `SPONGE_MODE_DEFAULT` and `sponge.test.ts` pins that
constant to `desaturate`. `vibrance` is currently a literal `true` in `defaultSettings`; the processor
tests exercise both vibrance values but do not pin the application default. Do not describe that
literal as a documented or test-confirmed Photoshop default. If the defaults cannot be
confirmed, the alternative is to stop asserting either: render the `Mode` select unseeded and refuse
the commit until the user chooses, which is worse and is not recommended.

**Files.** `src/tools/settings.ts` — the `sponge` entry in `defaultSettings`; `src/tools/sponge.ts` —
`SPONGE_MODE_DEFAULT` and `SPONGE_FLOW_DEFAULT`;
`src/tools/descriptions/focus.ts` §sponge `appNotes`;
`src/tools/descriptions/focus.notes.md` §Sponge Tool and items 15-16

## 147. The app has no document colour modes, so every Photoshop rule scoped to one is unimplementable

**Problem.** Adobe scopes behaviour to `Image > Mode` in several places, and this app has no such
document property or menu surface. `grayscale` appears in source as a per-layer CSS filter amount,
filter-builder and capability-probe implementation, the Color options slider, PSD import warnings,
Sponge logic/prose, and disabled adjustment-menu labels; these are not a persisted document color
mode. `StoreData`, `Layer`, `NewDocumentBlankParams`, and `NewImageDialog` carry no mode field or
selector. The PSD loader reads the imported file's mode to issue a warning, but does not retain that
source metadata in the app's document state.

The Sponge is the case that surfaced it. Adobe: "When an image is in Grayscale mode, the tool
increases or decreases contrast by moving gray levels away from or toward the middle gray"
(<https://helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html>), and Photoshop
Elements splits the direction — "In grayscale, Saturate increases contrast … In grayscale,
Desaturate decreases contrast" (<https://helpx.adobe.com/photoshop-elements/using/adjusting-color-saturation-hue-vibrance.html>).
That rule is **deliberately not implemented** (`SPONGE_MIDDLE_GREY`, in `src/tools/sponge.ts`), and
the limitation is structural: on an ordinary achromatic RGB pixel, the chroma scale is an exact no-op.
But imported grayscale PSDs are expanded to RGB while their source mode is discarded, so this does
not mean the Photoshop rule is irrelevant to those pixels — the app cannot distinguish them from
ordinary RGB gray. Do not apply a tonal pivot to every achromatic RGB pixel; resolving the imported
case requires preserving or otherwise supplying the document-mode distinction.

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

**There is a lint-compliant alternative, but it is not a settled fix.** The codebase already uses
`useState` setters as callback refs (`SidebarLeft` for the rail element, `ToolTooltip` for its
anchor). A stable callback ref could compare the store snapshot before/after `store.attach()` and
force an update when measurement changed. That update would run from a ref callback, not an effect,
so it avoids `set-state-in-effect`; it also avoids reading a mutable `ref.current`. However, it relies
on React processing that ref-triggered update before paint, and there is no meaningful test oracle:
the existing browser test observes a fitted rail even without the fix because the browser never
paints the transient tree.

**What would close it.** A decision, and this entry is the finding rather than the decision: choose
between the callback-ref update (small but timing-dependent and not regression-testable), a
CSS-driven fit (`@container` queries or CSS overflow arithmetic, the structural solution but a
subsystem rewrite), or an explicit `OVERRIDES.md` exception for the effect rule. Do not treat the
callback-ref alternative as already approved merely because the lint rule permits it.

**Why there is no test.** A pin that could not fail was written, measured, and removed: the
`MutationObserver` assertion above passes identically with and without the fix, because the browser
never paints the unrefitted tree here. `e2e/toolbar-fit.spec.ts` deliberately has **no** test for
this, and that absence is the honest state — if one is added it must be able to go red when the
scheduling changes, or it is a tripwire for a defect that cannot occur.

**Files.** `src/components/SidebarLeft/use-toolbar-overflow.ts`,
`src/components/SidebarLeft/SidebarLeft.tsx` — `twoColumnEntries` and the rail-element callback ref;
`src/components/Common/ToolTooltip.tsx` — the callback-ref pattern;
`react-dom` `mountSyncExternalStore` (a **passive** `mountEffect`, and a consistency check that only
runs on a concurrent render that yielded — neither is a pre-paint refit).

---

## 152. Canvas input lacks a stylus and gesture policy; options sliders have narrow touch targets

**Problem.** Canvas tools do not distinguish pen from touch, consume stylus pressure, or support
pinch-zoom and two-finger pan. The Draw, Levels, Smudge, and Transform options sliders expose only
4–6px tracks and have no larger touch target. These gaps affect tablet input and remain separate
from the layer list's implemented pointer-based touch reorder path.

**Evidence.** `LayersTab.tsx` uses `pointerType` for touch reordering, and `usePointerPosition` now
stores and returns `pointerTypeRef`, but no canvas tool consumes it for filtering. No tool processor
consumes pointer pressure. The named options components still use small native range tracks and no
shared `TouchSlider` wrapper. `docs/FEATURES.md` records pinch-zoom and two-finger pan as absent.
Touch E2E coverage is not zero (`layers.spec.ts`, `text-edit.spec.ts`, `canvas-growth.spec.ts` opt in
per test), but the suite has no dedicated touch project or shared slider-target contract.

**Next work.** Decide how canvas tools should handle pen, touch, and pressure before adding palm
rejection; add touch gestures for canvas zoom and pan; and design a larger target for range controls
without changing their visual thickness. Do not claim the native sliders are frozen by the canvas
`touch-action` ancestor without a reproducer; desktop options live outside that canvas boundary and
the mobile tool sheet permits panning. Keep this work within the desktop and tablet/touch product
boundary.

**Files.** `src/hooks/usePointerPosition.ts`, canvas tool input handlers and processors,
`src/components/SidebarRight/LayersTab.tsx`, `src/components/Mobile/MobileLayersDrawer.tsx`,
`src/components/ToolbarsRight/Draw/Draw.tsx`, `src/components/ToolbarsRight/Levels/Levels.tsx`,
`src/components/ToolbarsRight/Smudge/Smudge.tsx`, `src/components/ToolbarsRight/Transform/Transform.tsx`,
and the three test-scoped touch E2E specs.

---

## 153. The main-worktree guard runs after the edit, so a subagent fan-out rooted in main is still unstopped

**Problem.** `docs/ORCHESTRATION.md`'s "Worktrees" section states the rule — tracked-file changes
happen in a worktree, main is for reading and merging — and the commit path is now a program. The
write path is not, and that asymmetry is the defect.

`scripts/main-worktree-guard.mjs` runs first in `.husky/pre-commit` — the bare
`node scripts/main-worktree-guard.mjs` line — and refuses a commit made from the main worktree
(override `ALLOW_MAIN_COMMIT=1`, honoured only on an exact `1` by `decide()`), pinned by
`scripts/__tests__/main-worktree-guard.test.mjs`'s first describe, which tests the refusal/override
decision. The final describe, "the guard is actually installed", pins installation, not the refusal
policy. The guard states its own limit in the header block headed "WHAT IT DOES NOT DO, because the
limit is load-bearing":

> It runs AFTER the edit, not before it. A session that writes into the main worktree and never
> commits is not stopped here; its files are still uncommitted, and they are still in a checkout
> every other session is reading. … Closing the write side is a process fix, not a program.

`docs/ORCHESTRATION.md`, under "The rule is enforced at the commit, not by the reader", says the
same thing: "What it does **not** do is stop the write … the write side is the process rule above,
and the guard is the floor under it."

**Nothing fills the gap.** A `task` subagent inherits the calling session's working directory, so a
fan-out rooted in a main-rooted chat is mechanically a write into `main`, and `main` is where many
root chats sit. `AGENTS.md` gives the worktree-only process rule, but no runtime mechanism provisions
the worktree before editing or blocks a root-rooted local session. Two root-level defaults would close
it, and neither exists:

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
is that `kilo.jsonc`'s `permission` block contains several path-based denies (including Playwright/
report opening, direct `npx tsc`, and destructive Git operations) but no working-directory term or
lifecycle hook. These path rules cannot distinguish an edit in `main` from the same path in a task
worktree.

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

## 160. Dark-theme accessibility scans are in place; axe incomplete candidates still need review

The shared e2e fixture pins light because the pixel-analysis helpers rely on the light workspace
backdrop. `e2e/accessibility.spec.ts` releases that pin, reloads, and audits the shell, New Image
dialog, unsaved-changes prompt, Draw options bar, and tablet flyout in both themes. The current ten
scans report zero confirmed axe violations.

**Manual-review boundary.** Axe's `incomplete` bucket contains cases it could not decide; it is not
evidence of a violation. `expectNoViolations()` attaches the full result, including target selectors,
and logs candidate rule counts; only confirmed `violations` fail the suite. The shell and tablet-flyout
runs include incomplete `color-contrast` and `label-content-name-mismatch` candidates. Do not assert
the whole bucket empty or attribute a candidate to a particular target without reviewing the attached
result.

The collapsed dock glyph's measured foreground/background ratios are 6.10:1 in light and 7.00:1
in dark, above WCAG AA's 4.5:1 requirement for normal text. Its `incomplete` target and reason have
not been revalidated after the color fix; do not assume a generic incomplete result belongs to this
glyph.

**Next work.** Review the attached candidates individually, then add deterministic assertions or
fixes for confirmed issues. Preserve the distinction between confirmed violations and axe's
human-review bucket. Other overlays and responsive states remain outside the current audit.

**Files.** `e2e/accessibility.spec.ts` — the scoped scans and `expectNoViolations()`;
`e2e/fixtures/extended-test.ts` — `pinnedTheme` and `useAppDefaultTheme()`;
`src/components/SidebarRight/PanelGroup.tsx` — the collapsed dock glyph.

---

## 164. Centered 1px strokes can antialias across rows; Photoshop pixel-grid parity is unproven

`src/tools/shape.ts` — `setShapeCtx()`, `src/tools/draw.ts` — `setupDrawCtx()`, `src/util/draw.ts` —
`drawPen()`

Neither context setup contains a half-pixel offset, a coordinate snap, or any `Math.round` on a
point. `setShapeCtx` (`shape.ts`) sets `strokeStyle`, `fillStyle`, `lineWidth`,
`lineCap`, `globalAlpha` and `setLineDash` and nothing else; `setupDrawCtx` (`tools/draw.ts`)
adds `globalCompositeOperation`, `lineJoin` and `lineCap`. Canvas centers a stroke on its path, so
a 1px horizontal stroke at an integer y spans `y ± 0.5` and can distribute coverage across adjacent
pixel rows. MDN's Canvas `lineWidth` example documents this position-dependent antialiasing for odd
widths (<https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Applying_styles_and_colors#a_linewidth_example>).
The current tests cited below do not pin the resulting pixels for integer and half-integer path
positions, so the exact alpha pattern has not been measured here.

**This is not yet a Photoshop parity finding.** Adobe's shape documentation describes stroke width,
alignment, and caps, but the reviewed sources do not establish automatic snapping for ordinary Draw
or shape strokes, nor guarantee that a centered 1px stroke becomes one fully covered pixel. There is
no entry in `docs/OVERRIDES.md`; do not add global half-pixel offsets or coordinate snapping as a
presumed Photoshop fix. The thickness slider reaches half-integers
(`step="0.5"` in `src/components/ToolbarsRight/Figures/Shape.tsx`), and snapping only some
axis-aligned strokes would change document pixels without defining behavior for fractional widths
or diagonals.

**Safe next step: characterize before deciding.** Add raster-level tests for the real Canvas path at
integer and half-integer positions, including a diagonal control, and assert coverage/alpha. A
Photoshop-parity claim requires a reproducible comparison against Photoshop's default behavior; any
pixel-changing alignment policy also requires review of the export visual-regression gate and its
baseline prohibition.

**Coverage.** `draw.test.ts` checks path calls rather than exact pixel coverage; shape tests do not
provide an integer/half-integer 1px raster oracle; `e2e/pen-types.spec.ts` tests stroke categories,
not pixel rows. The export visual-regression fixture uses a 10px Draw stroke and is not an oracle for
1px coverage. Any alignment change alters committed pixels and must not be hidden by re-recording
that baseline.

**Files.** `src/tools/shape.ts` (`setShapeCtx()`), `src/tools/draw.ts` (`setupDrawCtx()`),
`src/util/draw.ts` (`drawPen()`), `src/components/ToolbarsRight/Figures/Shape.tsx` (the thickness
slider's `step`), `e2e/export/visual-regression.spec.ts`

---

---

## 167. The `Edit ▸ Transform` submenu is missing and its commands span distinct preview, range and geometry constraints

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

Adobe also documents **`Again`** under "Repeat a transformation": choose `Edit > Transform > Again`.
This is a twelfth command in addition to the eleven listed above, confirmed by Adobe's
`apply-transformations.html` documentation. It still requires retaining/replaying the last transform;
the app has no such repeat-transform state.

**The preview constraint is shared, but the submenu is not blocked by only two uniform constraints.**

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
   args and stops there moves the options bar and nothing else. This common preview gap affects
   commands that would only preset args, but it is not the only constraint. **`Warp` is a separate
   geometry gap**: it is a grid deformation, and `TransformToolArgs` has no warp member. `resetArgs`
   (the `const resetArgs: TransformToolArgs` in `Transform.tsx`) is `rotate` / `mirrorH` / `mirrorV` /
   `skewX` / `skewY` / `trapezoid` /
   `resizeX` / `resizeY` and nothing more.

   **Distort and Perspective have an additional computational gap.**
   `transformToolArgsToAffine()` produces an affine transform; Adobe's independent-corner/projective
   transforms need homography state that the current args do not represent. The existing trapezoid
   raster path handles a specific taper only, not arbitrary corner movement. Do not present these
   menu items as simple presets until projective geometry and its preview/commit contract exist.

2. **Wrapped rotations are outside the rotate slider's range.** The slider is `min={-90}` `max={90}`
   (the `#rotate-slider` range input in `Transform.tsx`). The bar's own `180°` button does not go
   through the slider — it writes
   `rotate: (rotate + 180) % 360` (the same `180°` button) — so a value the slider cannot represent is
   already reachable, and wrapped values from the 180° action or the ±90° buttons land the options bar
   in states its own control cannot display. `Scale` has the mirror problem: `resizeX`/`resizeY` are percentages, so
   Adobe's absolute Width/Height percentages need a document-size read the menu does not currently do.

**Fix.** Resolve the common transient-preview path, rotation-range/display behavior (including wrapped
values from the ±90° buttons), and absolute Width/Height units before adding menu items. Preserve the
transient-preview contract so slider/menu changes do not write one history entry per frame. Treat Warp,
Distort, Perspective, and Again as separate model/state requirements: grid deformation, projective
corner geometry, and repeat-last-transform state are not available in the current affine args. These
are product/architecture decisions, not twelve equivalent one-line menu items.

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

## 181. The orphan report does not establish branch disposition

**Problem.** `npm run branches:orphan` reports local branches without worktrees using reachability,
ahead/behind, and merge-conflict information. A non-ancestor branch can still be patch-equivalent
because its changes were cherry-picked, and a zero cherry-patch count can still hide a distinct
merge result.

`WORKTREES.json` now includes branch-only refs with ancestry and `git cherry` observations:
`ancestor`, `unmatched-patches`, `zero-cherry-patches`, or `unknown`. These labels make the missing
refs visible, but do not establish ownership, provenance, final-tree equivalence, merge intent, or
a recover/retire decision. `git cherry` compares non-merge commit patches and omits merge commits;
zero unmatched patches are not proof that the branch tree matches `main`.

**What remains.** For non-ancestor refs, inspect the commit parents, `git diff main <branch>`,
changed files, and relevant transcripts before deciding what to do. Treat unknown comparisons and
branches without a current owner as unproven. Neither the inventory nor `branches:orphan` may merge
or retire a branch automatically.

## 182. At-risk work has no explicit operator disposition for "reviewed, keep nothing"

**The landed-branch half is fixed.** The inventory now computes `patchEquivalence` for commits whose
patches may already be on the base and `mergeResultMatchesBase` for a clean merge that produces the
exact base tree. `classify.mjs` can classify a clean absorbed/no-op branch as disposable, and
`dispose-worktree.mjs` anchors its tip before the guarded branch deletion. The inventory and disposal
tests cover both cases. The old claim that `fix/vacuous-assertions` and `fix/blind-gates` are still
refused solely because their commits are non-ancestors is stale.

**The remaining gap is the operator's "keep nothing" decision.** The historical `fix/unit-tests` case
was recorded as `at-risk` even though a review found no unique content worth landing. The branch's
current ref/content state must be rechecked before any action; this entry does not authorize disposal.
What remains true is that `at-risk` requires preservation or human review, and there is no supported
operator disposition that records "reviewed; retire without preserving work." The current
`mustNotPrune` flag is a veto, not that disposition.

**Do not add a force bypass.** `dispose-worktree.mjs` intentionally refuses `--force`, and the
inventory's owner/liveness and dirty-work checks must remain. A future reviewed-retirement path needs
an explicit operator-authenticated disposition, a fresh-inventory check, and tests proving that live,
unreviewed, or unique work remains protected. This is a policy/safety design, not a correction to the
already-landed patch-equivalence logic.

**Files.** `scripts/lib/worktree-inventory/git.mjs` — `patchEquivalence` and merge-tree comparison;
`scripts/lib/worktree-inventory/classify.mjs`; `scripts/dispose-worktree.mjs`;
`scripts/__tests__/worktree-inventory.test.mjs`; `scripts/__tests__/dispose-worktree.test.mjs`.

## 193. A paragraph box whose type outgrows the document commits the overflow as cropped pixels

**Problem.** `calculateNewRect`'s paragraph arm returns `trimRect2(newRect, imageSize)`, so every
edge of a paragraph box is clamped into the document. That clamp is what makes Adobe's overflow icon
reachable — the icon reports the lines against the box's height, and a box that could grow past the
document's bottom edge could never outgrow its own height — and `e2e/text-tool.spec.ts` pins it.

The consequence is that a paragraph box whose content needs more height than remains in the document is
clamped at the document edge, and lines beyond the clamped `y2` are cropped rather than retained past
the edge. The layer canvas is sized from the resulting `pos` (`createLayerFromTool` and
`createLayerSource`), and `renderTextInto` lays out against that bounded height; drawing beyond the
OffscreenCanvas is clipped. A point box follows a different path: it clamps its origin and lets its
extent grow with the content, so ink beyond the document edge remains in the layer raster.

**Coverage gap.** `e2e/text-tool.spec.ts` tests the draft overflow icon, but its fixture leaves 40px of
document space below the paragraph box, so the document-edge clamp is not exercised. It checks that the
icon is not baked into the layer, not that overflow text is retained. The inspected `rect.test.ts`
paragraph cases also keep their boxes away from the document edge; there is no unit or E2E assertion for
the clamped-commit case.

**What would close it.** This is a product/serialization decision, not a local renderer tweak:

- Let the paragraph box grow past the document's bottom edge. Closes the crop, and makes the
  overflow icon unreachable — a box that always grows to fit cannot overflow — which deletes a
  shipped Photoshop feature and its e2e.
- Keep the clamp and disable Apply while the draft overflows. Keeps the icon, costs the user a
  control they cannot use until they make room, and invents a gate Adobe does not document.
- Report the overflow against the box the user DRAGGED rather than the grown one, so the icon
  survives a growing box. `renderText` is handed only the final rect and has no knowledge of the
  drag, so `calculateNewRect`'s return type would have to carry it.
- Separate the text layout/drawing extent from the boundary used for the overflow indicator, and
  preserve both through the committed layer representation. This may retain content while keeping the
  icon, but requires tracing serialization and later edit behavior; it is not established as a safe
  fix by the current audit.

**Provenance.** Found by review of the Type tool against its own requirements document, not by a
failing test. An independent code-path audit confirms the clamp reaches the commit canvas, while the
existing E2E fixture does not reach that boundary. Adobe's exact document-edge/overflow behavior was
not independently verified in this pass; see the cited Adobe type documentation in the tool notes.

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

The W3C Filter Effects Level 1 definition confirms CSS `brightness()` is a linear multiplier and
defines `contrast()` as a constrained transfer function; neither expresses an arbitrary channel LUT
(<https://www.w3.org/TR/filter-effects-1/#brightnessEquivalent>,
<https://www.w3.org/TR/filter-effects-1/#contrastEquivalent>). This is a CSS capability boundary,
not evidence for Adobe's exact curve.

**Affected.** `src/tools/functions.ts` — `buildLevelsFilter()` and `proportionateFactor()`; the boundary
is stated on `buildLevelsFilter()`'s doc comment and in `src/tools/descriptions/transform.notes.md`, which
`npm run docs:tools` carries into `docs/TOOLS.md`.

**What would close it.** A per-channel lookup table applied per pixel, which is the same mechanism
`docs/TOOLS-TOO-HARD.md` records as absent for Adobe's real Levels — a CSS filter string cannot express an
arbitrary LUT. This is a new durable operation, not an edit to `ctx.filter`: preview rendering,
materialization, replay, and the `apply-filter`/`apply-raster-processor` history distinction must all
agree on the LUT representation. `pixels.ts` helpers used by raster processors do not supply that
operation contract. Whoever takes it should re-derive the curve from Photoshop measurements rather than
from this entry, because the entry's contribution is the boundary and not the shape.

**Provenance.** Fixed 2026-10-04 on `fix/levels-proportionate-curve`: the proportionate curve, Adobe's
travels, the non-clipping negative half and the exact-black `brightness(0%)` endpoint all landed there.
This entry is only the part that did not.

## 216. Board claims have owner release, but active liveness still blocks full disposal

**Partial release already exists.** The board API and CLI let the holder release their own claims via
`npm run swarm -- release <issue>` and their own file locks via `npm run swarm -- unlock <files>`,
without `--force`; the board checks `agent_id` against the caller identity and records an audit event.
After release, `collectOwnership()` no longer sees those board-claim/lock rows.

**Full disposal remains blocked by other live signals.** `preflight()` still refuses live board agents,
recent live sessions, and inventory-derived live-writer evidence, even after board claims/locks are
released. `collectOwnership()` and `preflight()` do not resolve the caller identity. The agents table
has no explicit release timestamp, the session query does not map its runtime agent field to the
branch identity, and inventory write-history has no release watermark. Thus board release is not a
complete self-disposal path; the remaining signals age out under their existing windows.

No `--force` bypass exists on disposal — a dirty tree is a finding, not something to override — and
`--max-age-minutes` is ceiling-clamped to the inventory-freshness window. The board's `--force`
option applies to releasing another holder's claim/lock, not to deleting a worktree.

Measured over the program's own refusal line: **24 sessions on 2026-10-01 and 2026-10-02, 35 to
date.** Each escalated to the operator; each left landed, inert branches behind.

**Affected.** `scripts/dispose-worktree.mjs` — `collectOwnership()` and `preflight()`; the board
`releaseClaim`/`releaseFiles` APIs; session liveness and inventory `derivedLive` computation.

**What would close the remaining gap.** A separately authenticated owner disposition must account
for board agents, live sessions, and inventory-derived writers, record who released which signal and
when, and be distinguishable in `WORKTREES.json` from an operator override. A board claim release
alone does not satisfy this. Do not bypass recent I/O, active sessions, dirty-tree, or operation-state
checks with a disposal force flag. Landing continues to release branch-owned board claims/locks;
the remaining case is finished work that will not be landed or has been folded into another branch.

## 218. Legacy citations and structured source references can evade semantic validation

**Problem.** The maintained-document scan is already permanent: `lineNumberCitationsByDocument`
checks the named gated set, and `ungatedDocumentsWithLineNumbers(readMaintainedDocuments())` rejects
citations in every other maintained document. The prior claim that a clean document could regress
silently was incorrect.

Two gaps remain. First, historical prose in tracked Markdown excluded from the maintained-document
scan is not migrated by the new-citation guard; point-in-time reports retain legacy citations, and
`docs/OVERRIDES.md` is operator-owned. Second, `tool-descriptions.test.mjs` checks that structured
`appRef`/`implementationRefs` paths exist and lines are in range, but cannot detect a valid line that
points to unrelated code. Citation-like text inside description string literals is also not a comment
for the source scanner to validate.

Human-written source/configuration/markup comments follow the same ban. Structured `implementationRefs` in tool-description
data are separate machine-readable metadata and require a separate migration decision.

The read-only resolver sweep returned 85 unresolved citations across five documents and 23 target
files; this is an audit worklist, not proof that every reference is stale. Direct source checks also
found seven View `appRef`s all pointing to the import line, a Blur default-setting/processor/fallback
reference mismatch, six Pen placeholder references pointing at a blank line instead of the dummy
fallback, and rectangular-selection prose whose line references had shifted. Those high-confidence
source metadata errors were corrected in the tool descriptions, and `npm run docs:tools` regenerated
generated output. The description citation tests, lint, and typecheck pass. Do not edit
`docs/TOOLS.md` except through its generator.

**Affected.** `scripts/__tests__/agents-citations.test.mjs` — `DOCUMENTS_NOT_CHECKED` and the
maintained-document citation legs; `scripts/check-new-line-citations.mjs` — the pre-commit guard;
`scripts/resolve-citations.mjs` — the historical Markdown sweep; `scripts/__tests__/tool-descriptions.test.mjs`
— structured reference validation; `src/tools/descriptions/*.ts` — source metadata and prose;
`docs/README.md` — the point-in-time document index.

**What would close it.** Triage the resolver's unresolved list, then replace stale historical line
citations with stable identifiers where the document remains maintained; leave operator-owned
`docs/OVERRIDES.md` to its owner. Decide separately whether structured `implementationRefs` should
migrate to symbol anchors or remain line-based with a stronger semantic review policy. Keep generated
`docs/TOOLS.md` under its generator and rerun the description/citation tests after source metadata
changes.

## 219. Test resource isolation has no repository-wide write-boundary guard

**Problem.** The e2e-run suite now has checks for its own resource boundaries: it exercises
`reservePort`, gives the runner a temporary board with `AGENT_BOARD_DIR`, sends each run record to
a temporary path, and reads the live worktree record only as a tripwire. Those checks are local to
that suite. No repository-wide rule prevents another test from writing a path owned by a concurrent
process, and no derived inventory of tests that write shared paths exists.

`node_modules` resolution, `.kilo/e2e-last-run.json`, the e2e queue sentinel, and the board database
can all be shared across tests or worktrees. The suite-budgets inventory derives process-spawning
tests only; it does not discover file writes or establish an allowlist for them.

A read-only audit found concrete cases with different risk shapes: the tsc-guard installer tests
write `.bin/tsc` only when their real-path ownership check passes, while a wrapper hides the child
process's repository `cwd`; `dispose-worktree.test.mjs` creates a module-level fixed temp-directory
name with no cleanup, which can collide across concurrent runs; and the merge-takeover guard test
changes `PATH`/`REAL_GIT_PATH`, which is shared process state rather than a filesystem write.
Intentional machine-shared reads, including the session DB with `readOnly: true`, must remain allowed.

**Affected.** `scripts/__tests__/e2e-run.test.mjs`; `scripts/lib/**` for the shared-path helpers;
the wider `scripts/__tests__` tree; `node_modules` resolution, `.kilo/e2e-last-run.json`, the e2e
queue sentinel, `board.db`.

**What would close it.** A bounded, derived static audit over script tests that flags recognized
filesystem write APIs and write-capable subprocess/shell patterns, with explicit narrow
classification for temporary fixtures and intentional shared reads. Fail or require review for
unclassified write-shaped patterns, and derive the scan set from the test tree. Such an audit is a
heuristic, not runtime containment: it cannot prove destinations of dynamic paths, imported helper
writes, native modules, or child processes, and it must not claim to enforce that every actual write
is inside a per-test temp directory. Keep shared-read and `PATH`-mutation classification explicit;
they are different boundary types.

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
