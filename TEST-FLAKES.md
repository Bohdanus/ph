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

## 8. A third, NAMED observation — the first Playwright page loads in a cold checkout time out

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

Not yet done. The warm-up in (1) is a one-request change to a file nothing else
touches, and it is left alone here so it does not ride in on a toolbar fix that
does not need it.

## 9. Files

- `vitest.config.ts:6-9` — the pool configuration this is about
- `src/test/setup.ts` — the polyfills most likely to be involved
- `src/util/draw.ts` — the file whose import fan-out defined the observed set
- `src/contexts/__tests__/useFile.test.tsx` — the named failure in section 7
- `src/contexts/avif-utils.ts` — the encoder whose budget check changed nearby
- `.husky/pre-push` — where `npm run test` now runs
- `AGENTS.md`, "`test:staged` is a command, not a gate" — where it lives now, and what it costs
- `playwright.config.ts:106-120` — the `webServer` block, and why an explicit
  `PLAYWRIGHT_PORT` disables server reuse
- `e2e/global-setup.ts` — where the warm-up in section 8 belongs
- `e2e/sidebar-flyout.spec.ts:125` — the `beforeEach` that loses the race
