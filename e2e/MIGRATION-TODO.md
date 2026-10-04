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
projects), `npm run test`, and `npm run test:e2e:unit`. Nothing in this section
should block other work.

## 2. The e2e suite is now green

**Nothing fails** on the default headless run, reproduced across repeated full
runs. Both items this section used to list as open are fixed, and so is the
`levels.spec.ts` pair. Each was fixed by changing an assertion or a wait, never by
loosening a threshold, adding a skip, or re-recording a baseline. Evidence, including
the measurements that established each defect and the mutation tests that prove the
fixes, is in `OPEN_PROBLEMS.md`.

| formerly failing tests                                                                                                        | was                                     | now                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| `cdp-helpers.spec.ts`                                                                                                         | 2 headless, 5 headed, disjoint per mode | capture scale no longer asserted; mode-independent |
| `sidebar-keyboard.spec.ts` — its `Enter activates focused flyout item` and `full keyboard flow: open, navigate, select` tests | 0–2, 5 of 12 measured headless runs     | root-caused to an rAF focus race, then awaited     |
| `levels.spec.ts` — its `changes red line via brightness` and `changes red line via contrast` tests                            | 2, both modes                           | canvas located by test id, not document order      |

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
  pins in the `describe('getWorkspaceCanvas')` block of
  `e2e/helpers/__tests__/canvas-interaction.unit.test.ts` were rewritten and a
  sixth, in that file's `describe('Locator.or')` block, pins `.or()` as a union.

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

- **CI never runs the suite against a production build.** `playwright.config.ts`
  starts `npm run dev`, and the `ci` job's `Build` step is never exercised by the
  e2e suite. So nothing verifies `dist/` works, and the visual-regression baselines
  are only ever compared against a Vite dev server. Serving `dist/` via
  `npm run preview` would need a `webServer.command` switch, and would be a
  possible baseline-affecting change.

## 4. Carried-over debt in the imported code

`OPEN_PROBLEMS.md` is the authoritative list with line numbers. The migration
specifics worth calling out:

- **Reformatted to this repo's Prettier style.** The source repo had no
  `.prettierrc`, so its code used Prettier defaults (double quotes, 80 columns).
  Everything under `e2e/` was reformatted to the repo's config (single quotes, 120
  columns). Any file added to `e2e/` later must be run through `npm run format` or
  `lint:check` will fail.
- **10 orphaned committed baselines, 1.96 MB** (8 raw exports, plus
  `drawing-icon.ico.png` and `source-baseline.png`). Nothing reads them. Left in
  place because deleting committed baselines was not authorized. `drawing.bmp`
  alone is 1.92 MB; the whole snapshot directory is 2.05 MB, the 1.96 MB here
  being these ten of the seventeen files.

## 5. Repository housekeeping

- **The source repository still exists** at `/Users/bkalynovskyi/ps-playwright`
  and is untouched. It is now redundant. Archive or delete it, once someone has
  confirmed nothing is still being pulled from it.
- **CI has not run against recent `main`** — the gap between `origin/main` and the
  tip decides it, and that gap changes on every push, so this document does not
  record it as fact. Check `git log --oneline origin/main..main | wc -l`; while
  that is non-zero, `npm audit`, the `Test` step and the `e2e` job have not run
  against the tip, so no gate below should be read as proven.
- **`HANDOFF.md`** is tracked in the repo root, so it ships with the code. Keep it
  that way, and keep it problem-focused: an entry that has been fixed and verified
  is deleted rather than reworded into a closed note.

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
- **No baseline regeneration.** The visual-regression specs pass against the
  committed baselines, so there was no need, and rewriting committed image data was
  not authorized. That claim rested on the void `updateSnapshots` check described in
  §2 — the spec was re-recording rather than comparing, so "passes against the
  committed baselines" was never tested. It is tested now, and they do match.
- **The `e2e` browser job gates.** It is no longer `continue-on-error`; the
  justification for that was the failing set recorded in §2, and that set is empty.
