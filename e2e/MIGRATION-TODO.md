# Migration TODO — e2e suite into this repository

What is **not** done. Companion to [`README.md`](README.md) (how to run it) and
[`OPEN_PROBLEMS.md`](OPEN_PROBLEMS.md) (defects in the test code itself, with
evidence). This file is the migration's unfinished business: what was knowingly
deferred, and what should happen next.

Status as of the commit that introduced the suite. Counts are from that tree on a
HiDPI macOS host; re-verify before acting on any rate quoted here.

---

## 1. Blocking now

Nothing. The blocking gates are green: `lint:check`, `tsc -b` (all three
projects), the app suite (176/176 files), and the e2e helper unit tests (694 pass,
2 expected-fail). Nothing in this section should block other work.

## 2. The e2e suite is now green

**97 pass, 0 fail, 2 skipped** on the default headless run, reproduced across
repeated full runs. Both items this section used to list as open are fixed, and so is
the `levels.spec.ts` pair. Each was fixed by changing an assertion or a wait, never by
loosening a threshold, adding a skip, or re-recording a baseline. Evidence, including
the measurements that established each defect and the mutation tests that prove the
fixes, is in `OPEN_PROBLEMS.md`.

| formerly failing tests            | was                                     | now                                                |
| --------------------------------- | --------------------------------------- | -------------------------------------------------- |
| `cdp-helpers.spec.ts`             | 2 headless, 5 headed, disjoint per mode | capture scale no longer asserted; mode-independent |
| `sidebar-keyboard.spec.ts:77, 89` | 0–2, 5 of 12 measured headless runs     | root-caused to an rAF focus race, then awaited     |
| `levels.spec.ts:64, 109`          | 2, both modes                           | canvas located by test id, not document order      |

**Done since the migration — `getWorkspaceCanvas` (previously item 2 here).** All
three parts landed together, and the two `levels.spec.ts` failures it caused are
green:

- `data-testid="workspace-canvas"` is now published in `src/components/Main/Main.tsx`
  on the primary `<canvas>`. This is the one app-source change the suite has made.
- `getWorkspaceCanvas` is now `page.getByTestId('workspace-canvas')`. The
  `testId.or(nth(1))` fallback was removed rather than repaired: `.or()` is a union,
  so with the test id in place it resolved to 2 elements and every `boundingBox()`
  raised a strict-mode violation. A single-selector locator cannot.
- `resolveFakeLocator` is gone, replaced by `resolveFakeMatches`, which returns the
  whole match list so a union can no longer read as a single-element hit. The 5
  pins in `canvas-interaction.unit.test.ts:26` were rewritten and a sixth pins
  `.or()` as a union.

`data-testid="reposition-hint-text"` went in alongside it, replacing the two
`getByText('Drag or resize on canvas')` lookups in `select-move.spec.ts`.

**Not asked for, and worth knowing — the visual-regression gate was void.**
`visual-regression.spec.ts` gated the record-vs-compare branch on
`if (testInfo.config.updateSnapshots)`, but Playwright's default for that option is
the string `'missing'`, which is truthy. Every run re-recorded the committed baseline
and returned before `compareScreenshots`, so all 7 comparison formats were a no-op
that reported success. It was invisible because re-encoding the same export produced
byte-identical files. Now `=== 'all'`, so a green run means the pixels matched. The
helper unit suite and this file both cited "the baselines match" as a verified fact;
it had never been established by any run.

## 3. Pipeline work

- **The `e2e` CI job still cannot fail, and the reason it could not is now gone.**
  It is `continue-on-error: true`, which makes "everything is broken" and "all green"
  both report success. That was acceptable while 2–4 tests failed for documented
  reasons; it is not now, because a blocking job is achievable and the job is
  currently blind either way. Flipping it is a workflow decision that belongs to the
  operator, so it has not been flipped here. Two things to settle first: a headed run
  to confirm the CDP fix outside the one configuration this host produces, and
  whether the baselines should come from a production build.
- **CI never runs the suite against a production build.** `playwright.config.ts`
  starts `npm run dev`, and the `ci` job's `Build` step is never exercised by the
  e2e suite. So nothing verifies `dist/` works, and the visual-regression baselines
  are only ever compared against a Vite dev server. Serving `dist/` via
  `npm run preview` would need a `webServer.command` switch, and would be a
  possible baseline-affecting change.
- **Pre-commit does not run the e2e unit tests.** `.husky/pre-commit` runs
  `lint-staged` then `npm run tsc`. An e2e helper change gets type-checked but no
  local test feedback; only the `e2e-unit` CI job catches it. The suite runs in
  ~660 ms, so adding `npm run test:e2e:unit` is cheap. Left alone deliberately:
  it changes the local commit path, which is a workflow decision.
- **lint-staged only covers `*.{ts,tsx}`.** The e2e docs, root `README.md` and the
  workflow YAML are not formatted or linted at commit time. CI's
  `prettier --check .` does catch them, but only in CI. Adding
  `"*.{md,yml,yaml,json}"` to `lint-staged` would match what `lint:check` enforces.
- **No Playwright browser cache in the `e2e` job.** `playwright install --with-deps
chrome` runs on every build. `actions/cache` on `~/.cache/ms-playwright` would
  cut a few minutes per run.
- **e2e helper coverage is never produced in CI.** `test:e2e:unit:coverage` exists
  as a script but no job calls it.
- **`concurrency` and `permissions: contents: read` were added to the workflow in
  this cleanup.** They were not present before; no job needs write access.

## 4. Carried-over debt in the imported code

`OPEN_PROBLEMS.md` is the authoritative list with line numbers. The migration
specifics worth calling out:

- **~18 `no-shadow` / `no-explicit-any` eslint warnings** in the imported specs.
  `src/` has zero, so this is a regression against the repo's own bar. They are
  warnings, not errors, and were left rather than churning ported test code.
- **Reformatted to this repo's Prettier style.** The source repo had no
  `.prettierrc`, so its code used Prettier defaults (double quotes, 80 columns).
  Everything under `e2e/` was reformatted to the repo's config (single quotes, 120
  columns). Any file added to `e2e/` later must be run through `npm run format` or
  `lint:check` will fail.
- **8 lines of Russian comments across 6 spec files** (`color.spec.ts`,
  `example.spec.ts`, `layers.spec.ts`, `levels.spec.ts` ×2, `select-move.spec.ts`,
  `viewport-drawing.spec.ts`), carried over verbatim. Everything else in the repo
  is English. Not translated, because editing ported test comments is churn
  without functional value — but it is inconsistent.
- **`expectCanvasToMatch` is dead code** (`image-comparison.ts:99`) with a P1 defect
  in its defaults: a trailing `...options` spread overwrites the `??` defaults, so a
  caller passing `maxDiffPixels: undefined` gets Playwright's default of `0`. Zero
  call sites outside its own unit test, so the failure cannot occur today. Delete it
  or fix it; `compareScreenshots` is what the visual-regression spec actually uses
  and does not have the bug.
- **10 orphaned committed baselines, ~2.1 MB** (8 raw exports, plus
  `drawing-icon.ico.png` and `source-baseline.png`). Nothing reads them. Left in
  place because deleting committed baselines was not authorized. `drawing.bmp`
  alone is 1.92 MB.
- **`exportAndVerify` ignores its `testInfo` argument** (`export/helpers.ts:153`).
  `tsconfig.e2e.json` sets `noUnusedParameters: false` specifically so this and
  `expectCanvasToMatch`'s unread `page` survive `tsc -b`. Once the dead code above
  is removed, both can be deleted and the setting turned back on.

## 5. Repository housekeeping

- **The source repository still exists** at `/Users/bkalynovskyi/ps-playwright`
  and is untouched. It is now redundant. Archive or delete it, once someone has
  confirmed nothing is still being pulled from it.
- **`main` is unpushed** — 8 commits ahead of `origin/main`, including the whole
  e2e migration. `npm audit`, the `Test` step and the `e2e` job have therefore never
  actually run in CI against this tree.
- **`HANDOFF.md`** sits untracked in the repo root and is not gitignored, so a
  plain `git add -A` would commit it. Either gitignore it or move it.
- **Husky v9 deprecation.** `.husky/pre-commit` still uses the two-line
  `husky.sh` preamble, which prints a warning on every commit and **will fail in
  husky v10**. Pre-existing, unrelated to this migration, but it is a dated
  breakage that will block commits on upgrade.

## 6. Explicitly not attempted

- **One app-source change, made deliberately.** `data-testid="workspace-canvas"` in
  `src/components/Main/Main.tsx` and `data-testid="reposition-hint-text"` in
  `src/components/ToolbarsRight/Move/Reposition.tsx`, both landed with the helper
  change they unblock (see §2). The e2e commit itself left `src/` untouched; that
  is no longer true of the tree.
- **No rewriting of the imported test logic** beyond the mechanical minimum:
  type-only imports required by `verbatimModuleSyntax`, genuinely unused imports
  removed, and one `cause` added to satisfy `preserve-caught-error`. Behaviour is
  unchanged — except for the `getWorkspaceCanvas` selector, which is a deliberate
  behaviour change recorded in §2.
- **No baseline regeneration.** The 8 visual-regression specs pass against the
  committed baselines, so there was no need, and rewriting committed image data was
  not authorized. That claim rested on the void `updateSnapshots` check described in
  §2 — the spec was re-recording rather than comparing, so "passes against the
  committed baselines" was never tested. It is tested now, and they do match.
- **No `e2e` browser-job gating.** Left informational; see §3.
