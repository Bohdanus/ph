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
projects), the app suite (173/173 files), and the e2e helper unit tests (692 pass,
2 expected-fail). Nothing in this section should block other work.

## 2. The e2e suite is red and cannot be made a gate yet

4–6 of the 97 tests fail on the default headless run. Full detail, with
measurements, in `OPEN_PROBLEMS.md`.

| tests                                         | count | note                 |
| --------------------------------------------- | ----- | -------------------- |
| `cdp-helpers.spec.ts:220, 239`                | 2     | headless-only        |
| `cdp-helpers.spec.ts:113 :129 :146 :163 :195` | 5     | headed-only          |
| `levels.spec.ts:64, 109`                      | 2     | both modes           |
| `sidebar-keyboard.spec.ts:77, 89`             | 0–2   | 4 of 5 runs headless |

**Next actions, highest value first:**

1. **CDP capture multiplier** (`cdp-helpers.ts:35-40`). The helper's comment
   asserts the result is `clip_size × clip.scale × deviceScaleFactor`; measurement
   contradicts it, and the multiplier is a deterministic function of browser mode
   rather than the emulated ratio. Root cause unknown. Fix direction: assert against
   the decoded image's own dimensions instead of `window.devicePixelRatio`, which is
   already how `screenshotBoundsToCss` and `screenshot-scale.ts` derive scale.
   Correcting the comment is worthwhile on its own even before the fix.
2. **`getWorkspaceCanvas`** (`canvas-helpers.ts:173`, the `.or()` on `:174`). Needs
   `data-testid="workspace-canvas"` on the workspace canvas in
   `src/components/Main/Main.tsx` — **and** that alone is not enough: `.or()` is a
   union, so adding the testid turns a silent wrong-element lookup into a strict-mode
   violation. All three of the following are needed together:
   - the testid in `src/` (the only change this suite would make to app code),
   - `getWorkspaceCanvas` changed to express real priority (it is synchronous and
     returns a `Locator`, so it cannot await; `.first()` is wrong because the
     colour-picker preview canvas precedes `main` in the document),
   - `resolveFakeLocator` (`canvas-helpers.fixtures.ts:181`) changed to stop
     discarding all but the first match, plus the 5 pinning tests in
     `canvas-interaction.unit.test.ts:26-51` updated.
   - `src/` is currently untouched by the e2e commit, deliberately.
3. **Flyout-close race** (`sidebar-keyboard.spec.ts:77, 89`). Enter closes the
   flyout asynchronously and the assertion can still see it open. Undiagnosed.
   `verifyPrimaryTool` in the first test would distinguish "never closed" from
   "closed late" — establish that first, then add the missing readiness assertion
   rather than a timeout.

## 3. Pipeline work

- **The `e2e` CI job cannot fail, so it cannot catch a regression.** It is
  `continue-on-error: true`, which makes "5 known failures" and "everything is
  broken" both report success. Real fix: capture the failing test list and compare
  it against a known-failures baseline, failing only on _new_ failures. That is
  what turns the job into a usable gate. Until then it is a dashboard, not a gate.
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
  as a script but no job calls it. Note it covers 6 of the 7 helper modules:
  `cdp-helpers.ts` has no vitest tests, only the Playwright spec.
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

- **No app-source changes.** `src/` is untouched by the e2e commit, including the
  one-line `data-testid` that the specs' helper says it expects. That was
  deliberate: it is a one-line change to production code, and it is only half a fix
  (see §2.2).
- **No rewriting of the imported test logic** beyond the mechanical minimum:
  type-only imports required by `verbatimModuleSyntax`, genuinely unused imports
  removed, and one `cause` added to satisfy `preserve-caught-error`. Behaviour is
  unchanged.
- **No baseline regeneration.** The 8 visual-regression specs pass against the
  committed baselines, so there was no need, and rewriting committed image data was
  not authorized.
- **No `e2e` browser-job gating.** Left informational; see §3.
