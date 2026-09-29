# The app unit suite has an uncaptured intermittent failure, and the pool makes it unnameable as observed

**Status: OPEN. Not hunted. Not reproduced. No test name was ever captured.**
**Rule for this document: it is a hunting ground, not a changelog. Do not close it by re-running the suite and getting green.**

## 1. What was actually observed

During gate-timing measurements on 2026-09-28, a scoped test run reported:

```
Tests  1 failed | 2668 passed | 27 expected fail (2696)
```

against the file set selected by `vitest related src/util/draw.ts` — 115 of the
repository's 180 app test files. The same command, run 8 further times, was green
every time. The failing test's name, file, and assertion were never captured,
because the run that produced the summary was not one anybody was reading.

Nothing else about it is known. There is no stack trace, no seed, no ratio. What
is known is that it happened once, in a run of this repository's own tests, and
that nobody can say today whether it still happens.

## 2. Why this is not a dismissed flake

Three reasons, in order of weight.

**It was inside a gate, not a background job.** At the time of the observation,
that scoped run was `test:staged`, the last step of `.husky/pre-commit`. A
non-deterministic failure inside a commit gate is the single most corrosive
defect a test suite can have, because its whole effect is to teach the operator
that the gate is unreliable — and a gate that is `--no-verify`'d takes every
other step in it down too, including the deterministic and cheap ones. A flaky
test in CI is a nuisance. The same test in the commit path is a reason to delete
the commit path. The same test in a command nobody is required to run is just a
bug in that command's output.

**One observation in a scheduling-dependent runner is a rate, not a data point.**
`vitest.config.ts:6-9` sets `pool: 'vmThreads'`, `maxWorkers: 4`,
`isolate: true`. That is a deliberate choice for speed and it is a real source of
order- and timing-dependence: work is distributed across 4 worker threads, and
which test files share a worker, in what order, and with what contention depends
on the machine's load at the moment of the run. A run that is green at 09:00 and
red at 09:03 on an unchanged tree is the expected behaviour of a shared-machine
pool, not a surprise. Which means: **eight green re-runs is not evidence of
absence.** If the rate is, say, 1-in-10 full runs, then 8 clean samples is
roughly a coin flip and proves nothing at all.

**The one thing that would make it nameable was thrown away.** Vitest reports
the failing test's full name and stack in the same summary that reports the
counts. The counts were transcribed into two different session reports; the
names were not. Any future sighting must capture the name _first_ and the
counts _second_, in the same breath, before any other command runs. If a run
fails and you are about to re-run it, re-running is destroying the only evidence
you will ever have of it.

## 3. What changed since, and what it does and does not settle

`test:staged` still exists and still produces the same scoped run; what changed
is that it is **no longer a gate**. It was taken out of `.husky/pre-commit` in
the change that fixed the worktree hook gap, because its cost is a function of a
file's fan-in across the test suite rather than of the change — about 5% of the
suite for a hook, a util or a component, 44% for `src/contexts/StoreContext.tsx`,
64% for `src/util/draw.ts`, and all of them for `src/test/setup.ts`. It is now a
documented command to run when you want the fast scoped pass. See AGENTS.md,
"`test:staged` is a command, not a gate".

That removes the _exposure_: there is no longer a fan-out run inside a commit
gate, so there is no longer a scoped run standing between a developer and their
commit, failing at random and teaching them that the gate lies. It does **not**
remove the _condition_, and it does not make this entry closed — a scoped run is
still one `npm run test:staged` away. The same
`vmThreads` pool, the same 4 workers, the same shared machine, still runs the
full suite in three places:

| where      | command                      | who runs it                                    |
| ---------- | ---------------------------- | ---------------------------------------------- |
| `pre-push` | `npm run test`               | `gate:push`, once per push                     |
| `ci` job   | `npm run test -- --coverage` | GitHub Actions, on every push and PR to `main` |
| on demand  | `npm run test`               | anyone, any time                               |

The full suite has been observed green repeatedly — 180/180 files, 4142 passed,
34 expected-fail, across at least seven separate full runs on 2026-09-28, exit 0
every time. (Those counts are what the suite held that day; the suite has grown
since. The seven green runs are the point, not the numbers.) That is a much larger sample than the 8 that was dismissed earlier,
and it is evidence that the full-suite failure rate is low. It is not evidence
that it is zero, and the coverage run in CI is a _different_ execution again
(instrumented, slower, different timing), so it is not the same sample either.

**The honest position: the specific observation is now historical, and the class
of defect is still uninvestigated.** Closing this document because the code path
that reported it was deleted would be closing it for the wrong reason.

## 4. Why `src/util/draw.ts` is a place worth staring at

The observation came from the file set that `src/util/draw.ts` fans out to, which
is the widest in the repository — around 60% of the suite. Two reasons that is not
a coincidence:

- A wide fan-out means the run contains most of the suite, so it has the largest
  exposure window of any scoped run that could exist. Whatever the flake is, a
  run over 60% of the suite is the most likely place to meet it.
- `draw.ts` is imported by the drawing and shape tool areas, the layer
  compositing path, and the export path, and it is covered by
  `pool: 'vmThreads'`. Drawing code in jsdom is the part of this suite most
  likely to depend on a resolved `ImageData` buffer, a `createImageBitmap`
  promise, or a `requestAnimationFrame` tick — the three things `src/test/setup.ts`
  polyfills. Those are the classic sources of order-dependence.

That is a lead, not a conclusion. It has not been tested.

## 5. How to hunt it

A hunt is worth running only if it can capture a name. Design it around that.

**Step 1 — decide the target surface first.** There are two, and they are not
equivalent:

- _Full suite._ Run `npm run test` in a loop. This is the surface that matters
  for `gate:push` and CI. It is also the slowest per iteration and the one least
  likely to reproduce a scoped-only failure, if the failure turns out to depend
  on a smaller file set.
- _Scoped set._ Run `npx vitest related src/util/draw.ts --run` in a loop. This
  is a superset of the original observation, so it is the surface most likely to
  reproduce it — and it is no longer part of any gate, so it can be run as
  aggressively as needed.

Start with the scoped set, because it is where the evidence came from. Fall back
to the full suite only if the scoped set comes back clean for a long time.

**Step 2 — capture on first failure, mechanically.** Do not read counts. Pipe
the output somewhere durable _before_ deciding anything:

```sh
# in a worktree, with a local install so the run is not resolving upward
npx vitest related src/util/draw.ts --run 2>&1 | tee -a /tmp/vitest-flake.log
```

Then, on the first non-zero exit, stop and extract:

- the failing file path
- the full test name, including the `describe` chain
- the assertion message and the first stack frame in the repo's own source
- the run's wall clock and whether the machine was otherwise busy

`tee` is the point. Re-running on sight destroys the evidence, and the evidence
is the entire deliverable.

**Step 3 — bound the loop honestly.** Before starting, write down the iteration
count, and treat that number as the sample size when you report. "Ran it 8 times
and it passed" is only meaningful if 8 is enough to have a reasonable chance of
hitting a 1-in-N failure. If N is unknown, the run is exploratory and its result
must be reported as exploratory.

**Step 4 — once named, it becomes an ordinary defect, in THIS file.** A named
intermittent failure is a bug with a location, and it is fixed at the cause, not
by retrying — but it stays in `TEST-FLAKES.md`, because that is where
`AGENTS.md` routes anything about the runner, the pool or flakiness, and
`HANDOFF.md` is scoped to history/replay and document state. An earlier revision
of this step said `HANDOFF.md`, which would have misrouted this very entry and
every named flake after it. `test.retry` is a prohibition here, exactly as a
raised threshold is a prohibition: it converts a real failure into a green run
and destroys the only signal that the defect existed.

## 6. What not to conclude

- **Not** "it was the pool, therefore it is not a real bug." The pool is why it
  is _hard to see_, not why it is _harmless_. An order-dependent test that fails
  on a busy machine will fail a CI runner under memory pressure, and it will fail
  an operator's `npm run test` on the same machine that is currently green.
- **Not** "`isolate: true` is set, so files cannot interfere." `isolate: true`
  gives each test _file_ a fresh environment. It says nothing about timers,
  pending promises, unresolved `createImageBitmap` work, or module-level state
  in the pool's own worker threads, all of which outlive a file.
- **Not** "the full suite is green, so the subset flake was an artifact."
  Different file set, different worker assignment, different timing. A test can
  be green in 7 full runs and red in 1 scoped run; both are consistent.
- **Not** "we removed the code path that reported it, so the problem is gone."
  See section 3. The reporting path is gone; the runner configuration is not.

## 7. A second, NAMED observation — `useFile.test.tsx` JPEG-quality save

**Status: OPEN. Named, not reproduced. Four recorded full-run failures across three checkouts, and never once in isolation.**

This one is worth separating from section 1, because unlike it the failing test
was captured:

```
FAIL  src/contexts/__tests__/useFile.test.tsx > FileProvider PSD integration
      > passes JPEG quality through to raster encoding and resolves the save details
 Test Files  1 failed | 197 passed (198)
      Tests  1 failed | 4512 passed | 34 expected fail (4547)
```

Observed 2026-09-28, in a full `npm run test` on branch
`fix/handoff-2026-09-28`. It has **not** reproduced on demand: the same file
passes in isolation, and six further consecutive full runs were green (198/198
files, 4513 passed, 34 expected fail). It then **recurred** during the rebase
onto the responsive tranche, so the honest tally was **two** failures in roughly
fifteen full runs, not one in seven. A **third** appeared on 2026-09-28 on
`integration/e2e-campaign-final`, again only in a full run and again passing
2/2 in isolation immediately afterwards. The assertion text was not captured on
any occasion — only the test name — so the difference from section 1 is the
name and a third data point, not a diagnosis.

**What the three occurrences have in common, now that there are three.** Every
one was a full `npm run test` with several agents running Playwright elsewhere
on the machine, and every one passed in isolation within seconds. That is
consistent with the `vmThreads` pool reading timing-sensitive state under CPU
contention rather than with anything in the change, which is why section 6's
"not the pool" caveat and this entry have to be read together: the pool is a
real mechanism, and so is a genuinely unresolved save pipeline, and three
occurrences do not separate them. What would: capturing the assertion text.
Capture it next time and this becomes diagnosable in one run.

**The two accounts of the third report may be one event reported twice.** The campaign branch and
`docs/review-findings-2026-09-28` are not ancestors of one another (merge base `3e52b4e`), which is
why the tally cannot be pinned from the branches alone: nothing in either branch's history
distinguishes the runs, and neither run's log was kept. Until one of them produces a captured
assertion, **four and three are both consistent with what is recorded**, and the difference does not
change the hunt. What does change the hunt is the fourth report, because it is the one that lands on
the lead below.

**The report that matters, because it lands on the lead below.** It
**The third occurrence is the one that matters, and it lands on the lead below.** It
recurred on `docs/review-findings-2026-09-28` in the run immediately after that branch
extracted the dialog focus-ownership block out of `SaveDialog.tsx` into
`src/hooks/useDialogFocusContainment.ts` — the one file in this test's import graph
that either branch has changed. Before that extraction the tally was two; after it,
three. **That is a correlation across two branches, not a cause**, and it is the
cheapest thing to test next: revert the extraction's mount effect alone, run the full
suite in a loop, and see whether the third occurrence goes away. Do not run a scoped
loop and conclude anything from it — section 6 forbids inferring from a scoped green
for a failure observed in a full run.

**Do not close it as "the pool".** Two things make this one worth keeping
open, and neither is the pool:

1. **The test's subject is an asynchronous save pipeline** — file handle, raster
   encoding, quality threading, promise resolution — which is exactly the shape
   section 6 warns about: unresolved work that outlives the file. The same
   section's "Not `isolate: true`, so files cannot interfere" applies directly.
2. **The encoder is NOT in this test's execution graph, and an earlier
   revision of this entry said it was.** It blamed a pixel-budget refusal newly
   added to `encodeAvif`, and described that refusal as positioned after
   `getCanvasImageData` when it is positioned before. Both wrong.
   `useFile.test.tsx:8-12` mocks `../image-load-save-utils.ts` wholesale, so
   `saveImageToDisk` is a bare `vi.fn()`; `encodeAvif` is reachable only through
   the dynamic `await import('./avif-utils.ts')` inside that module, which never
   executes. `avif-utils.ts` and `raster-utils.ts` are not reachable from that
   test at all. **Two of the three candidate causes for this failure are gone,
   and the third is weaker than it looked.**
3. **What the branch actually changed under this test is `SaveDialog.tsx`, and
   it changed focus.** `git diff 80eb207 --stat` on `useFile.test.tsx`,
   `useFile.tsx` and `image-load-save-utils.ts` is **empty** — the test and the
   whole save path beneath it are untouched. The only files inside this test's
   import graph that either branch has changed are the component itself and, since
   `a30c318`, the hook its focus block moved into. That hook's mount effect calls
   `.focus()` synchronously and its cleanup calls `previouslyFocused?.focus?.()`,
   and both dispatch `focusin`/`focusout` — the events React 19 backs
   `onFocus`/`onBlur` with — from inside a promise continuation. **That is a lead,
   not a conclusion**, and it is recorded as one.
4. **`retireUnreferenced` is structurally ruled out.** The test renders
   `<FileProvider>` with no `StoreProvider`, and its save input is a detached
   `document.createElement('canvas')` with `layers: {}`. A raster in no
   published set can never be a retirement candidate, and the save it performs is
   a `vi.fn()` that never reaches an encoder. Struck from the hunt rather than
   left open.

To hunt it, cheapest first: loop the single file
(`npx vitest --run src/contexts/__tests__/useFile.test.tsx`) to get a cheap
partial sample, then widen to the full suite — `npm run test 2>&1 | tee
/tmp/full-$i.log` — which is the only reproduction-capable loop, because the
failure was observed in a full run and section 6 forbids inferring from a scoped
green. **Capture the assertion, not just the test name**, and record whether it
was a timeout or a value mismatch: a timeout points at the focus/async
interaction in 3, a value mismatch points at ordering.

## 8. A third, NAMED observation — the paint-bucket contiguous test, once, in a full headless run

**Status: OPEN. Named, not reproduced. One failure in three reproduction attempts.**

```
  1 failed
    e2e/erase-fill-eyedropper.spec.ts:438
      > Eraser, fill tools and eyedropper
      > the paint bucket fills a contiguous region and not its neighbour
  Error: Canvas did not render the #cc0000 line within 10000ms
    at helpers/canvas-helpers.ts:536
    at waitForCanvasPixels (e2e/helpers/canvas-helpers.ts:536)
    at drawSlab (e2e/erase-fill-eyedropper.spec.ts:233)
    at e2e/erase-fill-eyedropper.spec.ts:441
```

Observed 2026-09-28 on `main` at `cc7b647`, in a full headless `npx playwright test`
reporting `182 passed, 1 failed, 2 skipped` (185 total). The line numbers in that
quote are `cc7b647`'s; on the branch that hardened the failure path the same
anchors are the test declaration at `:487`, `drawSlab` at `:245` and the pixel
wait at `:282`. `canvas-helpers.ts:536` is unchanged by that work.

**That run was not a clean run, and that is the single most useful thing known
about it.** It was produced by the e2e orchestrator with six other agents running
Playwright concurrently on the same host (board post `main`, "Status of the
takeover"), which also recorded the prediction that this flake and the flyout
long-press one "both surface under CPU contention" and that a failure reported by
a subagent is "very likely contention, not a regression". Every reproduction
attempt below was made with nothing else running, and every one was green. **The
difference between the two experiments is the contention, not the code.** A full
suite under deliberate CPU load is the one experiment that would settle it.

**That experiment has now been run, and the flake recurred — at a DIFFERENT
assertion than the one this section records.** On 2026-09-28, a serial full-suite
run on `integration/e2e-campaign-final` at `210ace6`, on a host with other agents
running Playwright, reported 291 passed, 2 skipped and this test failed. The
recovered `playwright-report/data/` artifact for the failure names the wait that
gave up:

```
Error: the blank base layer to be composed
Timeout 5000ms exceeded while waiting on the predicate
  at e2e/erase-fill-eyedropper.spec.ts:146-148   (inside openWorkspace)
```

So the failure is in the test's FIRST act, before `drawSlab` is ever called, and
it is the seed's composition poll running out of its default 5s budget — not the
`Canvas did not render the #cc0000 line within 10000ms` at `drawSlab` that the
observation above records. The refused-commit mechanism below cannot be what
happened, and on this tree it cannot be produced at all: `drawSlab` now asserts
the commit first (`erase-fill-eyedropper.spec.ts:277-280`), so a refused commit
names itself as a `toBeEnabled()` failure on the undo button instead of
surfacing later as a bare pixel timeout. The page snapshot at failure showed the
document WAS published (a `Blank 1` Layers row, a `new layer` History row, undo
and redo disabled) while the pixel poll never returned — which is the
readiness-budget class of section 9, not a paint-bucket defect.

**It still does not reproduce.** Attempts after that run, all headless on the
same tree with the port pinned and server reuse off:

| attempt                                                 | result                       |
| ------------------------------------------------------- | ---------------------------- |
| the test alone, `--repeat-each=5`                       | `5 passed` (24.4s)           |
| the whole `erase-fill-eyedropper.spec.ts`               | `10 passed` (23.6s)          |
| the test alone, `--repeat-each=20` under 10 CPU burners | `20 passed` (3.6m), 3.3-8.1s |
| the test alone, 3 cold-Vite runs under 10 CPU burners   | `3 passed`                   |

So the entry stays OPEN and its class is unchanged — intermittent, load-sensitive,
never reproduced on demand — but **both the mechanism and the error signature
recorded here are stale for this tree**, and the next hunter should start at
`openWorkspace`'s 5s composition poll rather than at the Draw commit. Nothing
here is closed: the specific 5s-budget exhaustion is still unexplained, and
`readPixel` returning null a hundred times in a row on a document the snapshot
shows as published is not something the reproduction attempts above can answer.

**It did not reproduce again.** Attempts, all on `cc7b647` in a dedicated worktree
with `PLAYWRIGHT_PORT=5711` and `reuseExistingServer` off, all headless:

| attempt                                                 | result                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| full suite (`npx playwright test`)                      | `183 passed, 2 skipped`                                        |
| `e2e/erase-fill-eyedropper.spec.ts --repeat-each=5`     | `50 passed`                                                    |
| the failing test body, instrumented, `--repeat-each=60` | 0 failures in the 20 that completed before the run was stopped |

**Two properties of the observation that the hunt must not assume away.**

1. **It is not a cross-test state leak, and the "7 tests in one worker" shape is
   the wrong frame.** The file declares **10** tests, not 7, and the failing one is
   the 6th. Every test gets a fresh `BrowserContext`, the app persists nothing but
   the theme (`src/contexts/ThemeContext.tsx:14,28` is the only `localStorage`
   write in `src/`), and the document starts `uninitialized` on every load
   (`src/contexts/StoreContext.tsx:297,307,315,317`). **A leaked marquee, layer,
   zoom or tool is impossible across tests here**, and the failing test's first act
   is `openWorkspace`, before any of its own state exists.
2. **It is not the 440px scroll that `preservingScroll` exists to undo.** Measured
   on this tree at 1280x720: `document.documentElement.scrollHeight` is **720**,
   equal to `innerHeight`, and `window.scrollY` was **0** at every step of the
   failing test's setup. The overflow that made the page 1177px tall was fixed by
   `min-h-0 overflow-y-auto` on the `<aside>` (`src/components/SidebarLeft/SidebarLeft.tsx:564`);
   the canvas box is a constant `108,100 922x583` from tool click to capture. The
   1177px/440px figures in `e2e/helpers/screenshot-scale.ts:53`,
   `e2e/helpers/cdp-helpers.ts:60`, `e2e/helpers/toolbar-helpers.ts:102-108` and
   four unit-test comments now describe a layout this build does not produce.
   **They are stale, not load-bearing, and correcting them is its own change.**

**What the failure therefore is, and is not.** `hasRedPixels`
(`e2e/helpers/canvas-helpers.ts:473`) wants `red > 180, green < 100,
blue < 100` anywhere in a 360x140 capture that certainly contains the line. The
line is composited over an opaque white base, so its red channel is **204 at full
opacity and higher at any lower opacity** — the Draw tool's `Opacity` slider
cannot push it under the threshold, and `drawSlab` pins that slider to 1 anyway.
**The threshold is not defeatable and is not the cause.** The capture also lands
wholly inside the viewport at `x 228..588, y 230..370` against a 1280x720 window,
and no entry in `e2e/OPEN_PROBLEMS.md` records a viewport-edge truncation —
the capture is simply inside the window, so the hazard does not apply. What is left is the only remaining reading: **the stroke never reached the
composite**, and every action in `drawSlab` reported success while it did not.

**The two candidate mechanisms, neither demonstrated.**

- A **refused commit**. The Draw tool commits from `handlePointerUp` and nowhere
  else (`src/components/Main/DrawToolArea.tsx:110-143`), and it is reached only
  when `isPointerUpValid` agrees, which refuses a non-primary button or a foreign
  pointer id (`src/hooks/usePointerPosition.ts:221,223`) and refuses a second
  press while one is live (`:198`). A refusal produces no layer, no history entry
  and no log. See `HANDOFF.md` §66 — that silence is recorded there as a
  document-state defect in its own right, independently of this flake.
- A **commit the seed overwrote**. The store has no document until the seeding
  `REPLACE_DOCUMENT` lands (`src/hooks/useApp.ts:77-80` ->
  `src/contexts/useLayer.ts:214-230` -> `:174-199`), and a tool layer is appended
  with `COMMIT_DOCUMENT_EDIT` against the `layers` its render closure captured
  (`src/contexts/useLayer.ts:174,201-207`). **Weakened, not eliminated:** an
  instrumented copy of the real `openWorkspace` measured its own pixel poll
  satisfied on its **first** attempt on 20 of 20 runs, 42-154 ms after `goto`
  resolved, so the old gate did return before it had established that a document
  existed. That gate is now fixed and proved by a committed assertion — see below —
  but no run of the fixed tree has yet failed either, so it is **not** evidence
  that this was the cause.

**The fixed half, and the tripwire that replaces the ambiguity.** `openWorkspace`
waited on `readPixel(...) not.toBeNull()` and claimed to wait for the seeded base
layer. It did not: `readPixel` calls `getColorAtPoint(image, x, y, 0)` with no
`ignoreNearWhite`, and that returns `null` only for an out-of-capture point or a
fully transparent one (`e2e/helpers/canvas-helpers.ts:718`) — **a white pixel
satisfied it**, so the poll only asserted that a screenshot was non-empty. It now
additionally waits for the seeded `Blank 1` row to be in the Layers panel, read by
name, which is a fact about the document rather than about a capture. And `drawSlab`
now asserts the stroke **committed** — `undo` is disabled on a seeded document and
enabled after the append — _before_ it polls for pixels, so a refused commit names
itself in the default expect timeout instead of surfacing ten seconds later as a
bare `Canvas did not render … within 10000ms` from `canvas-helpers.ts:577`.

**To hunt it, capture the artifact, not the name.** The single most valuable
change to a future report of this is the state at the moment the wait gives up:
`window.scrollY`, the canvas `boundingBox()`, `elementFromPoint` at the press
coordinate, whether `undo-button` is enabled, and a full-canvas red-pixel count.
`drawSlab` now fails on the commit assertion before that state is needed, so the
artifact to attach is the Playwright trace: run with `--retries=1` so
`trace: 'on-first-retry'` yields one, and read `test-results/`. Do **not** close
this by re-running the suite and getting green — that is the rule this file
already sets for section 1, and it applies here unchanged. A second observation,
with the assertion text and whether it was a timeout or a value mismatch, is
worth more than twenty green runs.

## 9. A fourth, NAMED observation — the first Playwright page loads in a cold checkout time out

This one is not a flake at all. It is deterministic, it reproduces on the first
run in a fresh checkout, and it is regularly misdiagnosed as a product defect in
whichever spec happened to run first.

`npm run test:e2e` starts Vite, and Vite transforms `src/` on first request. A
spec's `beforeEach` that does `await page.goto('/')` and then
`expect(canvas).toBeVisible()` is racing that transform against Playwright's
default 5s assertion budget. On a cold server the first several page loads lose.

Measured on clean main, `npx playwright test e2e/sidebar-flyout.spec.ts`:

| run               | result                                                       |
| ----------------- | ------------------------------------------------------------ |
| first, cold Vite  | 5 failed, 13 passed — every failure in the same `beforeEach` |
| second, warm Vite | 0 failed, 18 passed                                          |

Every one of the five failures was the identical assertion, on the identical
line, and none of them was a flyout assertion:

```
Error: expect(locator).toBeVisible() failed
Locator: getByTestId('workspace-canvas')
Error: element(s) not found          # 5s budget, e2e/sidebar-flyout.spec.ts:125
```

The diagnostic detail is the shape of it: the failures were **tests 1-6** — the
first page loads — while tests 7-19 ran the _same_ `beforeEach` and all passed.
On the warm re-run the same tests dropped from 8.9s to 2.0-3.2s. A defect in the
spec under test cannot select the first five tests and spare the next fourteen.

**This is why the flyout looked broken to several agents at once.** The clipping
fix had already landed in `dd92374`/`5c7cb73`, and the suite was green, but a cold
run put five red lines on the screen inside `sidebar-flyout.spec.ts`, and the
natural reading is that the flyout regressed. Two other worktrees
(`fix-flyout-hit`, `fix-flyout-longpress`) were started against that reading, and
both turned out to be re-deriving work main had already merged. The cost was
four branches and two unmerged patches for a defect that was never there.

Two things follow, and they are different:

1. **Warm the dev server before the first test.** A single request to the base URL
   in `e2e/global-setup.ts`, retried until it answers, pays Vite's transform cost
   once instead of once per early test. This belongs in the global setup rather
   than in any spec, because the failure is a property of the server, not of the
   spec that noticed it.
2. **Do not diagnose a Playwright failure from the spec it appeared in.** Read the
   failing line. A `beforeEach` failure is the harness, not the subject; and if the
   red tests are the first N in file order, suspect the server before the
   application.

Implemented, but not as (1) was written — see below. It was left alone for a while
so it would not ride in on a toolbar fix that did not need it.

**Implemented, against a different request than (1) describes.** `e2e/global-setup.ts`
now fetches the **module entry** (`index.html`'s `type="module"` `src`, read from the
file), not the base URL. A `GET /` would have been a no-op twice over: Playwright's
own `webServer` plugin has already made that request before `globalSetup` runs, and
Vite's transform middleware declines it anyway, so it walks none of the module graph.
It uses Node `fetch` rather than a browser — this file exists to stop an agent opening
a window, and a launch here would be invisible to the guard above — never throws, and
logs one line saying whether the warm-up happened.

**A wrong entry does not 404, and that shaped the whole implementation.** Verified
against a live Vite 8.3.0: a path no module lives at gets the SPA fallback, which
answers `200` with `content-type: text/html`, not a 404. So a success check on
`response.ok` alone reports "warmed the dev server" having transformed nothing, and
the log line is the misleading part. Success therefore requires an ok status **and** a
non-HTML content type, and the fallback answer ends the loop rather than being
retried into the same response. `404` and `410` are terminal on the same logic.

**The retry budget is a failure budget, not a work budget.** The server has already
answered `webServer.url` — that is what `playwright.config.ts`'s `webServer.timeout`
is for — so everything that reaches the loop is permanent: a wrong entry, a wrong
origin, or a connection that is not being made. At 250ms, a 5000ms budget is about
twenty attempts, enough to outlast a dependency pre-bundle, and a permanently wrong
entry cannot cost a minute of every run. The per-attempt abort is capped strictly
below that budget for the same reason: `AbortSignal.timeout(remaining)` hands attempt
1 the whole remainder, and a server that accepts the connection and then hangs
spends all of it there, after which the loop's own deadline check ends it without
ever retrying.

**It skips the documented remote workflow entirely.** `e2e/README.md` documents
`PLAYWRIGHT_BASE_URL=https://staging.example.com npm run test:e2e`, which moves the
project `use.baseURL` and leaves `webServer.url` on localhost. A warm-up aimed at
the base URL would ask staging for `/src/main.tsx`, which it does not serve. It
skips when the two origins differ rather than retargeting the web server, because in
a remote run the dev server is started and then ignored by every test, so retargeting
would pay a full cold transform to warm a server nothing requests.

**The failure the second half of this section warns about has a tripwire of its
own.** A module entry that resolved outside the base path — a sub-path `baseURL`, or
a `base` on the Vite config, of which there is none today — is a skip with a reason
rather than a request to the wrong origin, and an `index.html` whose `src` is not a
URL is a skip rather than a throw, because the one component whose contract is that
it never fails a run is not the place a malformed HTML file gets to fail one.

**How this composes with sections 10 and 11.** Every run starts a fresh server, which is
exactly the cold server this section is about: `npm run test:e2e` allocates a free port per run
and reuse is opt-in, so a warm server is now something you have to ask for. Sections 9, 10 and 11
are one family and three defects, not one defect three times: 9 is a server that is right and slow,
10 is the wrong server, 11 is the right server serving code you did not write.

## 10. An e2e mutation campaign run against someone else's dev server reported every mutation as green

**The trap, and it is now closed structurally.** `playwright.config.ts` used to set
`reuseExistingServer: false` only when `CI` or `PLAYWRIGHT_PORT` was set, so a bare
`npx playwright test` from a worktree under `.kilo/worktrees/` fell back to :5173 with reuse ON
and attached to whichever dev server got there first — which is another checkout. For an ordinary
green/red run that is the trap `docs/ORCHESTRATION.md` records under "Worktrees and dev servers":
"my change did nothing" is this, not a cache.

**Attaching to a server this run did not start is now impossible, not merely discouraged.**
`reuseExistingServer` in `playwright.config.ts` is a literal `false` with no environment variable,
no argument and no field that can turn it on; the dev server is started with `--strictPort`, so a
port taken after the run picked one is a startup FAILURE rather than Vite's silent hop; and
`scripts/e2e-run.mjs` — which every script that RUNS a suite goes through — allocates a port,
verifies it is still bindable immediately before starting, and records it to
`.kilo/e2e-last-run.json` so a run that fails later is diagnosable. It also **refuses**
`PLAYWRIGHT_REUSE_EXISTING_SERVER` outright and refuses `PLAYWRIGHT_BASE_URL` unless the run says
`E2E_ALLOW_REMOTE=1`, which it logs. The outcome is binary: a run gets a server it started, or it
is red. There is no third state in which the suite quietly tests a neighbour.

**The lock is not what fixed it, and that is the part worth remembering.** The wrapper also takes
a swarm lock (`e2e/.swarm-e2e-runner`) so two agents rarely run e2e at once, and that lock is
**advisory**: it is held as `e2e-run/<branch>/<pid>` because board identity is the branch and its
conflict test is `lock.agent_id !== who`, it is renewed by hand because the board never renews a
file lock, and a run that cannot get it — queue full, board unreachable, lease malformed — says so
and starts anyway. It costs scheduling and nothing else, because the guarantee is the port. An
earlier version made the lock load-bearing and exited 4 when it could not be had, which turned an
unenforceable mechanism into a hard block on a merge gate: it looked like a guarantee and was not
one. **Do not reintroduce that**: if a future change makes an e2e run refuse to start because of
the lock, the guarantee has been moved somewhere it cannot be kept.

**Why it is much worse for a mutation campaign.** A mutation campaign exists to answer "does this
assertion actually assert anything?", and the answer it produces is a green run. A run that never
executed the mutated code is indistinguishable from a test that cannot fail. Measured on
`e2e/undo-redo.spec.ts`: seven consecutive product mutations all "passed", and the cause was that
the driver ran without a port and had attached to a different worktree's dev server. Re-running with
`PLAYWRIGHT_PORT` set and the port pinned turned the same seven into seven real reds.

**The rule.** Run mutation campaigns through `npm run test:e2e`, and before trusting a green result
MUST confirm the served module actually contains the mutation — `curl` the mutated module off the
dev server and look for the change, rather than assuming the local worktree is what is being tested.
The port now guarantees you were served _this_ checkout; only this step guarantees it was served
_your edit_. A mutation campaign that reports "all green" has most likely measured nothing. Section
11 is the half of that check the port cannot buy you.

## 11. A mutation campaign that does not verify the SERVED module reports false verdicts

Section 10 is the coarse failure: a run attached to another checkout makes every mutation look
green. This is the fine one, and it survives that fix completely.

A dev server serves a TRANSFORMED module, not the file on disk. So a mutation that is
correct on disk can be absent from what the browser ran, and the test then reports the
pre-mutation behaviour. Measured on `e2e/document-dialogs.spec.ts`: of thirteen mutations,
**four verdicts were false** until the served module was fetched and inspected first. The
fix is cheap and the check is one request — read the module off the dev server and confirm
the mutation is in it before believing a green result.

**Two transforms that will silently defeat a marker.** Both bite only if the marker is
written in a form the transform removes, which is exactly what a hand-written mutation is:

- **Vite strips type annotations.** A marker planted as a type-level change never reaches
  the browser. Mutate a value.
- **esbuild rewrites numeric literals.** `0.5` is served as `.5`. A marker written as
  `=== 0.5` will not be found by a search for the original text, and a mutation asserting
  on the served text can miss its own marker.

A green mutation result is therefore evidence about the TEST only once it is evidence about
the CODE THAT RAN. That is the same discipline as section 10, one level down, and the two
compose: pinning the port stops the run testing the wrong tree, and verifying the served
module stops it testing the wrong code in the right tree.

## 12. `viewport-drawing.spec.ts` fails roughly one run in four, and not because of anything it asserts

**Status: OPEN, and now SKIPPED by declaration (2026-09-29, operator decision). Reproduced — 1 failure in 4 runs, and the failing case moves between `wide` and `narrow`. Not fixed. Not a known-failing test; it is intermittent.**

**The skip is a gate decision, not a fix, and it is not a waiver.** `e2e/viewport-drawing.spec.ts`
carries a `test.skip(true, …)` with the reason in it. It was skipped because the suite's contract is
that a default headless run has **zero** failures, and a test that is red one run in four makes
roughly a quarter of all unrelated merges look broken — which trains the response of ignoring the
gate, and costs more than this one test buys. A flaky assertion is also worse than no assertion: a
green result from it carries no information, so it cannot justify a change either. **Nothing about
the defect is waived; the work below is un-done and filed, and the skip is one line to remove.**

**Do not "fix" this by loosening anything.** Widening `ANTIALIASED_FLANGE_CSS_PX`, raising the
derived bound, or adding retries all treat a symptom whose mechanism is still unknown, and each of
them removes the only thing this test is currently good for — saying something true about the
viewport mapping when it passes.

`e2e/viewport-drawing.spec.ts` generates three cases from a
`{ name, width, height }` list (`normal` 1280×720, `wide` 1600×900, `narrow` 900×700). Each
draws a line at box-relative coordinates, resizes the window, captures the canvas through
CDP, and asserts with `expect.soft(...).toBeLessThan(25)` that the ink still sits under the
cursor. Observed on 2026-09-29 while running the full suite after an unrelated change: the
full run reported `2 skipped, 310 passed, 2 failed`, both failures in this file. Re-running
the file alone three more times gave **1 failure in 4 runs**, and the failing case was
`narrow` twice and `wide` once. A deterministic defect does not move between cases.

**It is not caused by the scrollbar change that was in the tree at the time, and that is
measured rather than argued.** Removing `scrollbar-none` from the rail's `<aside>` and
re-reading its geometry at 900×700 produced byte-identical values — `offsetWidth` 56,
`clientWidth` 55, `offsetHeight` 563, `clientHeight` 563, the same `getBoundingClientRect()`
for both the rail and `[data-testid="workspace-canvas"]` — with the computed `scrollbarWidth`
the only field that changed, `auto` against `none`. On a browser with zero-width overlay
scrollbars `scrollbar-width` has no layout effect, so nothing downstream of the rail can
move. `mobile-bottom-bar` and `mobile-tool-options` are `md:hidden` at all three of this
file's viewports.

So the mechanism is inside the test's own measurement chain, and the chain has three
places a run can lose: `waitForCanvasRedraw` polling `captureCanvasScreenshot` for ink,
`getDarkPixelBounds` thresholding that screenshot, and the 25px tolerance being applied to
a soft assertion. Nothing in it records which one gave. That is the same defect sections 1
and 8 describe for the unit suite — an uncaptured intermittent failure is a hunting ground,
not something to close by re-running until green.

**Exact remaining verification:** capture the failing run. `--retries=1` yields a trace
(`trace: 'on-first-retry'`, inert at the local `retries: 0`), and the trace plus
`test-results/` is the only artefact that can say whether the ink was absent, mis-thresholded
or mislocated. Until a failing run is captured, a fix here would be a guess.

## 13. Files

- `vitest.config.ts:6-9` — the pool configuration this is about
- `src/test/setup.ts` — the polyfills most likely to be involved
- `src/util/draw.ts` — the file whose import fan-out defined the observed set
- `src/contexts/__tests__/useFile.test.tsx` — the named failure in section 7
- `src/contexts/avif-utils.ts` — the encoder whose budget check changed nearby
- `.husky/pre-push` — where `npm run test` now runs
- `AGENTS.md`, "`test:staged` is a command, not a gate" — where it lives now, and what it costs
- `e2e/erase-fill-eyedropper.spec.ts` — the spec behind section 8, and the commit that hardened it
- `e2e/helpers/canvas-helpers.ts:473,577,718` — the predicate, the poll loop and the sampler
- `src/hooks/usePointerPosition.ts:194-198,214-223` — the validators whose refusal is silent
- `scripts/e2e-run.mjs` — the wrapper the scripts that RUN a suite route through
  (`test:e2e`, `:headed`, `:ui`, `:debug`, `:update-baselines`). Two independent things,
  and the distinction is the design: the **own-server guarantee** (pick a port, verify
  it bindable, refuse `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_REUSE_EXISTING_SERVER`) and
  the **advisory queue** (`e2e/.swarm-e2e-runner`, held as `e2e-run/<branch>/<pid>`,
  waited on but never fatal — a run that cannot have the queue runs anyway). Sections 10
  and 11 depend on the first and not at all on the second.
- `playwright.config.ts` — the `webServer` block, where `reuseExistingServer: false` is
  now unconditional and why, and the `--strictPort` that turns a lost port race into a
  startup failure instead of Vite's silent hop
- `e2e/viewport-drawing.spec.ts` — the spec behind section 12, and the `test.skip` that
  records the operator decision with its reason inline
- `scripts/__tests__/e2e-run.test.mjs` — the only coverage of the lock, including a
  test that reads the board as another agent while a suite is "running"
- `playwright.config.ts` — the `webServer` block, the now opt-in
  `reuseExistingServer` condition behind section 10, and why an explicit `PLAYWRIGHT_PORT`
  disables server reuse
- `e2e/document-dialogs.spec.ts` — the spec whose mutation method section 11 validates
- `e2e/undo-redo.spec.ts` — the spec whose mutation campaign section 10 invalidated
- `e2e/global-setup.ts` — where the warm-up in section 9 belongs; the budget and the
  per-attempt cap, the terminal statuses and the content-type gate, and the refusal
  that has to run before any of it
- `e2e/helpers/__tests__/global-setup.unit.test.ts` — the warm-up's only coverage. It
  sits under `e2e/helpers/` testing a module that is not a helper, because
  `vitest.e2e.config.ts` collects `e2e/**/__tests__/**/*.unit.test.ts` and this is
  where the project's other unit files already are; an earlier version of that file's
  own note justified the location by a coverage-report claim that was a
  non-sequitur, and it is recorded there as wrong rather than quietly replaced
- `e2e/sidebar-flyout.spec.ts:136-139` — the `beforeEach` that loses the race
- `e2e/flyout-longpress-race.spec.ts` — the committed tripwire for the long-press flyout race section 8 names as a CPU-contention flake, and for the misdiagnosis section 9 recounts
- `e2e/helpers/screenshot-scale.ts:53`, `e2e/helpers/cdp-helpers.ts:60` — the stale 1177px/440px
  figures section 8 records as stale
- `src/hooks/useDialogFocusContainment.ts` — where the focus block section 7's lead 3 names now lives
- `e2e/viewport-drawing.spec.ts:17,72-78` — the three generated cases, the CDP capture, and the
  `toBeLessThan(25)` soft assertions section 12 measures
- `e2e/viewport-drawing.spec.ts:1-15` — the `{ name, width, height }` list whose cases
  section 12 observed moving between runs
