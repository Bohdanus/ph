# Audit of the abandoned stashed issue docs

Three issue documents were stashed and never recovered. They were verified against
`main` at `446d7eb` and this file lists only the issues that are **still valid**.
Entries whose defect no longer exists are deleted rather than softened; item numbers
are stable identifiers and are not renumbered.

**Recovered from** `stash@{0}` (`WIP on main: 50bb2b8`, 2026-09-27 09:13). The
stashed `HANDOFF.md` is a 424-line predecessor of main's 1114-line file and is
**not** recovered — main's version supersedes it entirely.

| Recovered doc | Disposition |
| --- | --- |
| `TEST_ISSUES.md` (355 lines) | 13 of 27 issues still valid. Items 1-4 below. |
| `docs/save-settings-inconsistency.md` (139 lines) | **Entirely obsolete.** Fixed by `8736334`; the `never` exhaustiveness sentinel it proposed as Solution C is at `src/util/settings.ts:81`. One stale comment remains (item 8). |
| `docs/next-target-useLayer.md` (261 lines) | **Obsolete as a plan.** Its Priority A "THE RACE" is not real. Two production defects it walked past survive (item 4). |

The chat that prompted this audit (`eb2160e`) is clean: its four claims are
`VERIFIED-FIXED`, `VERIFIED-FIXED`, `VERIFIED-FIXED` and `PARTIAL`. The `PARTIAL`
produced items 5-7 below.

---

## 1. Production defects the stash preserved and `HANDOFF.md` never recorded

`HANDOFF.md` is scoped to "the durable-replay migration and the presentation/append
boundary" and says tool features are out of scope. That scope is why these died with
the stash: they were never `HANDOFF.md` candidates. They are not on the cutover
path, so they are independently fixable.

### 1. `Levels.tsx` publishes a preview for a layer that does not exist

**Problem.** `src/components/ToolbarsRight/Levels/Levels.tsx:23` is
`tempUpdateLayer({ id: activeLayerId!, toolArgs: pendingUpdateRef.current })`. The id
is asserted non-null, never checked. With no active layer the `requestAnimationFrame`
callback still runs and publishes a `tempUpdateLayer` for `undefined`.

**Tripwire.** `src/components/ToolbarsRight/Levels/__tests__/Levels.test.tsx:307` is
`it.fails('skips the layer preview entirely when no layer is active (Levels.tsx:23)')`.
A fix must invert it in the same change.

**Fix.** Early-return inside the rAF callback when `activeLayerId == null`, and clear
`pendingUpdateRef` before the return so the next change re-arms the frame.

### 2. Two Levels sliders changed in one animation frame lose the first change

**Problem.** `Levels.tsx:33-39` — both handlers spread the render-scoped `args`:
`throttledOnChange({ ...args, brightness })` and `throttledOnChange({ ...args, contrast })`.
`throttledOnChange` (`:17`) overwrites `pendingUpdateRef.current = newArgs` with no
merge. A contrast change before the frame runs therefore discards the pending
brightness value, and the layer preview and `setToolArgs` both publish the stale one.

This is **unpinned** — `Levels.test.tsx` flushes between changes in every case, so
nothing in the suite can fail on it.

**Fix.** Merge against the pending value rather than the render snapshot: base each
change on `pendingUpdateRef.current ?? args` inside `throttledOnChange`, and add a
same-frame two-slider test that asserts both values survive.

### 3. `ellipsify` can emit a lone surrogate

**Problem.** `src/util/string.ts:36-38` —
`if (str.length <= maxLength) return str; return str.slice(0, maxLength - 3) + '...'`.
`length` and `slice` count UTF-16 code units, so an emoji costs 2. Three functions
above it, `deleteCharAt` (`:15-36`) and `charLength`, use `Intl.Segmenter` and cut on
whole grapheme clusters. Truncating `'👍🏽👍🏽…'` to 5 units yields `"👍🏽\ud83d"` — a
lone high surrogate, which renders as the replacement glyph in a layer name.

**Tripwire.** None. `string.test.ts` has 0 `it.fails` and no non-BMP input.

**Fix.** Segment first, append whole clusters while they fit inside the budget, then
`'...'`. Add a non-BMP case to `string.test.ts`.

### 4. `removeLayer` throws after it has already committed

**Problem.** `src/contexts/useLayer.ts:423` is
`const ctx = toolOverlayRef.current!.getContext('2d')!;` — no guard, while the
sibling `clearOverlay` guards both hops. When the tool overlay is unmounted the
dispatch at `:415` has already removed the layer, then a raw `TypeError` escapes.

**Tripwire.** `src/contexts/__tests__/useLayer.lifecycle.test.tsx:615` is a **passing**
`it('commits the removal and then throws when the overlay has no 2d context (PROD
DEFECT, not fixed)')` that asserts the throw. A fix must invert it in the same change.

**Fix.** Guard `toolOverlayRef.current?.getContext('2d')` and return when absent, then
invert the tripwire.

**Cross-reference bug.** That test's comment says "HANDOFF §23". `HANDOFF.md` §23 is
`Main.toolAreas.test.tsx` naming image smoothing — an unrelated item. This defect is
in no `HANDOFF.md` section at all, so the citation points the next session at the
wrong entry. Correct it to name this item.

### 5. `useDoubleClick` reports a double click with zero points

**Problem.** `src/hooks/useDoubleClick.ts:25` —
`if (pointsRef.current?.length <= minPointsForDetection || !lastClickPosRef.current)`.
When `current` is `null`, `undefined <= 2` is `false`, so the length gate falls
through and only the position guard remains: a double click is reported for a tool
that has no points at all. The optional chain is what makes it wrong — a
non-optional comparison would have thrown instead.

**Tripwire.** None. `useDoubleClick.test.ts` has 0 `it.fails`; its `createPointsRef`
helper always builds an array, so `current` is never `null` in the suite.

**Fix.** Make the null case explicit — `pointsRef.current == null ||
pointsRef.current.length < minPointsForDetection` — and add a test whose points ref
is null.

### 6. A second text layer on Apply after the draft was committed

**Problem.** `src/contexts/useLayer.ts:332` — `commitDirtyTool`'s text branch clears
only `text`, and only on the imperative `currentArgsRef`:
`currentArgsRef.current = { ...args, text: '' }`. `rect` survives, and React's
`toolArgs` are untouched. So after one text layer is committed the Text toolbar's
Apply button is still enabled, and clicking it again creates a second layer rather
than no-op.

**Tripwire.** None.

**Fix.** The clear must reach the state the Apply button reads, or the button's
disabled condition must be derived from the same source as the commit guard.

### 7. `hexToRgb` and `luminance` mangle 3-digit hex

**Problem.** `src/util/color.ts:4-7` and `src/util/rect.ts:96-101` are byte-identical
parsers with no length branch: `parseInt(hex.substring(0, 2), 16)` over a 3-character
string. For `'#fff'`: `r=255`, `g=15`, `b=NaN`. `luminance` is `NaN`, `NaN > 128` is
`false`, so **`isLightColor('#fff')` returns `false`** — pure white is classified as
dark — and `hexToRgb('#fff')` returns the string `"255, 15, NaN"`.

**Tripwire.** None. Both test files have 0 `it.fails` and no 3-digit case.

**Fix.** Expand a 3-digit hex to its 6-digit form before parsing, in one shared
helper both files call, so the two copies cannot drift again.

---

## 2. Test assertions that cannot fail

Each of these passes today and would keep passing if the production code regressed.

### 8. `HistoryTab.test.tsx` re-implements the title function it asserts

`src/components/SidebarRight/__tests__/HistoryTab.test.tsx:56-62` hand-writes the title
map, while production `src/contexts/useHistory.ts:19,23,28` returns
`layerSource.args.toolName` — the bare string `'brush'`, not the mock's
`"Tool: brush"`. Six assertions use the mock's literals and `:322` even selects a row
by them, so the whole title layer is pinned to strings production never emits. Rewrite
the mock with `importOriginal` and assert against the imported `getHistoryItemTitle`.

### 9. `useHistory.test.tsx` certifies its own mock reducer

`src/contexts/__tests__/useHistory.test.tsx:187-218` is a hand-written mini-reducer
that hardcodes `hasUnsavedChanges: true` in both arms while the store mock seeds
`false`. Four assertions read that fabricated value: `:499` and `:681` expect `true`,
`:651` and `:754` expect `false`. The real transition is already proven through the
real provider at `StoreContext.durable-boundary.test.tsx:1031-1055`, so this is
deletion, not new coverage.

### 10. `CropToolArea.test.tsx` cannot observe the spread it is named for

`src/components/Main/__tests__/CropToolArea.test.tsx:83-89` is `it('renders a div
without crashing and spreads useRect pointer events')` and ends at
`expect(el.tagName).toBe('DIV')`. Its `useRect` mock (`:47-56`) mints fresh
`vi.fn()` handlers per call, so the div's handlers are unreachable from the test.
`TextToolArea.test.tsx:185-196` already shows the working pattern: hoisted handler
refs plus `toHaveBeenCalledTimes`.

### 11. `SidebarLeft.color-pickers.test.tsx` asserts zero-valued layout

`src/components/SidebarLeft/__tests__/SidebarLeft.color-pickers.test.tsx:168-181`
asserts `input.style.left === '0px'` and `top === '5px'`, with the comment at `:174`
admitting "jsdom returns zero rects, so offsets are 0". Production
`SidebarLeft.tsx:49-52` computes the real offsets and nothing in the suite stubs
`getBoundingClientRect`, so `0` and any other value both satisfy it.

### 12. `useCurrentTool.test.tsx` asserts a seed, not a round-trip

`src/contexts/__tests__/useCurrentTool.test.tsx:51-53` mocks `saveLastSettings` with a
bare `vi.fn()`, so `lastSavedSettings.draw` is never written. The test at `:278-296`
sets `lineWidth: 20`, calls `resetToLastSavedArgs()` and asserts `lineWidth: 5` — the
seed. It passes identically with `saveLastSettings(nextArgs)` deleted from
`useCurrentTool.tsx:71`. `useCurrentTool.legacy-figure.test.tsx:21-33` already
demonstrates the `importOriginal` + delegate pattern that would make it falsifiable.

---

## 3. Redundant and missing coverage

### 13. `LassoToolArea.test.tsx` re-tests `util/draw.ts`

`src/components/Main/__tests__/LassoToolArea.test.tsx:141-192` is four
`pointsBoundingPos` blocks with 16 exact-pixel assertions over
`util/draw.ts:pointsBoundingPos`, which `src/util/__tests__/draw.test.ts:14-36`
already covers. They assert nothing about `LassoToolArea`. Delete them.

### 14. Four tool-area suites never exercise a non-identity document frame

`canvasToDocumentPos` / `documentToCanvasPos` are the coordinate contract, and they
regress invisibly while every suite pins a 0,0 frame. Identity or `null` today:
`LassoToolArea.test.tsx:54`, `FeatherMagneticLassoToolArea.test.tsx:56`,
`ShapeToolArea.test.tsx:62` (`Shape` additionally pins the `x=0,y=0` fallback at
`:894`). `RectangularSelectionToolArea.test.tsx:23` is worse — its store mock has **no
`documentFrame` key at all** while `RectangularSelectionToolArea.tsx:12,25,35,72-73`
converts through it. Give each a non-zero frame so a conversion bug fails in every
suite, not just the four that already have one.

---

## 4. Documentation defects

### 15. `e2e/OPEN_PROBLEMS.md` violates its own header

`e2e/OPEN_PROBLEMS.md:3-4` states "Not a changelog. Each entry is an unfixed defect…
The one section that is not work says so on its own heading." Four changelog
sections survive: `:110`, `:191`, `:242`, `:436`. `AGENTS.md` forbids exactly this in
handoff docs. Delete them; the rationale belongs in the code and `e2e/README.md`.

### 16. `AGENTS.md` contradicts itself on pins

`AGENTS.md:159-163` says a fixed defect's pin "survives in `e2e/OPEN_PROBLEMS.md`
rather than being deleted", while `:170-171` says "a fix must remove the pin in the
same change". A reader cannot follow both. `:170-171` is the rule that matches
`useHistory`'s test suite; fix `:159-163` to point at the tripwire in the test code.

### 17. `MIGRATION_NEXT_STEPS_SUNDAY.md` quotes a measurement nobody took

`MIGRATION_NEXT_STEPS_SUNDAY.md:636` reports "97 collected, 92 pass, 3 fail, 2
skipped — _reported in `e2e/OPEN_PROBLEMS.md`, not re-measured_".
`e2e/OPEN_PROBLEMS.md:41` now reports 97 pass, 2 skipped, nothing failing, so the
cited source no longer contains that number. Correct or delete the line.

### 18. The `getWorkspaceCanvas` "ignores a non-canvas" pin is near-vacuous

`e2e/helpers/__tests__/canvas-interaction.unit.test.ts:69-75` builds
`dom = [{selector:'div'}, canvas('workspace-canvas')]`. Restoring the old
`getByTestId(…).or(locator('canvas').nth(1))` still yields one match, because
`nth(1)` of a one-canvas list is empty — so the pin does not guard the regression it
names. The sibling pins at `:42` and `:52` carry that weight; either give this case a
second canvas or drop it.

### 19. `saveLayerCanvas` is dead but still gates the cutover

`HANDOFF.md` §19 records that `saveLayerCanvas` (`src/contexts/layer-utils.ts:115`)
has no non-test caller, and `AGENTS.md`'s architecture section says not to begin the
single-writer cutover "while `saveLayerCanvas()` can still promote cached canvases
outside reducer publication". The function is still present and still dead, so the
gate is not wrong — but it is now decided by a function no production code calls.
Either delete the function (the `AGENTS.md` gate then clears) or state in the gate
that the real remaining risk is the dead export's presence, not its behaviour.

### 20. A stale comment inside `saveLastSettings`

`src/util/settings.ts:34` reads "deliberately not storing for those three because
they have a different philosophy, unfortunately". It predates the gap it describes and
is contradicted by `src/util/settings.ts:71-76`, which stores blur, color and levels.
This is the only residue of `docs/save-settings-inconsistency.md`.

---

## 5. Claims to strike

Recorded so the next session does not re-audit them. Each was verified against main.

- `TEST_ISSUES.md` §5.3, §5.5, §5.6, §5.9, §5.10 — fixed. `usePointerPosition.ts:111`,
  `toolProcessors.ts:181`, `shape.ts:192-203`, `settings.ts:71-76`,
  `materialization.ts:276` are all correct now.
- `TEST_ISSUES.md` §2.5, §3.1, §3.2, §3.3, §3.6 — fixed. The corresponding
  unreachable-branch and untested-path claims no longer hold.
- `TEST_ISSUES.md` §3.5, §4.2, §4.5 — stale. The `usePolylineAnts` module-scoped slot
  is gone; the oversized-file set is now `selection.test.ts` (1325),
  `ShapeToolArea.test.tsx` (1182), `history-adapter.branches.test.ts` (1180),
  `StoreContext.durable-boundary.test.tsx` (1105). See item 14 for what survives of
  the `documentFrame` claim.
- `TEST_ISSUES.md` §4.1 — wrong. `src/__tests__/fixtures/` is a shared helper module
  with 7 modules and 27 importers.
- `TEST_ISSUES.md` §5.11, §5.12 — wrong. Cursor mapping is covered by three passing
  tests; the `it.fails` inventory is 36, not 55.
- `TEST_ISSUES.md` §4.3 — the substance holds, the number is 50 exact-pixel
  assertions, not 47.
- `docs/next-target-useLayer.md` Priority A "THE RACE" — not real, and never was.
  `Text.tsx:82-89` clears the shared draft before committing and
  `useCurrentTool.tsx:70` writes the ref synchronously, so the next `commitDirtyTool`
  short-circuits. All three guards predate the plan.
