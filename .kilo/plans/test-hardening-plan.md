# History Migration Test Hardening Plan

## Context

The history migration is **already implemented and merged to `main`** with four slices:

1. **Durable text source editing/replay** (`history-adapter.ts`, `durable-replay.ts`, `durable-compositor.ts`)
2. **History-panel durable projection with provenance** (`history-adapter.ts`, `HistoryTab.tsx`)
3. **Durable options-bar hydration** (`useCurrentTool.tsx`, `StoreContext.tsx`)
4. **Browser authority seam with parity coverage** (`StoreContext.tsx`, `history-migration.pixel-parity.test.ts`)

**Validation status** (from isolated worktree):

- Focused migration tests: **29 passing**
- `npm run tsc`: **passing**

---

## Existing Test Coverage (on `main`)

| Test File                                 | Scope                                                                                | Test Count         | Status     |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------ | ---------- |
| `durable-replay.invariants.test.ts`       | Replay immutability, cursor bounds, disabled entries, clone isolation                | 21                 | ✅ Passing |
| `durable-replay.source-edit.test.ts`      | `replace-layer-source` semantics, text/vector sources, cursor revert, disabled skip  | 12                 | ✅ Passing |
| `durable-replay.test.ts`                  | Adapter normalization, mixed transform rejection, disabled exclusion, frame handling | 8                  | ✅ Passing |
| `durable-replay.publication.test.ts`      | Revision identity, frame computation, cursor clamping, missing-layer no-ops          | 22                 | ✅ Passing |
| `durable-replay.layer-operations.test.ts` | Layer CRUD, show/hide/rename/reorder/reposition, affine, selection, frame, merge     | 24                 | ✅ Passing |
| `history-migration.pixel-parity.test.ts`  | Runtime/export byte parity across 13 scenarios × all cursors                         | 13 matrix + 4 pins | ✅ Passing |

**Total: ~100 unit tests + pixel parity matrix**

---

## Identified Hardening Gaps

### 1. Options Hydration / Preview Protection (Nemotron Task 1)

**Gap**: No tests verify that:

- Durable active-layer source arguments hydrate the options bar correctly
- Active in-flight preview is **never overwritten** by durable hydration
- Saved settings (`lastSavedSettings`) serve as fallback when durable source unavailable
- Hydration precedence: durable source > saved settings > defaults

**Target Files**: `useCurrentTool.tsx`, `StoreContext.tsx` (options-bar hydration path)

**Required Tests**:

- Hydration from durable text source args (font, size, color)
- Hydration from durable vector source args (shape, color, stroke)
- Preview protection: in-flight text edit not clobbered by hydration
- Fallback chain when durable source is `legacy-tool` or missing
- Hydration timing: after navigation, after undo/redo, after history panel click

### 2. History Provenance Parity (Nemotron Task 2)

**Gap**: No tests verify that durable history entries carry sufficient provenance to derive **exact legacy labels** for:

- `RENAME_LAYER_ACTION` → "Rename layer"
- `SHOW_LAYER_ACTION` / `HIDE_LAYER_ACTION` → "Show layer" / "Hide layer"
- `REORDER_ACTION` → "Reorder layers"
- `SET_DOCUMENT_FRAME_ACTION` → "Crop document"
- `MERGE_ACTION` → "Merge layers"
- `NEW_LAYER_ACTION` → "New layer"
- `REMOVE_ACTION` → "Delete layer"
- `SELECTION_ACTION` → "Select"

**Target Files**: `history-adapter.ts` (entry provenance), `useHistory.ts` (`getHistoryItemTitle`)

**Required Tests**:

- Every legacy action name maps to correct durable operation + provenance
- Provenance survives `freezeDurableDocument`, `cloneDurableDocument`, `appendDurableEntry`
- History panel renders identical labels from durable projection vs legacy
- Missing provenance falls back gracefully (does not crash panel)

### 3. Text Source-Edit Append/Replay / Malformed Input / Redo Bitmap Retention (Nemotron Task 3)

**Gap**: `durable-replay.source-edit.test.ts` covers happy path but missing:

- **Append path**: `appendDurableEntry` with `replace-layer-source` creates valid history
- **Malformed input refusal**: invalid text args, missing layer, corrupt source rejected with diagnostics
- **Redo bitmap retention**: after undo + redo, retained operations reapply to new source bitmap
- **Multi-edit sequence**: multiple `replace-layer-source` at different cursors replay correctly
- **Disabled entry in middle**: disabled source-edit skipped, adjacent entries replay correctly

**Target Files**: `history-adapter.ts` (append/validation), `durable-replay.ts` (replay), `materialization.ts` (bitmap retention)

**Required Tests**:

- `appendDurableEntry` + `replace-layer-source` roundtrip
- Malformed `text` args (missing fontSize, invalid color) → diagnostic, no operation
- Undo to before edit, redo → bitmap from retained ops on new source
- Three consecutive retypes at cursors 0, 1, 2 → correct at each cursor
- Disabled source-edit between two enabled ones → both enabled replay, disabled skipped

---

## Additional Hardening Areas (Not Yet Assigned)

### 4. Durable Export Records Parity

**Gap**: `durableExportRecords()` exists only in `history-migration.pixel-parity.test.ts` as a test helper. Not yet promoted to production (`export-canvas.ts`).

**Required**: Promote to production with tests for hidden-layer metadata (no bitmap), frame/size invariants.

### 5. Materialization Failure Containment

**Gap**: Tests exist for processor crash lease release (`durable-replay.layer-operations.test.ts:742`), but missing:

- Affine bounds rejection (zero-size layer) lease behavior
- Missing asset lease behavior
- Composite-level refusal releases all leases exactly once

### 6. Cursor Mapping Edge Cases

**Gap**: `legacyCursorToDurableCursor` mapping tested implicitly but not:

- Multiple disabled entries in sequence
- Cursor at disabled entry → maps to previous enabled
- Empty history → cursor -1 mapping

### 7. Selection/Frame Replay Completeness

**Gap**: `SELECTION_ACTION` and `SET_DOCUMENT_FRAME_ACTION` have basic tests but missing:

- Multiple selection replace (not append)
- Frame operation disabled → frame stays baseline
- Frame + reposition interaction at same cursor

---

## Hardening Execution Plan

### Phase 1: Nemotron Agents (In Progress)

Three isolated worktrees, each with focused task:

| Agent      | Worktree                    | Focus                                           | Target Test Files                            |
| ---------- | --------------------------- | ----------------------------------------------- | -------------------------------------------- |
| Nemotron 1 | `laguna-options-hydration`  | Options hydration / preview protection          | New: `options-hydration.test.tsx`            |
| Nemotron 2 | `laguna-history-provenance` | History provenance parity                       | New: `history-provenance.test.ts`            |
| Nemotron 3 | `laguna-text-source-edit`   | Text source-edit append/replay, malformed, redo | Extend: `durable-replay.source-edit.test.ts` |

**Constraints**:

- Each agent: small focused task, single test file or extension
- Model: Nemotron 3 Ultra (high quality, slow)
- Max 2 concurrent (per constraint)
- No production code changes — tests only

### Phase 2: Promotion & Integration (After Phase 1)

| Task                                                 | Owner      | Target                                    |
| ---------------------------------------------------- | ---------- | ----------------------------------------- |
| Promote `durableExportRecords` to `export-canvas.ts` | Main agent | Production + test                         |
| Add materialization failure containment tests        | Main agent | `durable-replay.layer-operations.test.ts` |
| Add cursor mapping edge case tests                   | Main agent | `durable-replay.invariants.test.ts`       |
| Add selection/frame completeness tests               | Main agent | `durable-replay.layer-operations.test.ts` |

### Phase 3: Gate Validation

Before considering hardening complete:

- [ ] `npm run tsc` passes
- [ ] `npm run build` passes
- [ ] `npm run test` (unit) passes — all new tests green
- [ ] `npm run test:e2e` passes — no regressions
- [ ] Pixel parity matrix still 100% green (no new divergences)
- [ ] No `it.fails` pins added without measured reason

---

## Test Quality Standards

Per repository constraints:

1. **No weakening gates**: No skipped tests, raised thresholds, deleted assertions
2. **No flakiness tolerance**: Each test must be deterministic
3. **Exact assertions**: Byte equality for pixel tests, structural equality for replay
4. **No suppression**: `ACCEPTED_CONSOLE_ERRORS` only for reasoned, documented cases
5. **Real fixtures**: Use production creators (`createLayerSource`, `legacyHistoryToDurable`) not mocks
6. **Lease hygiene**: Every `AssetRegistry` created in test must be `shutdown()` in `finally`

---

## Deliverables

1. **Three new/extended test files** from Nemotron agents (Phase 1)
2. **Four promoted/extended test files** from main agent (Phase 2)
3. **This plan** committed to `.kilo/plans/test-hardening-plan.md`
4. **All changes merged to `main`** via isolated worktrees, one slice at a time

---

## Timeline Estimate

| Phase                 | Duration  | Notes                  |
| --------------------- | --------- | ---------------------- |
| Phase 1 (Nemotron)    | 2-4 hours | Parallel, slow model   |
| Phase 2 (Integration) | 1-2 hours | Sequential, fast model |
| Phase 3 (Gates)       | 30 min    | Automated              |

---

## Risk Mitigation

| Risk                      | Mitigation                                          |
| ------------------------- | --------------------------------------------------- |
| Nemotron timeout/slowness | Small task scope; can discard and re-delegate       |
| Test/production drift     | Tests use real production fixtures, not mocks       |
| Pixel parity regression   | Run parity matrix after each merge                  |
| Worktree conflicts        | One file per agent; no overlapping production edits |

---

## Commit Strategy

Each hardening deliverable:

1. Created in isolated worktree
2. Validated: `tsc`, `build`, `test` (unit), relevant parity tests
3. Committed with `Chat: ses_<id>` trailer
4. Merged to `main` with `Branch: <source-branch>` trailer
5. Worktree disposed via `npm run dispose`

**No batch merges** — each test file lands independently per sweep iteration workflow.
