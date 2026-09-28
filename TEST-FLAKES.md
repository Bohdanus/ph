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

**Status: OPEN. Named, not reproduced. Two failures in roughly fifteen full runs.**

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
onto the responsive tranche, so the honest tally is **two** failures in roughly
fifteen full runs, not one in seven. The assertion text was not captured on
either occasion — only the test name — so the difference from section 1 is the
name and a second data point, not a diagnosis.

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
   whole save path beneath it are untouched. The only file inside this test's
   import graph that changed is the component itself. Its new mount effect calls
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
suite under deliberate CPU load is the one experiment that would settle it; it
has not been run, and it is the first thing to try.

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
   (`src/contexts/StoreContext.tsx:296,304-306`). **A leaked marquee, layer,
   zoom or tool is impossible across tests here**, and the failing test's first act
   is `openWorkspace`, before any of its own state exists.
2. **It is not the 440px scroll that `preservingScroll` exists to undo.** Measured
   on this tree at 1280x720: `document.documentElement.scrollHeight` is **720**,
   equal to `innerHeight`, and `window.scrollY` was **0** at every step of the
   failing test's setup. The overflow that made the page 1177px tall was fixed by
   `min-h-0 overflow-y-auto` on the `<aside>` (`src/components/SidebarLeft/SidebarLeft.tsx:335`);
   the canvas box is a constant `108,100 922x583` from tool click to capture. The
   1177px/440px figures in `e2e/helpers/screenshot-scale.ts:53`,
   `e2e/helpers/cdp-helpers.ts:60`, `e2e/helpers/toolbar-helpers.ts:102-108` and
   four unit-test comments now describe a layout this build does not produce.
   **They are stale, not load-bearing, and correcting them is its own change.**

**What the failure therefore is, and is not.** `hasRedPixels`
(`e2e/helpers/canvas-helpers.ts:411-429`) wants `red > 180, green < 100,
blue < 100` anywhere in a 360x140 capture that certainly contains the line. The
line is composited over an opaque white base, so its red channel is **204 at full
opacity and higher at any lower opacity** — the Draw tool's `Opacity` slider
cannot push it under the threshold, and `drawSlab` pins that slider to 1 anyway.
**The threshold is not defeatable and is not the cause.** The capture also lands
wholly inside the viewport at `x 228..588, y 230..370` against a 1280x720 window,
so the viewport-edge truncation recorded at `e2e/OPEN_PROBLEMS.md:113` does not
apply. What is left is the only remaining reading: **the stroke never reached the
composite**, and every action in `drawSlab` reported success while it did not.

**The two candidate mechanisms, neither demonstrated.**

- A **refused commit**. The Draw tool commits from `handlePointerUp` and nowhere
  else (`src/components/Main/DrawToolArea.tsx:110-143`), and it is reached only
  when `isPointerUpValid` agrees, which refuses a non-primary button or a foreign
  pointer id (`src/hooks/usePointerPosition.ts:149,151`) and refuses a second
  press while one is live (`:126`). A refusal produces no layer, no history entry
  and no log. See `HANDOFF.md` §66 — that silence is recorded there as a
  document-state defect in its own right, independently of this flake.
- A **commit the seed overwrote**. The store has no document until the seeding
  `REPLACE_DOCUMENT` lands (`src/hooks/useApp.ts:77-80` ->
  `src/contexts/useLayer.ts:211-227` -> `:174-199`), and a tool layer is appended
  with `COMMIT_DOCUMENT_EDIT` against the `layers` its render closure captured
  (`src/contexts/useLayer.ts:201-207,292`). **Weakened, not eliminated:** an
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
fully transparent one (`e2e/helpers/canvas-helpers.ts:666,693`) — **a white pixel
satisfied it**, so the poll only asserted that a screenshot was non-empty. It now
additionally waits for the seeded `Blank 1` row to be in the Layers panel, read by
name, which is a fact about the document rather than about a capture. And `drawSlab`
now asserts the stroke **committed** — `undo` is disabled on a seeded document and
enabled after the append — _before_ it polls for pixels, so a refused commit names
itself in the default expect timeout instead of surfacing ten seconds later as a
bare `Canvas did not render … within 10000ms` from `canvas-helpers.ts:536`.

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

## 9. An e2e mutation campaign run without `PLAYWRIGHT_PORT` reports every mutation as green

**The trap.** `playwright.config.ts:118-120` sets `reuseExistingServer: false` only when `CI` or
`PLAYWRIGHT_PORT` is set. A bare `npx playwright test` from a worktree under `.kilo/worktrees/`
therefore falls back to :5173 with reuse ON, and attaches to whichever dev server got there first —
which is another checkout. For an ordinary green/red run this is the trap `AGENTS.md` already
records under "Worktrees and dev servers": "my change did nothing" is this, not a cache.

**Why it is much worse for a mutation campaign.** A mutation campaign exists to answer "does this
assertion actually assert anything?", and the answer it produces is a green run. A run that never
executed the mutated code is indistinguishable from a test that cannot fail. Measured on
`e2e/undo-redo.spec.ts`: seven consecutive product mutations all "passed", and the cause was that
the driver ran without a port and had attached to a different worktree's dev server. Re-running with
`PLAYWRIGHT_PORT` set and the port pinned turned the same seven into seven real reds.

**The rule.** Any agent verifying that an assertion bites MUST pin the port, and before trusting a
green result MUST confirm the served module actually contains the mutation — `curl` the mutated
module off the dev server and look for the change, rather than assuming the local worktree is what
is being tested. A mutation campaign that reports "all green" has most likely measured nothing.

## 10. Files

- `vitest.config.ts:6-9` — the pool configuration this is about
- `src/test/setup.ts` — the polyfills most likely to be involved
- `src/util/draw.ts` — the file whose import fan-out defined the observed set
- `src/contexts/__tests__/useFile.test.tsx` — the named failure in section 7
- `src/contexts/avif-utils.ts` — the encoder whose budget check changed nearby
- `.husky/pre-push` — where `npm run test` now runs
- `AGENTS.md`, "`test:staged` is a command, not a gate" — where it lives now, and what it costs
- `e2e/erase-fill-eyedropper.spec.ts` — the spec behind section 8, and the commit that hardened it
- `e2e/helpers/canvas-helpers.ts:411-429,515-540,656-699` — the predicate, the poll loop and the sampler
- `src/hooks/usePointerPosition.ts:122-156` — the validators whose refusal is silent
- `playwright.config.ts:118-120` — the `reuseExistingServer` condition behind section 9
- `e2e/undo-redo.spec.ts` — the spec whose mutation campaign section 9 invalidated
