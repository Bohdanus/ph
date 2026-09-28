# Open Unit-Test Issues

Single problem-focused list for problems **in the test suite**. Production defects are registered
in `HANDOFF.md` and are not repeated here.

Every entry was re-verified against the working tree on **2026-09-27**. Anything previously
reported that no longer reproduces has been deleted rather than kept as history — this file
replaces `TEST_COVERAGE_GAPS.md`, `TEST_REVIEW_FINDINGS.md`, `TEST_NEW_FINDINGS.md`,
`TEST_FIX_HANDOFF.md` and `UNIT_TEST_FINDINGS_01.md`, all of which described a 103-file / 1293-test
/ 78%-coverage suite that no longer exists.

**Verified state**

| Metric                     | Value                                            |
| -------------------------- | ------------------------------------------------ |
| Test files                 | 138 (all passing)                                |
| Tests                      | 2782 — 2727 pass / 55 expected-fail / **0 fail** |
| Statements                 | 96.25%                                           |
| Branches                   | 90.38%                                           |
| Functions                  | 98.51%                                           |
| Lines                      | 97.38%                                           |
| Files below 75% statements | 0                                                |
| Files below 50% statements | 0                                                |
| Files below 50% branches   | 0                                                |

Thresholds in `vitest.config.ts:33` are 95 / 89 / 97 / 96. The suite passes under 16 different
`--sequence.shuffle` seeds, so no test depends on execution order.

---

## 1. Over-mocking

### 1.1 `ShapeToolArea.test.tsx` mocks the logic it is supposed to test

**File:** `src/components/Main/__tests__/ShapeToolArea.test.tsx` (1185 lines)

**Problem:** Five module mocks stand between the test and the behaviour under it:
`StoreContext.tsx:56`, `useLayer.ts:68`, `useCurrentTool.tsx:72`, `usePointerPosition.ts:78`,
`tools/shape.ts:97`. The last three stub the pointer-coordinate mapping and the shape rasteriser
themselves, so assertions check mock call signatures rather than real geometry.

**Fix:** keep the two boundary mocks (`useStore`, `useLayers`); delete the `useCurrentTool` /
`usePointerPosition` / `tools/shape.ts` mocks so the real pointer and drawing path executes, then
assert the rendered overlay and the committed `pos`.

---

## 2. Unfalsifiable assertions

### 2.1 `HistoryTab.test.tsx` re-implements the function under test

**File:** `src/components/SidebarRight/__tests__/HistoryTab.test.tsx:54-63`

**Problem:** the mock's `getHistoryItemTitle` returns strings the real
`contexts/useHistory.ts:15-29` never produces (`'Tool: brush'`, `'Layer 1'`, `'Hide Layer'` where
production returns `'brush'`, the raw action name, …). Every assertion on a history label therefore
verifies the test's own re-implementation, and replacing `{itemTitle}` with `{item.actionName}` in
the component would not fail the suite.

**Fix:** mock `useHistory` with `importActual` and keep the real `getHistoryItemTitle`, then assert
`expect(item).toHaveTextContent(getHistoryItemTitle(mockHistory[2]))`.

### 2.2 `LayersTab.test.tsx` asserts mock payloads over a frozen store

**File:** `src/components/SidebarRight/__tests__/LayersTab.test.tsx:26-35`

**Problem:** `mockStore` is a static object and `setActiveLayer` / `toggleVisibility` /
`updateLayer` / `removeLayer` / `moveLayerAfter` are bare `vi.fn()`s that never mutate it, so no
interaction can be observed in the DOM. All eleven interaction tests assert only
`toHaveBeenCalledWith`. The same file also re-implements `getSortedLayersArray` identically to
`contexts/layer-utils.ts:15-17` (line 50-52) — a pure loss, since the sibling
`LayersTab.store.test.tsx` uses the real one.

**Fix:** delete the `layer-utils` mock; move the interaction assertions to the stateful pattern
already used in `LayersTab.store.test.tsx` (`Object.assign(storeState, …)` + `rerender()` + assert
`data-open` / `aria-checked` / the highlight row).

### 2.3 `useHistory.test.tsx` verifies its own mock reducer

**File:** `src/contexts/__tests__/useHistory.test.tsx:227-258`

**Problem:** `createDispatch` is a hand-written mini-reducer that hardcodes
`hasUnsavedChanges: true` for both replay arms, so any assertion on that flag certifies the test
rather than the store. The two such assertions have been removed; the real transition belongs in
`StoreContext.durable-boundary.test.tsx`, which mounts the actual provider.

**Fix:** dispatch `COMMIT_DOCUMENT_EDIT` through the real provider and assert
`store.hasUnsavedChanges === true`, then `REPLACE_DOCUMENT` and assert `false`.

### 2.4 `CropToolArea.test.tsx` cannot verify the spread it is named for

**File:** `src/components/Main/__tests__/CropToolArea.test.tsx:83-90`

**Problem:** the test is named _"spreads useRect pointer events"_ but asserts only `tagName === 'DIV'`.
The `useRect` mock (47-56) constructs a fresh `new vi.fn()` on every call, so the handlers handed to
the div are not reachable from the test and the claim is unassertable as written.

**Fix:** hoist the handler mocks into the `useRectProps` object so the identity is stable, then
`fireEvent.pointerDown(el)` and assert `useRectProps.onPointerDown` was called.

### 2.5 `TextToolArea.test.tsx` never reaches the guard it sets up

**File:** `src/components/Main/__tests__/TextToolArea.test.tsx:230-236`

**Problem:** _"skips painting when the overlay context is unavailable"_ sets `overlayCtx = null` and
asserts `renderText` was not called, but `renderText` is only reachable through the `onRepaint`
callback, and the test never calls `repaint(...)`. Deleting the `if (!ctx) return` guard at
`TextToolArea.tsx:124` would not change the outcome.

**Fix:** call `repaint({ x1: 0, y1: 0, x2: 10, y2: 10 })` after render so the guard is actually
exercised.

### 2.6 `SidebarLeft.color-pickers.test.tsx` asserts zero-valued layout

**File:** `src/components/SidebarLeft/__tests__/SidebarLeft.color-pickers.test.tsx:78-91`

**Problem:** the test asserts `input.style.left === '0px'` and `top === '5px'`. jsdom returns zero
rects for every element, so `rect.left`, `rect.right` or a hardcoded `0` all satisfy the assertion —
it only pins the fact that the properties were set at all.

**Fix:** stub `getBoundingClientRect` on the swatch and its parent with non-zero values, then
assert the computed offset (e.g. `left === '16px'`, `top === '37px'`), which fails if the
`SidebarLeft.tsx:49-54` formula changes.

### 2.7 `Main.toolAreas.test.tsx` names smoothing it never asserts

**File:** `src/components/Main/__tests__/Main.toolAreas.test.tsx:186-195`

**Problem:** the test is named _"sizes both overlays to the document and enables smoothing on the
main canvas"_ but asserts only sizes, and `[300, 150]` is jsdom's default `HTMLCanvasElement` size —
`Main.tsx` never resizes the main canvas, so the assertion can only fail if someone _fixed_ the
missing resize. The smoothing half is untestable: `canvasCtxRef` (`Main.tsx:47`) is read at `98-100`
and passed at `204` but never assigned anywhere in `src/`, so the effect is unreachable.

**Fix:** retitle the test to cover overlay sizing only, and delete `canvasCtxRef` plus the
unreachable smoothing effect from `Main.tsx` (see `HANDOFF.md` §25).

---

## 3. Uncovered production behaviour

Each item is reachable from the public surface and simply has no test.

### 3.1 `useRect` — inverted `initialRect` breaks the aspect lock

**File:** `src/hooks/__tests__/useRect.test.ts`

**Problem:** every aspect-locked resize test uses a sorted rect, so only the `y1 < y2` / `x1 < x2`
arms of `useRect.ts:195-201` and `:212-218` run. An inverted rect (`x1 > x2`) reaches the `else`
arms, where the correction is applied in the mirrored direction and the locked ratio is not
maintained. There is also no zero-size drag case.

**Fix:** drive `{x1: 300, y1: 250, x2: 100, y2: 100}` through an aspect-locked edge resize and
assert `Math.abs(x2 - x1) === Math.abs(y2 - y1)` in both directions, plus a zero-area result case.

### 3.2 `FeatherMagneticLassoToolArea` — Alt-to-suspend-magnetism is untested

**File:** `src/components/Main/__tests__/FeatherMagneticLassoToolArea.test.tsx` (no `altKey`
reference anywhere in the file)

**Problem:** `magneticEnabled: !event.altKey` is the tool's headline modifier
(`FeatherMagneticLassoToolArea.tsx:192, 199, 222`) and no test ever holds Alt. The file is the
worst-covered production file in the repo (81.64% statements / 65.85% branches); also uncovered are
`handleContextMenu` finish, the double-click finish thresholds, `maybeCommitAutoAnchor` cadence
(`415-423`) and the feather halo preview (`81`).

**Fix:** add a 4-pointer-down case with `{ altKey: true }` and assert the snap path reports
`usedMagnetic === false` (observable through the `ctx.setLineDash` colour argument), then one
`contextMenu` finish case and one slow-drag auto-anchor case.

### 3.3 `AppKeyboardShortcuts` — the non-member tool paths

**File:** `src/components/Common/__tests__/AppKeyboardShortcuts.test.tsx`

**Problem:** the marquee and pen selectors branch on `group.includes(toolName)` to decide whether to
switch tools or to patch args. No test presses `M` or `Shift+P` while a tool _outside_ the group is
active, so both `else` arms of the ternaries are unverified. The shape selector is fully covered by
`AppKeyboardShortcuts.shape.test.tsx` and is the template to follow.

**Fix:** bare `M` from `magic-wand` → no `goToTool` and no `patchToolArgs`; `Shift+M` from `brush` →
`patchToolArgs('magic-wand', { tolerance: 16 })`; `Shift+P` from `brush` → `freeform-pen`.

### 3.4 `SidebarLeft` — right-button pointerdown and the no-op guard branches

**File:** `src/components/SidebarLeft/__tests__/`

**Problem:** `SidebarLeft.tsx:216` (`event.button !== 0`) and `:210`
(`currentIndex >= 0 ? currentIndex : 0`) are untested; the latter needs a stubbed rAF because the
tile keeps focus when the frame runs. Several other guards in the same file (`:47`, `:89`, `:261`)
are structurally unreachable and are listed in `HANDOFF.md` §25.

**Fix:** `fireEvent.pointerDown(btn, { button: 2 })` + `advanceThroughLongPress()` → no menu; and a
rAF-stubbed keyboard-open case that focuses item 1 before the frame runs.

### 3.5 `usePolylineAnts.test.tsx` — one module-scoped slot for every mounted instance

**File:** `src/hooks/__tests__/usePolylineAnts.test.tsx:99` (`let currentApi: Api | null = null`)

**Problem:** `PathProbe` writes `currentApi = api` from an effect (line 113). Two probes mounted in
one test clobber each other and the last effect wins, so the "second instance is isolated" assertion
only passes because the first `unmount()` happens to run first. The isolation it claims to prove is
not demonstrated.

**Fix:** give each `mount()` its own holder (`const apiRef = { current: null }` created inside
`mount()`) and pass it to `PathProbe` as a prop; then add a concurrency test that mounts two probes
with different canvases in one render and asserts each holder tracks its own instance.

### 3.6 `useApp.psd.test.ts` — the PSD bitmap-immutabilization path never runs

**File:** `src/hooks/__tests__/useApp.psd.test.ts:36-52, 99, 178`

**Problem:** the local `createMockLayer` produces layers with no `source` key, so
`useApp.ts:88-90` (`layer.source?.kind !== 'image'`) always returns early and the
`immutableRaster` replacement never executes for any test. The assertion that appears to cover it
compares two `null` bitmaps. This is one of the two files in `npm run test:integration`.

**Fix:** give the fixture a real image source (`createImageLayer` from
`src/__tests__/fixtures/layer.ts`), spy on `immutableRaster`, and assert it is called once per image
layer, that both `layer.bitmap` and `layer.source.bitmap` are repointed to the returned copy and
differ from the input, and that `tmpCanvas` is `null`.

### 3.7 `useCurrentTool.test.tsx` — the settings round-trip is untestable

**File:** `src/contexts/__tests__/useCurrentTool.test.tsx:47-53`

**Problem:** `saveLastSettings` is mocked as a bare `vi.fn()`, so the singleton
`tools/settings.ts:lastSavedSettings` is never written. The test _"resets current tool to last saved
settings"_ therefore asserts the pristine seed values and would pass if `useCurrentTool.tsx:71`
deleted its `saveLastSettings(nextArgs)` call entirely. The sibling
`useCurrentTool.legacy-figure.test.tsx:21-33` already shows the correct
`importOriginal` + delegate pattern.

**Fix:** delegate to the real `saveLastSettings`, assert `lastSavedSettings.draw.lineWidth === 20`
after a `setToolArgs`, and that `resetToLastSavedArgs()` returns to `20` rather than the seed. Also
reset `lastSavedSettings.draw` and `.text` in `beforeEach` — lines 96-99 only restore `.shape`.

---

## 4. Structure and hygiene

### 4.1 No shared test-helper module

`src/__tests__/utils/` does not exist. Every component test re-declares its own store mock, provider
wrapper and pointer helpers. This is not cosmetic: three separate files carried the same no-op
`setToolArgs` defect and had to be repaired independently, because a shared, stateful mock would
have made the correct pattern the default. **Fix:** add
`src/__tests__/utils/test-utils.tsx` exporting `renderWithProviders`, `createMockStore` and pointer
helpers, and migrate the affected suites.

### 4.2 Two oversized test files

`src/components/Main/__tests__/ShapeToolArea.test.tsx` (1185) and
`src/contexts/__tests__/useHistory.test.tsx` (1164) each mix several unrelated subjects behind a
shared mock, so a failure report does not localise and a new test lands in an arbitrary `describe`.
**Fix:** split by subject (geometry / drag / figure-switching; navigation / titles / replay faults)
and move the shared mock into `src/__tests__/fixtures/`.

### 4.3 47 exact-pixel assertions pin `ShapeToolArea.test.tsx` to production math

Same file as §1.1. 47 assertions compare hardcoded coordinate/bounding-box literals, which duplicate
the generic invariant assertions the same file already makes through `shapeGeometryBounds`. Any
change to the pan / shift-square / figure math breaks many unrelated assertions.
**Fix:** assert invariants — correct `figure`, `pos.width > 0`, circle/square ⇒
`pos.width === pos.height`, start/end points inside `pos` bounds, and quadrant-sign symmetry for a
drag direction.

### 4.4 Redundant duplicate suites

- `src/components/Main/__tests__/LassoToolArea.test.tsx:79-130` — four `it('pointsBoundingPos …')`
  blocks call `util/draw.ts` directly with 16 exact-pixel assertions; `PolygonClickToolArea` is
  never rendered and `src/util/__tests__/draw.test.ts:14-36` already covers the function.
- `RectangularSelection.test.tsx:94-100` and `132-138` — byte-identical bodies under two names.
- `Blur.test.tsx:143-173`, `Levels.test.tsx:85-89, 216-227` and `Color.test.tsx:212-236` re-test
  `Common/UndoButton.tsx` through three wrappers; `Common/__tests__/UndoControls.test.tsx:54-97`
  already covers both entry points and both dirty states exhaustively. None of the three asserts
  anything about Blur, Levels or Color.

**Fix:** delete the duplicated bodies; keep the drag-mechanics and component-specific cases.

### 4.5 `documentFrame` is the identity in 5 of 6 frame-aware tool-area suites

`documentFrameFromSize` returns `{x: 0, y: 0, …}`, so where the store mock omits `documentFrame` the
whole canvas→document conversion is a no-op and the assertions cannot distinguish document space
from canvas space. Only `MoveToolArea.test.tsx:464-483` uses a non-zero frame.
Affected: `DrawToolArea`, `ShapeToolArea`, `LassoToolArea`, `FeatherMagneticLassoToolArea`,
`RectangularSelectionToolArea`.
**Fix:** add `documentFrame: { x: 30, y: 40, width: 800, height: 600 }` to each hoisted store mock and
assert the committed geometry is frame-converted, so a regression that drops `canvasToDocumentPos`
fails in every suite.

---

## 5. Production defects blocking coverage

Not a test problem — registered in `HANDOFF.md`. Listed here only because each one currently pins
an `it.fails` that a test author will encounter:

| `it.fails` owner                        | Production defect                                               |
| --------------------------------------- | --------------------------------------------------------------- |
| `Levels.test.tsx`                       | `Levels.tsx:23` has no `activeLayerId` guard (`HANDOFF.md` §11) |
| `Levels.test.tsx`                       | two sliders in one animation frame drop the first change (§11)  |
| `usePointerPosition.test.ts`            | `pointerId === 0` skips `releasePointerCapture` (§25)           |
| `useDoubleClick.test.ts`                | length gate bypassed when `pointsRef.current` is absent         |
| `tool-processors.test.ts`               | `NaN` `lineWidth` reaches the context (§25)                     |
| `shape.test.ts`                         | negative-extent `strokeRect` draws nothing (§25)                |
| `rect.test.ts`, `color.test.ts`         | no 3-digit hex expansion (§25)                                  |
| `string.test.ts`                        | `ellipsify` splits a grapheme cluster (§25)                     |
| `settings.test.ts` ×3                   | `saveLastSettings` drops `blur` / `color` / `levels` (§15)      |
| `materialization.ordering.test.ts`      | the no-output raster processor never rejects (§2)               |
| `StoreContext.durable-boundary.test.ts` | an unmappable cursor is not exercised (§19)                     |

**Inventory:** 55 `it.fails`, concentrated in
`image-processors.test.ts` (10), `selection.test.ts` (5), `FontSelect.test.tsx` (4),
`SaveDialog.test.tsx` (4), `settings.test.ts` (3), `LayersTab.test.tsx` (3), and 13 files with 1–2
each. Run `grep -rn "it\.fails(" src --include="*.test.ts*"` for the full list.

---

## 6. Explicitly not a problem

Recorded so the next audit does not re-raise them:

- **`fireEvent.keyDown` is not inherently wrong.** 33 call sites remain and most are correct: when
  the component owns the `onKeyDown` handler (`SidebarLeft.keyboard.test.tsx`,
  `useKeyboardEvents.test.tsx`, `LayersTab.test.tsx`, `FontSelect.test.tsx`) a synthetic key event is
  the right tool. The defect is narrower — an arrow key on `<input type="range">` relies on a browser
  default that neither jsdom nor `user-event` implements, so the handler never runs. Those sites now
  use `stepUp` / `stepDown` + `fireEvent.input`.
- **The `it.fails` tests are not redundant.** Each pins a production defect in §5 or `HANDOFF.md`.
  They report as `expected fail` and count as passing.
- **Module-level mutable state is fine when it is reset per test.** The one real leak — an unreset
  layer-id counter inside a `vi.mock` factory in `useLayer.text.test.tsx` — is fixed. A `let` reset in
  `beforeEach` is not a defect.
- **Coverage is no longer a problem in aggregate.** 0 files below 75% statements, 0 below 50%
  statements, 0 below 50% branches. Remaining coverage work is enumerated in §3 by behaviour rather
  than by percentage.

---

## Verification

```bash
npm test                      # 138 files, 0 failing
npm test -- --coverage        # 96.25 / 90.38 / 98.51 / 97.38, all above thresholds
npm run test:integration      # psd-utils + useApp.psd
npm run tsc
npx eslint .
npx prettier --check .

# Order independence — every seed must pass
npx vitest --run --sequence.shuffle --sequence.seed=999

# Remaining known production defects
grep -rn "it\.fails(" src --include="*.test.ts*"
```
