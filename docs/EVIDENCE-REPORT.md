# Evidence report — tool-research-hardening docs pass

## Headings changed

**TOOLS-RESEARCH-BRIEF.md**

- `## The code half, and why it is not optional`: `implementationRefs` guidance changed from `file:line` citations to declared identifiers (function/method call form, dispatched string literal, test title, or file alone). Line-number citations are now explicitly banned with a reference to `docs/DOCUMENTATION.md` §Citations. Status definitions (`present`, `partial`, `missing`, `inert`) are unchanged. This change is already present on current `main` via `8c99c969`.

**TOOLS-TOO-HARD.md**

- `## Revalidate before trusting any citation`: updated to require declared identifiers per `docs/DOCUMENTATION.md` §Citations, ban line-number citations, and replace the `sed -n '165p'` verification example with `grep -n`.
- `### Select and Mask, and the Select menu`: corrected the stale "no Select menu" claim to "Select menu exists, all items disabled", matching `DesktopHeader.tsx`.
- `### Select ▸ Modify, Inverse, Deselect, Grow and Quick Mask`: corrected the stale "no Select menu to host them" claim and removed the non-existent `menuHostRefs` reference, matching `DesktopHeader.tsx`.
- `### Crop: Straighten, Content-Aware and Generative Expand`: retained the valid `OVERRIDES.md`/`OVR-1` references after review confirmed that the file exists and records this operator decision.
- `### Layer opacity, and the paint model`: retained current main's newer desktop/mobile opacity-writer wording; the lost branch's proposed "no writer" correction is superseded by the current implementation.

## Re-checked claims

**Stale counts / status definitions**

- Status values (`present`, `partial`, `missing`, `inert`) are actively used in `src/tools/descriptions/types.ts` and every family module; definitions are not stale.
- The count arithmetic in `### The Adobe tools the rail omits` is consistent with `TOOLS-INVENTORY.md` and `HANDOFF.md` §74: `30 + 6 = 36` absent tools against §74's stated `34 to add`. The discrepancy is explicitly flagged as unresolved in both documents.

**Durable replay / tool-boundary claims**

- `PROMOTE_LAYER_PRESENTATIONS` exists in `src/contexts/StoreContext.tsx`; the presentation-boundary claim is accurate.
- `HistoryItem[]` as production replay authority matches `AGENTS.md` "Architecture status".
- `toolProcessors.ts` commit kinds (`document-operation`, `raster`, `unimplemented`) and the `Selection` type in `general-types.ts` are consistent with the tool-boundary arguments in the Crop, Select and Mask, and Pen entries.
- The lifecycle rule "fixed and verified DELETES the entry" matches `docs/DOCUMENTATION.md` §Lifecycle.

## Unresolved issues

1. **Roster count discrepancy**: `30 + 6 = 36` absent tools vs `HANDOFF.md` §74's `34 to add`. Left unresolved per `TOOLS-INVENTORY.md` policy.
2. **Content-Aware Move**: sourced only from `HANDOFF.md` §74; no Adobe page was opened for this row. `TOOLS-INVENTORY.md` flags it explicitly.
3. **Adjustment-layer schema**: whether `Image ▸ Adjustments` bakes pixels or creates adjustment layers is unanswered and carried by `HANDOFF.md` §172.

## Verification

- No `file:line` citations remain in either edited file.
- No `sed -n`, `head -n`, or `tail -n` commands remain.
- The valid `OVERRIDES.md`/`OVR-1` references remain in `TOOLS-TOO-HARD.md`.
- No `menuHostRefs` references remain in `TOOLS-TOO-HARD.md`.
- All documentation edits are saved on disk. No source code was modified by this pass. The original
  documentation pass performed no Git operations before this salvage commit.
