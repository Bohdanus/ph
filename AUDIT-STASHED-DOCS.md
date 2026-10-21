# Audit of the abandoned stashed issue docs

Three issue documents were stashed and never recovered. Every issue in them was
verified against `main` at `446d7eb`, and the surviving ones were then fixed. This
file is the record: §1 is what is **still open**, §2 is what was fixed and by what.
Item numbers are stable identifiers and are not renumbered.

**Recovered from** `stash@{0}` (`WIP on main: 50bb2b8`, 2026-09-27 09:13). The
stashed `HANDOFF.md` is a 424-line predecessor of main's 1114-line file and is
**not** recovered — main's version supersedes it entirely.

| Recovered doc                                     | Disposition                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST_ISSUES.md` (355 lines)                      | 13 of 27 issues survived verification. All 13 fixed.                                                                                                                                                                      |
| `docs/save-settings-inconsistency.md` (139 lines) | **Entirely obsolete.** Fixed by `8736334`; `src/util/settings.ts` now has the `never` exhaustiveness sentinel it proposed as Solution C. One stale comment remained (item 28).                                            |
| `docs/next-target-useLayer.md` (261 lines)        | **Obsolete as a plan.** Its Priority A "THE RACE" is not real, and every Priority A-F area is now covered by six test files that did not exist when it was written. It walked past two production defects (items 12, 14). |

The chat that prompted this audit (`eb2160e`) is clean: its four claims are
`VERIFIED-FIXED`, `VERIFIED-FIXED`, `VERIFIED-FIXED` and `PARTIAL`. The `PARTIAL`
produced items 24-27 below.

---

## 1. Still open

### 1. `maybeCommitAutoAnchor`'s commit branch is never executed

`FeatherMagneticLassoToolArea.tsx` commits an auto-anchor segment, and the
70 ms frequency gate (`MIN_AUTO_ANCHOR_TIME_MS`) means no test ever gets past
it: the fixture sets `frequency: 1000` and nothing advances `Date.now`. So
`commitSegment` from the auto-anchor path is unexercised while every other commit
route is covered. A slow-drag case with `frequency` lowered below the segment path
length is the missing test.

### 2. `getHistoryItemTitle`'s tool-`layerSource` branch is unreachable from the fixture

`useHistory` branches on `layerSource?.kind === 'tool'`; the `HistoryTab`
fixture entry carries `TOOL_ACTION` with `args.toolName` and **no** `layerSource`, so
it takes the `actionName === TOOL_ACTION` branch instead. The mock
previously restated the whole title map, so neither path was under test; now that
the mock delegates to the real function, this is visible. Closing it means changing
`mockHistory`, which ripples through the index-based row assertions — left alone
rather than half-changed.

### 3. `updateLayer` has no direct test

`useLayer.ts` is reached only indirectly, via `toggleVisibility` and the
unknown-layer early return. Its `COMMIT_DOCUMENT_EDIT` history item construction is
unasserted.

### 4. The `Levels.test.tsx` preview test is vacuous

`does not call tempUpdateLayer when activeLayerId is null` fires a change and asserts
`not.toHaveBeenCalled()` **without flushing a frame**, so it passes against the
unfixed component too — it could never have caught the null-layer publish. The real
replacement is the frame-flushing test added alongside it. Delete this one; it is
duplicate weight, not coverage.

### 5. No shared test provider wrapper

`src/__tests__/fixtures/` is a real shared helper module, so the recovered doc's
"no shared test-helper module" claim was wrong. What is genuinely missing is a shared
**provider** wrapper: 22 test files construct their own `StoreProvider` and 73 still
`vi.mock` `StoreContext` themselves, and the `Main` tool-area suites import nothing
from `fixtures/`. That duplication is the live residue.

### 6. 55 hardcoded geometry literals pin `ShapeToolArea.test.tsx` to production math

Re-measured after `main` rewrote this file: 26 `start`/`end` object literals, 13 `pos`
bbox literals and 16 scalar coordinate `toBe`/`toBeCloseTo` assertions throughout the
file. They re-derive the behavior that `shapeGeometryBounds` and `normalizeShapeGeometry`
already assert generically. Fragile, and low value to fix.

### 7. `MIGRATION_NEXT_STEPS_SUNDAY.md` carried a fixed issue about toolbar-mapping.ts

It stated `toolbar-mapping.ts` is "type-checked only transitively" and prescribed
`"include": ["src", "toolbar-mapping.ts"]` plus a CI assertion. Both landed:
`tsconfig.app.json` and `ci.yml`. A fixed-issue entry that records what was wrong
and that the fix has landed — the section title is "Stale documentation — actively misleading".

### 8. The cutover gate names a function that no longer exists

The cutover gate formerly documented in `AGENTS.md` — "**DO NOT start single-writer cutover while
`saveLayerCanvas()` promotes cached canvases outside reducer publication.**" — has been
**removed from `AGENTS.md`** (the file is now 40 lines and carries no architecture gate).
The text survives only as a quoted historical artifact in
`MIGRATION_NEXT_STEPS_SUNDAY.md` §4.4, which itself notes it is false.
`saveLayerCanvas` appears nowhere under `src/` — `grep -rn saveLayerCanvas src` → 0 hits.
The gate is therefore undecidable: it blocks on the behaviour of an export that is not
in the tree, and a reader cannot tell whether the single-writer cutover is cleared or
not. The hazard it named was resolved by `2d654eb`, which moved cache promotion to
`PROMOTE_LAYER_PRESENTATIONS` (`StoreContext.tsx`) — a typed action the reducer applies.

### 9. 4-digit hex is still mis-parsed

`normalizeHex()` in `src/util/color.ts` expands a 3-digit value and returns anything
else unchanged, so `hexToRgb('#f00a')` still yields `240, 10, NaN` and
`isLightColor('#f00a')` is still `false` — the same failure the 3-digit case had. The
recovered doc scoped the defect to 3 digits and a `#rgba` / `#rrggbbaa` branch is a
wider change than an audit warrants. 8-digit hex happens to work, because the three
substrings land on the right channels.

---

## 2. Fixed by this audit

Each is verified by a test that fails without the change, and the full gate suite is
green on top of it.

| #   | Issue                                                                                                   | Fix                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10  | `Levels.tsx` published a preview for a nonexistent layer (`activeLayerId!`)                             | Guard inside the rAF callback; the `it.fails` in `Levels.test.tsx` inverted to a passing `it` in the same change, and `pendingUpdateRef` / `rafIdRef` now clear unconditionally so the next change re-arms a frame |
| 11  | Two Levels sliders changed in one frame lost the first change                                           | `throttledOnChange` merges onto `pendingUpdateRef.current ?? args` instead of the render snapshot, so a handler can no longer reintroduce it; new same-frame test                                                  |
| 12  | `removeLayer` threw after it had already committed                                                      | Now calls the already-guarded `clearOverlay`; the _passing_ tripwire that asserted the throw was inverted in the same change                                                                                       |
| 13  | `ellipsify` could emit a lone surrogate                                                                 | Cut on `Intl.Segmenter` clusters, matching `deleteCharAt` three functions above; 4 new cases incl. a boundary-exact budget                                                                                         |
| 14  | Apply committed a second identical text layer after a tool-switch commit                                | `commitDirtyTool` now clears through a new stable `SetToolArgsContext` instead of writing the ref directly, so there is one draft state; 3 new tests                                                               |
| 15  | `useDoubleClick` accepted a null points ref (`undefined <= 2` is `false`)                               | Explicit absence test. The `<=` boundary is preserved deliberately: the sole caller compensates in `PolygonClickToolArea`                                                                                          |
| 16  | `isLightColor('#fff')` was `false`; `hexToRgb('#fff')` was `"255, 15, NaN"`                             | One shared `normalizeHex` both parsers call, so the byte-identical copies cannot drift again                                                                                                                       |
| 17  | `HistoryTab.test.tsx` re-implemented the title function it asserted                                     | Mock delegates via `importOriginal`; titles pinned to production literals so a regression in `getHistoryItemTitle` fails the suite                                                                                 |
| 18  | `useHistory.test.tsx` certified its own mock reducer                                                    | 4 assertions on fabricated state removed; the real transition was already covered by `StoreContext.durable-boundary.test.tsx`                                                                                      |
| 19  | `CropToolArea.test.tsx` could not observe the spread it is named for                                    | Hoisted handler fns, so the 3 call-count assertions are reachable; the `layer-utils`-style fresh-`vi.fn()`-per-call mock is gone                                                                                   |
| 20  | `SidebarLeft.color-pickers` asserted zero-valued layout                                                 | Real `getBoundingClientRect` stub with non-round values; both prototype spies restored unconditionally in `afterEach`                                                                                              |
| 21  | `useCurrentTool.test.tsx` asserted a seed, not a round-trip                                             | `importOriginal` + delegate, and `beforeEach` resets `draw`/`text`/`shape`; 2 tests converted to true round-trips                                                                                                  |
| 22  | `LayersTab.test.tsx` asserted mock payloads over a frozen store                                         | Real `useSyncExternalStore` subscription, `layer-utils` mock deleted, and every payload test now also asserts a rendered/store outcome                                                                             |
| 23  | `LassoToolArea` re-tested `util/draw.ts`; 4 suites had no real document frame                           | 4 redundant blocks deleted; non-zero frames added, with every changed expectation derived from the transform rather than read off a failure                                                                        |
| 24  | `e2e/OPEN_PROBLEMS.md` violated its own no-changelog header                                             | 4 `Fixed` sections + 1 unheaded block deleted; 5 dangling cross-references repaired; 30+ `file:line` citations re-verified                                                                                         |
| 25  | `AGENTS.md` contradicted itself on pins (the exit-code list vs. the `close` self-verification rule)     | Resolved toward the `close` rule — the pin lives in the test code, as the suite's actual practice shows. Cited by content, not by line: line numbers into `AGENTS.md` move on every edit, including this one.      |
| 26  | `MIGRATION_NEXT_STEPS_SUNDAY.md` / `e2e/README.md` quoted stale e2e counts and carried changelog blocks | Corrected where current, deleted where historical, preserved where load-bearing (the `continue-on-error` justification)                                                                                            |
| 27  | The `getWorkspaceCanvas` "ignores a non-canvas" pin was near-vacuous                                    | The DOM now holds two canvases, so `nth(1)` resolves and restoring the old `.or()` union genuinely mis-resolves                                                                                                    |
| 28  | A comment in `settings.ts` claimed a gap that no longer exists                                          | Comment deleted — the only residue of `docs/save-settings-inconsistency.md`                                                                                                                                        |

Two things the fixes turned up that the recovered docs did not name:

- A `Levels.test.tsx` preview case was already a false positive, and one _passing_ test
  ('keeps publishing the tool args when no layer is active…') asserted the opposite of
  the contract the fix implements, so it had to go too. See item 4.
- The text-commit defect's real cause is not what the recovered doc said. `rect`
  surviving is not what keeps Apply live — the button reads React state, and the
  provider's only sync is React → ref, so `useLayers` could not reach it at all. The
  fix wires a separate stable context rather than a `useCurrentTool()` call inside
  `useLayers()`, which would have re-rendered all 13 of its consumers on every
  pointer move.

---

## 3. Struck: claims to strike

Recorded so the next session does not re-audit them. Each was verified against main.

- `TEST_ISSUES.md` §5.3, §5.5, §5.6, §5.9, §5.10 — fixed. `usePointerPosition.ts`,
  `toolProcessors.ts`, `shape.ts`, `settings.ts`, and `materialization.ts` are all correct now.
- `TEST_ISSUES.md` §2.5, §3.1, §3.2, §3.3, §3.6 — fixed. The corresponding
  unreachable-branch and untested-path claims no longer hold.
- `TEST_ISSUES.md` §3.5, §4.2, §4.5 — stale. The `usePolylineAnts` module-scoped slot
  is gone; the oversized-file set is now `selection.test.ts` (1325),
  `ShapeToolArea.test.tsx` (1182), `history-adapter.branches.test.ts` (1180),
  `StoreContext.durable-boundary.test.tsx` (1105).
- `TEST_ISSUES.md` §4.1 — wrong. `src/__tests__/fixtures/` is a shared helper module
  with 7 modules and 27 importers. See item 5 for the narrower real residue.
- `TEST_ISSUES.md` §5.11, §5.12 — wrong. Cursor mapping is covered by three passing
  tests; the `it.fails` inventory is 36, not 55.
- `TEST_ISSUES.md` §4.3 — the substance holds, the number is 50 exact-pixel
  assertions, not 47. See item 6.
- `TEST_ISSUES.md` §4.4b — wrong. `RectangularSelection.test.tsx` and
  `Common/UndoControls.test.tsx` share setup, not assertions; both earn their place.
- `TEST_ISSUES.md` §6's "coverage thresholds in `vitest.config.ts` are 95/89/97/96"
  — false. `vitest.config.ts` has no `thresholds` key and no `test:coverage` script.
  CI runs `npm run test -- --coverage` in `ci.yml`, so numbers are reported and
  nothing fails.
- `docs/next-target-useLayer.md` Priority A "THE RACE" — not real, and never was.
  `Text.tsx` clears the shared draft before committing and
  `useCurrentTool.tsx` writes the ref synchronously, so the next `commitDirtyTool`
  short-circuits. All three guards predate the plan.
