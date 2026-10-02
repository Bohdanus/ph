# Broad Test Improvement Skill

This skill performs comprehensive test suite improvements: fixing broken tests, shallow review for common defects, and increasing coverage where needed. **Only modifies test files** — never touches source code.

## ⛔ DO NOT TOUCH (Protected Files)

These files are **never** modified by this skill, under any circumstances:

- `psd-utils.test.tsx` — gold-standard format-utils test; real `ag-psd` round-trips with pixel assertions
- `useAnts.test.tsx` — verified accurate per `useAnts.ts`; the `[0, 6, -1, 5]` offset and `clearRect(9,19,32,32)` assertions are correct
- `rect.test.ts` — the "fully outside" assertion matches `trimRect` exactly; it's a regression test for current behavior
- `draw.test.ts` — exact `bezierCurveTo`/`quadraticCurveTo` arg assertions are correct; for these thin canvas wrappers the canvas-call sequence IS the observable behavior
- `useHistory.test.ts`, `useApp.psd.test.ts`, `functions.test.ts` — concerns were overblown or minor; not worth the risk of a rewrite

**If a subagent identifies an issue in a protected file, it must:**

1. Record it in the "Remaining (Manual Review)" section
2. NOT modify the file
3. Return `{file, action: "skipped", reason: "protected"}`

**Protection rule**: If a test file has >3 tests, uses `it.each` parameterization, or asserts on pixel data / canvas calls — it is likely a good test. Do not touch it.

---

## Safety & Autonomy Principles

- **Dry-run first**: Every phase starts with a read-only scan; no writes until verification passes
- **Atomic fixes**: One file per subagent, verified independently before batch commit
- **Escape hatches**: Stop on any regression (lint/typecheck/test failure on previously passing code) — **after you have established it is not a wrong expectation.** Compute and time are effectively unlimited in this repository, so the failure mode is not cost but premature surrender: a `toBeTruthy()` swapped for `toBeInTheDocument()` because a selector was hard to reach is a green suite that has stopped testing anything. **Escalating is a last resort.** Exhaust, in order: read the source under test and find the real behaviour; check `e2e/OPEN_PROBLEMS.md` for a filed instance; recover the intended contract from the project's chat history and the existing handoff entries; re-run the failing assertion with the actual value printed. Write the question into `HANDOFF.md` only once all four are done, and say in the entry which four you ran — a question with no search log behind it is a judgement call wearing a question's clothes.
- **No source changes**: Except `data-testid` additions when absolutely required for test stability
- **Deterministic verification**: Run affected file's tests + full suite after each batch
- **Preserve good tests**: Never rewrite or "simplify" tests that already work and are well-structured

---

## When to Use

- After major refactors or dependency upgrades
- When test failures or warnings appear in CI
- Periodic test hygiene maintenance
- Before releases to ensure test reliability

---

## Scope

All test files in `src/**/__tests__/*.test.{ts,tsx}`. **The count is re-derived, never trusted** —
an earlier revision of this line said "currently 55 files, ~400 tests" against a tree that held 259
test files, so a number written here outlived the tree it described:

```bash
find src -type d -name __tests__ -exec find {} -name '*.test.ts*' \; | wc -l
```

---

## Before Phase 1: create the worktree

**Every subagent below inherits this session's working directory.** A fan-out launched from the main
checkout is five concurrent writers in a shared checkout that other sessions are committing into,
and no permission can stop it: tool permissions match a path glob and have no term for the working
directory, so `src/foo.test.ts` is the same pattern in `main` and in a worktree. `task` creates no
worktree and no session, so the order is fixed:

```bash
git worktree add -b test/improve-<slug> .kilo/worktrees/<name> main
```

Create it, **then** dispatch, then put the **absolute** worktree path in every brief — a subagent's
cwd only affects relative `bash`, while its `edit` and `write` calls take absolute paths, so the
brief is the thing that moves the work. Never two subagents on one file; split by concern, and
serialize anything Phase 2's triage assigns to more than one finding in the same file. Pass `model`
**and** `provider` together — a free session that names a paid model without a provider gets it
resolved onto the gateway and dies at zero tokens.

**The main worktree is for reading and merging only.** `scripts/main-worktree-guard.mjs` runs first
in `.husky/pre-commit` and refuses a commit made from it; the one override is
`ALLOW_MAIN_COMMIT=1`, and only the exact value `1`. Never `git stash`, and never
`git add -A` in a worktree whose root checkout is dirty: the root is a different checkout at a
different `HEAD`, so `-A` commits a silent reverting of whatever main has since done, with no
conflict marker, and this repository has shipped 17 of those. Stage explicit paths, and run the
`scripts/merge-takeover-guard.mjs` before integrating — it refuses the merge and is wired
into `pre-commit` and `pre-merge-commit`; `docs/ORCHESTRATION.md` is its one home.

---

## Phase 0: Baseline Capture (Mandatory First Step)

```bash
# Capture baseline for regression detection
npm test -- --run --reporter=json > /tmp/test-baseline.json 2>&1
npm run lint:check > /tmp/lint-baseline.txt 2>&1
npm run tsc > /tmp/tsc-baseline.txt 2>&1
git status --porcelain > /tmp/git-baseline.txt
```

**Store baseline**. Any phase that causes regression vs baseline → immediate stop, report diff.

---

## Good Test Detection (GTD) — Mandatory Pre-Flight

**Before ANY subagent modifies a test file, it must classify the file using this rubric.**

### GTD Scorecard

For each candidate file, score these criteria (1 point each):

| Criterion               | What to look for                                                                   | Score |
| ----------------------- | ---------------------------------------------------------------------------------- | ----- |
| Test count > 3          | File has more than 3 `it()` blocks                                                 | +1    |
| Parameterized tests     | Uses `it.each([...])` with multiple cases                                          | +1    |
| Pixel/canvas assertions | Asserts on `getImageData()`, `drawImage` args, `putImageData`, canvas pixel arrays | +1    |
| Error path coverage     | Has `rejects.toThrow()` or `expect(...).rejects` tests                             | +1    |
| Negative path coverage  | Tests `!hasImage`, `!toolName`, disabled states, empty inputs                      | +1    |
| Warning assertions      | Asserts on `warnings.join(' ')` or `warnings` array                                | +1    |
| Mock verification       | Uses `toHaveBeenCalledTimes`, `toHaveBeenNthCalledWith`, `toHaveBeenCalledWith`    | +1    |
| Real codec usage        | Imports real encoder/decoder (e.g., `ag-psd`, `gifenc`) instead of mocking it      | +1    |

### GTD Classification

| Score   | Classification   | Action                                                                                                 |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| **5+**  | **Gold**         | **DO NOT TOUCH** — record in "Remaining (Manual Review)"                                               |
| **3-4** | **Solid**        | Only fix **Critical** defects (real errors, flaky tests). No assertion changes, no coverage additions. |
| **1-2** | **Shallow**      | Safe to improve — add coverage, strengthen assertions                                                  |
| **0**   | **Broken/Empty** | Safe to rewrite or expand                                                                              |

### GTD Examples from This Repo

| File                     | Score | Classification | Why                                                                                                     |
| ------------------------ | ----- | -------------- | ------------------------------------------------------------------------------------------------------- |
| `psd-utils.test.tsx`     | 8     | Gold           | 16 tests, `it.each` blend modes, pixel assertions, error paths, warnings, mock verification, real codec |
| `useAnts.test.tsx`       | 5     | Gold           | 5+ tests, canvas call assertions, verified accurate per source                                          |
| `rect.test.ts`           | 5     | Gold           | 5+ tests, exact assertion matches `trimRect`                                                            |
| `draw.test.ts`           | 5     | Gold           | 5+ tests, exact `bezierCurveTo`/`quadraticCurveTo` assertions                                           |
| `SidebarLeft.test.tsx`   | 7     | Gold           | 8 tests, keyboard nav, flyout interactions, aria-checked assertions                                     |
| `DesktopHeader.test.tsx` | 6     | Solid          | 8 tests, menu toggles, confirm dialogs, error paths                                                     |
| `Draw.test.tsx`          | 1     | Shallow        | 1 test, only renders controls                                                                           |
| `Transform.test.tsx`     | 1     | Shallow        | 3 tests, only renders controls                                                                          |
| `Levels.test.tsx`        | 1     | Shallow        | 2 tests, only renders controls                                                                          |
| `MagicWand.test.tsx`     | 1     | Shallow        | 1 test, only renders controls                                                                           |

### GTD Enforcement

**Subagent contract**: Before modifying any file, the subagent must:

1. Read the file
2. Score it using the GTD rubric
3. If Gold (5+) → return `{file, action: "skipped", reason: "gold_standard", score: N}`
4. If Solid (3-4) → only fix Critical defects, return `{file, action: "critical_only", fixes: [...]}`
5. If Shallow (0-2) → proceed with full improvement, return `{file, action: "improved", changes: [...]}`
6. If the file is in the **DO NOT TOUCH** list → return `{file, action: "skipped", reason: "protected"}`

**If a subagent fails to classify or misclassifies, the skill aborts and reports the error.**

---

## Phase 1: Discovery & Triage (Parallel Subagents)

Launch 3 subagents **simultaneously**. Each returns structured JSON.

### 1A. Test Runner Subagent

```
Run: npm test -- --run --reporter=json
Return JSON with:
{
  "totalTests": number,
  "passed": number,
  "failed": number,
  "errors": [{"file": "path", "test": "name", "error": "message", "line": number}],
  "unhandledErrors": [{"file": "path", "message": "string"}],
  "durationMs": number
}
```

### 1B. Lint Check Subagent

```
Run: npm run lint:check -- src/**/__tests__/
Return JSON with:
{
  "errors": [{"file": "path", "line": number, "rule": "string", "message": "string"}],
  "warnings": [{"file": "path", "line": number, "rule": "string", "message": "string"}]
}
```

### 1C. Pattern Scanner Subagent

```
Search ALL test files (src/**/__tests__/*.test.{ts,tsx}) for these exact patterns.
Return JSON array of findings: [{"file": "path", "line": number, "pattern": "id", "match": "exact matched text", "severity": "critical|high|medium|low"}]

Patterns to scan (use ripgrep with -n --json):

CRITICAL — mock shape mismatches:
1. "useTheme\\s*:\\s*\\(\\s*\\)\\s*=>\\s*\\["  (array mock for object return — useTheme returns {theme, toggleTheme})
2. "vi\\.mock\\([^)]+\\)" inside describe/it block (Vitest 5 hoisting violation)
3. "beforeEach.*requestAnimationFrame|beforeEach.*cancelAnimationFrame|beforeEach.*Path2D" (global override without fake timers)
4. "vi\\.stubGlobal\\([^)]+\\)" without corresponding "vi\\.unstubAllGlobals\\(\\)" in afterEach
5. "useStore\\s*:\\s*\\(\\s*\\)\\s*=>\\s*\\["  (array mock — useStore returns [state, dispatch] tuple)

CRITICAL — global cleanup hygiene:
6. "vi\\.restoreAllMocks\\(\\)" in afterEach without "vi\\.useRealTimers\\(\\)" (leaves pending timers)
7. "vi\\.useFakeTimers\\(\\)" without "vi\\.useRealTimers\\(\\)" in afterEach
8. "vi\\.clearAllMocks\\(\\)" or "vi\\.resetAllMocks\\(\\)" without "vi\\.unstubAllGlobals\\(\\)"

HIGH — brittle assertions:
9. "getAllByRole\\([^)]+\\)\\[\\d+\\]" (indexing into role queries)
10. "expect\\([^)]+\\.toHaveClass\\([^)]*(bg-|grid-|w-|h-|flex|hidden|block|border-|rounded-|shadow-)[^)]*\\)" (Tailwind class assertions)
11. "expect\\(container\\).toBeTruthy\\(\\)" (weak assertion)
12. "expect\\([^)]+\\)\\.toBeTruthy\\(\\)" (truthy assertion on DOM node)
13. "getByTitle\\([^)]+\\)" (title attribute — not accessible, prefer getByRole with aria-label)
14. "getByText\\([^)]+\\)\\.toBeTruthy\\(\\)" (truthy assertion instead of toBeInTheDocument)

MEDIUM — coverage gaps:
15. "mockResolvedValue\\([^)]+\\)" without nearby error-path test (check 20 lines after)
16. "vi\\.mock\\([^)]+useApp|useFile|useHistory|useLayer|useCurrentTool|StoreContext|ThemeContext" (context mock — verify shape)
17. "vi\\.mock\\([^)]+usePointerPosition|useResizeObserver|useAnts|useDoubleClick|useKeyboardEvents" (hook mock — verify shape)
18. "mockReturnValue\\(\\{[^}]*\\}\\)" (partial mock return — may hide undefined fields)

LOW — style/hygiene:
19. "describe\\([^)]*\\).*describe" (nested describes — may indicate over-testing)
20. "it\\([^)]*\\).*it\\([^)]*same|duplicate" (potential duplicate test names)
21. "expect\\([^)]+\\)\\.not\\.toBeTruthy\\(\\)" (negated truthy — prefer toBeFalsy)
22. "vi\\.fn\\(\\)" without "mockReturnValue" or "mockImplementation" (untyped mock)
23. "screen\\.queryBy[^)]*\\.toBeTruthy\\(\\)" (truthy on queryBy — prefer toBeNull)
24. "screen\\.queryBy[^)]*\\.toBeFalsy\\(\\)" (falsy on queryBy — prefer toBeNull)
```

---

## Phase 2: Categorize & Prioritize

Aggregate findings from all 3 subagents. Group by file and severity.

**Priority Matrix**:

| Severity | Category                                | Action                    |
| -------- | --------------------------------------- | ------------------------- |
| Critical | Unhandled error / flaky / mock mismatch | Fix immediately (Phase 3) |
| Critical | Vitest 5 hoisting violation             | Fix immediately (Phase 3) |
| Critical | Fake-timer/global-stub hygiene          | Fix immediately (Phase 3) |
| High     | Brittle selector / Tailwind assertion   | Fix in Phase 4            |
| High     | Weak assertion (container.toBeTruthy)   | Fix in Phase 4            |
| Medium   | Missing negative/error path             | Add coverage in Phase 5   |
| Medium   | Missing keyboard nav                    | Add coverage in Phase 5   |
| Low      | Style/hygiene/nesting                   | Optional, batch at end    |

**Output**: `triage.json` with `{critical: [], high: [], medium: [], low: []}` each containing `{file, line, pattern, description, fixStrategy}`.

---

## Phase 3: Fix Critical Defects (Parallel Subagents, One File Each)

**Launch one subagent per critical finding**. Each subagent:

1. Reads the test file
2. Applies the specific fix strategy
3. Runs `npm test -- --run <file>` to verify
4. Runs `npm run lint:check -- <file>` to verify
5. Returns `{file, fixed: true/false, changes: "diff summary", verification: "pass/fail"}`

### Fix Strategies by Pattern

#### 3.1 useTheme Array Mock → Object

```typescript
// BAD
vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => [{ theme: 'light', toggleTheme: vi.fn() }],
}));

// GOOD
const themeState = { theme: 'light', toggleTheme: vi.fn() };
vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => themeState,
}));
```

**Also applies to**: `useStore`, `useApp`, `useFile`, `useHistory`, `useLayers`, `useCurrentTool` — verify each returns correct type.

#### 3.2 Vitest 5 Hoisting: Move vi.mock to Top Level

```typescript
// BAD (inside describe)
describe('Component', () => {
  vi.mock('../context.tsx', () => ({ useCtx: () => mock }));
});

// GOOD (top level, before any describe)
vi.mock('../context.tsx', () => ({ useCtx: () => mock }));
describe('Component', () => { ... });
```

Use `vi.hoisted` for factories needing runtime values.

#### 3.3 Fake Timer / Global Stub Hygiene

```typescript
// BAD
beforeEach(() => {
  global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => {
  vi.restoreAllMocks(); // Doesn't clear pending setTimeout!
});

// GOOD
beforeEach(() => {
  vi.useFakeTimers();
  // If needed: vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 16));
});
afterEach(() => {
  vi.useRealTimers(); // Drains pending timers
  vi.unstubAllGlobals(); // Unconditional
});
```

In tests: use `vi.advanceTimersByTime(16)` to drain rAF callbacks.

#### 3.4 vi.stubGlobal Without Unstub

Add `afterEach(() => { vi.unstubAllGlobals(); })` unconditionally.

#### 3.5 useStore Array Mock → Tuple

```typescript
// BAD
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{ hasImage: true }],
}));

// GOOD
const storeState = { hasImage: true, dispatch: vi.fn() };
vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, storeState.dispatch],
}));
```

Verify: `useStore()` returns `[state, dispatch]` — both must be present.

#### 3.6 vi.restoreAllMocks Without vi.useRealTimers

```typescript
// BAD
afterEach(() => {
  vi.restoreAllMocks(); // Doesn't clear pending setTimeout!
});

// GOOD
afterEach(() => {
  vi.useRealTimers(); // Drains pending timers first
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

---

## Phase 4: Strengthen Assertions (Parallel Subagents, One File Each)

**Launch one subagent per high-severity finding**.

### Fix Strategies

#### 4.1 Replace Indexed getAllByRole

```typescript
// BAD
const buttons = screen.getAllByRole('button');
expect(buttons[0]).toHaveTextContent('Save');
expect(buttons[1]).toHaveTextContent('Cancel');

// GOOD
expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
// OR if names are dynamic:
expect(screen.getByTestId('save-dialog-save-button')).toBeInTheDocument();
```

**If no stable accessible name exists**: Add `data-testid` to source component (minimal, semantic name like `save-dialog-backdrop`).

#### 4.2 Replace Tailwind Class Assertions

```typescript
// BAD
expect(toolbar).toHaveClass('w-[6.5rem]');
expect(firstSection).toHaveClass('grid-cols-2');

// GOOD
expect(toolbar).toHaveStyle({ width: '104px' }); // or computed style
expect(firstSection).toHaveStyle({ gridTemplateColumns: 'repeat(1, minmax(0, 1fr))' });
// OR test behavior:
expect(screen.getByTestId('left-toolbar-tools')).toHaveAttribute('data-layout', 'two-column');
```

#### 4.3 Replace Weak Assertions

```typescript
// BAD
expect(container).toBeTruthy();

// GOOD
expect(screen.getByRole('region', { name: 'Sidebar' })).toBeInTheDocument();
expect(screen.getByTestId('specific-element')).toBeInTheDocument();
```

#### 4.4 Replace getByTitle with Accessible Query

```typescript
// BAD
expect(screen.getByTitle('Rotate 90° Left')).toBeTruthy();

// GOOD
expect(screen.getByRole('button', { name: 'Rotate 90° Left' })).toBeInTheDocument();
// If title is the only accessible name, add aria-label to source:
// <button aria-label="Rotate 90° Left" title="Rotate 90° Left">...</button>
```

#### 4.5 Replace Truthy/Falsy on queryBy with toBeNull

```typescript
// BAD
expect(screen.queryByText('Not found')).toBeTruthy();
expect(screen.queryByText('Not found')).toBeFalsy();

// GOOD
expect(screen.queryByText('Not found')).toBeNull();
expect(screen.queryByText('Found')).not.toBeNull();
```

#### 4.6 Replace Negated Truthy

```typescript
// BAD
expect(screen.queryByText('X')).not.toBeTruthy();

// GOOD
expect(screen.queryByText('X')).toBeNull();
```

#### 4.7 Replace getByLabelText/getByText/getByTitle with toBeInTheDocument

```typescript
// BAD — truthy assertion on DOM node (fragile)
expect(screen.getByLabelText('Pen Type')).toBeTruthy();
expect(screen.getByLabelText(/Size/)).toBeTruthy();
expect(screen.getByText('Reset All')).toBeTruthy();

// GOOD — toBeInTheDocument is explicit and fails correctly
expect(screen.getByLabelText('Pen Type')).toBeInTheDocument();
expect(screen.getByLabelText(/Size/)).toBeInTheDocument();
expect(screen.getByText('Reset All')).toBeInTheDocument();
```

**Why**: `toBeTruthy()` on a DOM node passes even if the element doesn't exist (returns `null` which is falsy, but `getByLabelText` throws if not found — so truthy is redundant). Use `toBeInTheDocument()` for explicit assertions.

#### 4.8 Replace getByTitle with getByRole + aria-label

```typescript
// BAD — title attribute is not accessible
expect(screen.getByTitle('Rotate 90° Left')).toBeTruthy();

// GOOD — accessible query
expect(screen.getByRole('button', { name: 'Rotate 90° Left' })).toBeInTheDocument();
// If source doesn't have aria-label, add it:
// <button aria-label="Rotate 90° Left" title="Rotate 90° Left">...</button>
```

**Evidence**: Transform.test.tsx:35-37 uses `getByTitle` for rotate buttons. The source likely renders `<button title="Rotate 90° Left">` without `aria-label`. Add `aria-label` to source and use `getByRole`.

---

## Phase 5: Add Coverage (Parallel Subagents, One Component Each)

**Target components with gaps** (from the Phase 2 triage — an earlier revision of this line named
`TEST_REVIEW_HANDOFF.md`, which **does not exist** anywhere in this repository, so it sent the reader
to a file that returns nothing and reads exactly like "no gaps are known"):

| Component                                                                            | Missing Coverage                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Draw, Transform, Levels, Text, MagicWand, RectangularSelection, FeatherMagneticLasso | Disabled controls, empty inputs, `!hasImage`, `!toolName` early returns |
| SaveDialog, NewImageDialog                                                           | Error paths, cancel flows                                               |
| Format utils (bmp, tiff, ico, gif, svg, avif)                                        | Real round-trip encoding/decoding with pixel assertions                 |
| SidebarLeft, SidebarRight, ToolbarHorizontal, BottomToolbar, Footer                  | Keyboard nav (ArrowUp/Down, Enter, Space, Escape), focus management     |

### Subagent Template for Coverage

```
Add tests to: <test-file-path>
Target: <specific gap from triage>
Constraints:
- ONLY modify the test file
- Follow existing test patterns in the file
- Use vi.useFakeTimers() for async
- Use getByRole/getByLabelText/getByText first
- Add data-testid to SOURCE only if no accessible query works
- Test both success and failure paths
- Run: npm test -- --run <file> && npm run lint:check -- <file>
```

### Coverage Patterns from Gold-Standard Tests

**psd-utils.test.tsx** (the repo's gold standard for format-utils tests):

- Real `ag-psd` encoding/decoding (not mocked codec)
- Pixel-level assertions (`Array.from(layer.getContext('2d')!.getImageData(0,0,w,h).data)`)
- Metadata assertions (name, order, opacity, blendMode, visibility, locked)
- Warning assertions (`imported.warnings.join(' ')`)
- Edge cases: fractional geometry, negative offsets, empty layers, smart objects
- Error paths: invalid dimensions, unsupported blend modes, invalid headers
- Parameterized tests (`it.each`) for blend modes and dimension validation

**Apply this pattern to**: bmp-utils, tiff-utils, ico-utils, gif-utils, svg-utils, avif-utils

### Concrete Gaps from Repo Scan

| File                          | Current Tests                       | Missing Coverage                                                                           | Priority |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| Draw.test.tsx                 | 1 test (renders controls)           | Pen type change, size slider change, opacity change, disabled state                        | Medium   |
| Transform.test.tsx            | 3 tests (renders controls)          | Rotate button clicks, mirror toggle clicks, Reset All click, skew/trapezoid/resize changes | Medium   |
| Levels.test.tsx               | 2 tests (renders controls)          | Brightness/contrast slider changes, Reset click, undo behavior                             | Medium   |
| MagicWand.test.tsx            | 1 test (tolerance/smoothing change) | Tolerance bounds, smoothing bounds, dispatch on change, disabled state                     | Medium   |
| RectangularSelection.test.tsx | Happy path only                     | Empty inputs, disabled controls, `!hasImage` early return                                  | Medium   |
| FeatherMagneticLasso.test.tsx | Happy path only                     | Empty inputs, disabled controls, `!hasImage` early return                                  | Medium   |
| Text.test.tsx                 | Happy path only                     | Font size change, text input, disabled state, `!hasImage` early return                     | Medium   |
| SaveDialog.test.tsx           | Happy path + cancel                 | Error paths, file name validation, empty name                                              | Medium   |
| NewImageDialog.test.tsx       | Happy path only                     | Invalid dimensions, cancel flow, error paths                                               | Medium   |
| bmp-utils.test.tsx            | 1 test (round-trip)                 | Invalid header, invalid dimensions, error paths                                            | Medium   |
| tiff-utils.test.tsx           | Shallow                             | Real round-trip with pixel assertions                                                      | Medium   |
| ico-utils.test.tsx            | Shallow                             | Real round-trip with pixel assertions                                                      | Medium   |
| gif-utils.test.tsx            | Shallow                             | Real round-trip with pixel assertions                                                      | Medium   |
| svg-utils.test.tsx            | Shallow                             | Real round-trip with pixel assertions                                                      | Medium   |
| avif-utils.test.tsx           | Shallow                             | Real round-trip with pixel assertions                                                      | Medium   |
| SidebarLeft.test.tsx          | 8 tests (comprehensive)             | Already good — focus management tested                                                     | Low      |
| SidebarRight.test.tsx         | Structural + negative               | Keyboard nav, focus management                                                             | Low      |
| ToolbarHorizontal.test.tsx    | Structural + negative               | Keyboard nav, focus management                                                             | Low      |
| BottomToolbar.test.tsx        | Structural + negative               | Keyboard nav, focus management                                                             | Low      |
| Footer.test.tsx               | Structural + negative               | Keyboard nav, focus management                                                             | Low      |

---

## Phase 6: Verification & Report

### 6.1 Automated Verification

```bash
# After ALL fixes applied
npm test -- --run --reporter=json > /tmp/test-final.json
npm run lint:check > /tmp/lint-final.txt
npm run tsc > /tmp/tsc-final.txt

# Compare vs baseline
# - Test count must be >= baseline
# - Zero new failures
# - Zero new lint errors
# - Zero type errors
```

### 6.2 Regression Check

If ANY regression detected:

- Stop immediately
- Output diff vs baseline
- List files modified in this session
- Do not proceed

### 6.3 Final Report Format

```
## Broad Test Improvement Summary

### Baseline
- Tests: X passed, Y failed, Z errors
- Lint: A errors, B warnings
- Typecheck: pass/fail

### Critical Fixed (N)
- file.test.tsx:line - [pattern] - description of fix

### High Fixed (N)
- file.test.tsx:line - [pattern] - description of fix

### Coverage Added (N tests across M files)
- file.test.tsx: +N tests for [specific scenario]

### Verification
- Tests: X passed (Δ+Y), 0 failed, 0 errors
- Lint: 0 errors, B warnings
- Typecheck: pass

### Remaining (Manual Review)
- file.test.tsx:line - [pattern] - reason not auto-fixed
```

---

## Subagent Execution Rules

1. **Max parallelism**: 5 subagents at once (avoid resource exhaustion)
2. **Timeout**: 120s per subagent
3. **Retry**: Once on transient failure (timeout, flaky test)
4. **Failure handling**: If subagent fails → mark file as "needs manual review", continue others
5. **Batch commit**: Only after ALL subagents in a phase report success

---

## Subagent Contract (Every Subagent Must Follow This)

### ⛔ Forbidden Actions

**NEVER do these, even if you think they're improvements:**

1. **NEVER rewrite or "simplify" a passing test** — If a test passes and is well-structured, leave it alone
2. **NEVER change assertion style on a Gold-classified file** — e.g., don't replace `expect(canvas.getContext('2d')!.getImageData(...))` with `expect(container).toBeTruthy()`
3. **NEVER remove a test that passes** — Even if it seems redundant, it may be a regression guard
4. **NEVER change mock return shapes on Solid-classified files** — If the mock works, don't "fix" it
5. **NEVER replace exact assertions with loose ones** — `expect(x).toBe(42)` is better than `expect(x).toBeTruthy()` if the value is deterministic
6. **NEVER delete `it.each` parameterized tests** — These are high-value coverage
7. **NEVER add `data-testid` to source** unless you have verified no accessible query works AND the source doesn't already have one
8. **NEVER modify source files** — Components, hooks, contexts, utils, styles are off-limits
9. **NEVER update snapshots** — Without explicit approval
10. **NEVER remove `vi.mock` calls** — Even if they seem unused; they may be needed for module isolation

### ✅ Required Actions

**Before modifying ANY file:**

1. **Read the file** — Don't assume what's there
2. **Run the existing tests** — `npm test -- --run <file>` to confirm they pass
3. **Classify with GTD** — Score using the rubric above
4. **Check the DO NOT TOUCH list** — If matched, skip

**After modifying:**

5. **Run the file's tests** — Must pass with 0 failures
6. **Run lint on the file** — Must have 0 new errors
7. **Run the full suite** — Must have 0 new failures vs baseline
8. **Return structured result** — `{file, action, changes, verification, gtdScore}`

### 🚨 Red Flags — If You See These, STOP and Report

| Red Flag                                                        | Why                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| Test asserts on exact pixel values (`[12, 24, 36, 255]`)        | Likely a regression guard — don't touch                      |
| Test uses `it.each` with 5+ cases                               | High-value parameterized coverage — don't touch              |
| Test mocks a real codec (e.g., `ag-psd`) but the source uses it | The mock may be testing integration — verify before changing |
| Test has `expect(...).rejects.toThrow('specific message')`      | Error path coverage — don't remove                           |
| Test has `vi.spyOn` on canvas methods                           | Likely testing drawing behavior — don't simplify             |
| Test file has 8+ tests                                          | Likely well-structured — classify with GTD before touching   |
| Test file was modified in a prior session (check git log)       | May be a known-good fix — don't revert                       |

### 🧪 Verification Protocol

**For each file modified, run in order:**

```bash
# 1. Confirm existing tests pass (before changes)
npm test -- --run <file>

# 2. Apply changes

# 3. Confirm modified tests pass
npm test -- --run <file>

# 4. Confirm no lint regressions
npm run lint:check -- <file>

# 5. Confirm no full-suite regressions
npm test -- --run
```

**If step 1 fails** → the file already has failing tests. Report as "pre-existing failure" and skip.
**If step 3 fails** → your changes broke something. Revert and report.
**If step 5 fails** → your changes caused a regression elsewhere. Revert and report.

---

## Known Issues Registry (Pre-loaded)

These are tracked across sessions. Update after each run.

| Issue                  | Files Affected                                                                       | GTD Score     | Status                    |
| ---------------------- | ------------------------------------------------------------------------------------ | ------------- | ------------------------- |
| useTheme array mock    | DesktopHeader.test.tsx (was fixed), Main.test.tsx (verify)                           | Solid (6)     | Phase 3 — Critical only   |
| Fake-timer hygiene     | usePolylineAnts.test.tsx (fixed), check others                                       | Gold (5)      | Phase 3 — Critical only   |
| Vitest 5 hoisting      | SidebarLeft.test.tsx:53, others                                                      | Gold (7)      | Phase 3 — Critical only   |
| Brittle toolbar tests  | Draw, Transform, Levels, Text, MagicWand, RectangularSelection, FeatherMagneticLasso | Shallow (0-1) | Phase 4 — Safe to improve |
| Format-utils shallow   | bmp, tiff, ico, gif, svg, avif utils tests                                           | Shallow (0-1) | Phase 5 — Safe to improve |
| Toolbar negative paths | 7 toolbar components                                                                 | Shallow (0-1) | Phase 5 — Safe to improve |

## Concrete Evidence from Repo Scan

Patterns verified in actual test files (not speculative). GTD scores from the rubric above.

| Pattern                                                           | File:Line                                                                                                                | GTD           | Severity | Evidence                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------- | -------- | ------------------------------------------------------- |
| `getByTitle` used instead of accessible query                     | Transform.test.tsx:35-37                                                                                                 | Shallow (1)   | High     | `screen.getByTitle('Rotate 90° Left')` — not accessible |
| `getByText(...).toBeTruthy()` instead of `toBeInTheDocument`      | Transform.test.tsx:37-40, Levels.test.tsx:35-38                                                                          | Shallow (1)   | High     | Truthy assertion on DOM node                            |
| `getByLabelText(...).toBeTruthy()` instead of `toBeInTheDocument` | Draw.test.tsx:45-47, Levels.test.tsx:38-39                                                                               | Shallow (1)   | High     | Truthy assertion on DOM node                            |
| Single happy-path test only                                       | Draw.test.tsx (1 test), Transform.test.tsx (3 tests), Levels.test.tsx (2 tests), MagicWand.test.tsx (1 test)             | Shallow (0-1) | Medium   | No negative/error path coverage                         |
| `vi.mock` inside describe block                                   | SidebarLeft.test.tsx:24-60                                                                                               | Gold (7)      | Critical | Vitest 5 hoisting violation                             |
| `useTheme` array mock (object return)                             | DesktopHeader.test.tsx:51 (was fixed)                                                                                    | Solid (6)     | Critical | Already addressed in prior session                      |
| `mockResolvedValue` without error path                            | DesktopHeader.test.tsx:135-143                                                                                           | Solid (6)     | Medium   | Only success path tested                                |
| Format-utils shallow (mocked codec)                               | bmp-utils.test.tsx, tiff-utils.test.tsx, ico-utils.test.tsx, gif-utils.test.tsx, svg-utils.test.tsx, avif-utils.test.tsx | Shallow (0-1) | Medium   | Real round-trip only in psd-utils.test.tsx              |
| `vi.hoisted` used correctly                                       | MagicWand.test.tsx:5-6                                                                                                   | Shallow (1)   | Good     | Pattern to replicate                                    |
| `vi.stubGlobal` + `vi.unstubAllGlobals`                           | DesktopHeader.test.tsx:131-132, 146-147                                                                                  | Solid (6)     | Good     | Pattern to replicate                                    |

### Gold-Standard Files (DO NOT TOUCH)

| File                   | GTD | Why Protected                                                                                           |
| ---------------------- | --- | ------------------------------------------------------------------------------------------------------- |
| `psd-utils.test.tsx`   | 8   | 16 tests, `it.each` blend modes, pixel assertions, error paths, warnings, mock verification, real codec |
| `useAnts.test.tsx`     | 5   | 5+ tests, canvas call assertions, verified accurate per `useAnts.ts`                                    |
| `rect.test.ts`         | 5   | 5+ tests, exact assertion matches `trimRect`                                                            |
| `draw.test.ts`         | 5   | 5+ tests, exact `bezierCurveTo`/`quadraticCurveTo` assertions                                           |
| `SidebarLeft.test.tsx` | 7   | 8 tests, keyboard nav, flyout interactions, aria-checked assertions                                     |
| `useHistory.test.ts`   | 5+  | Prior session determined concerns were overblown                                                        |
| `useApp.psd.test.ts`   | 5+  | Prior session determined concerns were overblown                                                        |
| `functions.test.ts`    | 5+  | Prior session determined concerns were overblown                                                        |

---

## Commands Reference

```bash
# Full test run
npm test -- --run

# Single file test
npm test -- --run src/path/to/file.test.tsx

# Lint test files only
npm run lint:check -- src/**/__tests__/

# Typecheck
npm run tsc

# Pattern search (ripgrep)
rg -n "pattern" src/**/__tests__/

# Baseline capture
npm test -- --run --reporter=json > /tmp/test-baseline.json
npm run lint:check > /tmp/lint-baseline.txt 2>&1
npm run tsc > /tmp/tsc-baseline.txt 2>&1
```

---

## Constraints (Enforced)

- **NEVER modify source files** (components, hooks, contexts, utils, styles)
- **Only add data-testid to source** when absolutely necessary for test stability (no accessible alternative)
- **Prefer subagents** for parallel file fixes
- **Run verification** after each batch of fixes
- **Stop immediately** if lint/typecheck/tests fail on previously passing code
- **No new test files** unless covering entirely untested source module
- **No snapshot updates** without explicit approval

---

## Skill Invocation

To run this skill autonomously:

```
Execute the broad-test-improvement skill:
1. Run Phase 0 (baseline capture)
2. Launch Phase 1 subagents in parallel
3. Aggregate triage.json
4. Launch Phase 3 subagents for all critical findings (max 5 parallel)
5. Verify Phase 3 results, run full suite
6. Launch Phase 4 subagents for all high findings (max 5 parallel)
7. Verify Phase 4 results, run full suite
8. Launch Phase 5 subagents for coverage gaps (max 5 parallel)
9. Verify Phase 5 results, run full suite + lint + typecheck
10. Generate final report
```

Each phase gates on the previous phase's verification passing.
