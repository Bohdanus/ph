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
the commit path.

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

The scoped run that produced the observation no longer exists. `test:staged` was
removed from the commit hook in the same change that fixed the worktree hook gap
(see AGENTS.md, "Gates"), because its cost was not bounded by the change: it
selected 10 of 180 test files for one component and 115 of 180 for
`src/util/draw.ts`, so its worst case was the full run it was introduced to
replace.

That removes the _exposure_ — there is no longer a fan-out run inside a commit
gate, so there is no longer a scoped run in which this flake could be observed by
a developer mid-commit. It does **not** remove the _condition_. The same
`vmThreads` pool, the same 4 workers, the same shared machine, still runs the
full suite in three places:

| where      | command                      | who runs it                                    |
| ---------- | ---------------------------- | ---------------------------------------------- |
| `pre-push` | `npm run test`               | `gate:push`, once per push                     |
| `ci` job   | `npm run test -- --coverage` | GitHub Actions, on every push and PR to `main` |
| on demand  | `npm run test`               | anyone, any time                               |

The full suite has been observed green repeatedly — 180/180 files, 4142 passed,
34 expected-fail, across at least seven separate full runs on 2026-09-28, exit 0
every time. That is a much larger sample than the 8 that was dismissed earlier,
and it is evidence that the full-suite failure rate is low. It is not evidence
that it is zero, and the coverage run in CI is a _different_ execution again
(instrumented, slower, different timing), so it is not the same sample either.

**The honest position: the specific observation is now historical, and the class
of defect is still uninvestigated.** Closing this document because the code path
that reported it was deleted would be closing it for the wrong reason.

## 4. Why `src/util/draw.ts` is a place worth staring at

The observation came from the file set that `src/util/draw.ts` fans out to, which
is the widest in the repository at 115 of 180 files. Two reasons that is not a
coincidence:

- A wide fan-out means the run contains most of the suite, so it has the largest
  exposure window of any scoped run that could exist. Whatever the flake is, a
  115-file run is the most likely place to meet it.
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

**Step 4 — once named, it becomes an ordinary defect.** A named intermittent
failure is a bug with a location. It goes in `HANDOFF.md` as a precise open
problem, and it is fixed at the cause, not by retrying. `test.retry` is a
prohibition here, exactly as a raised threshold is a prohibition: it converts a
real failure into a green run and destroys the only signal that the defect
existed.

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

## 7. Files

- `vitest.config.ts:6-9` — the pool configuration this is about
- `src/test/setup.ts` — the polyfills most likely to be involved
- `src/util/draw.ts` — the file whose import fan-out defined the observed set
- `.husky/pre-push` — where `npm run test` now runs
- `AGENTS.md`, "Gates" — why the scoped run no longer exists
