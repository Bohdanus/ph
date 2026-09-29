# Handoff: `ps-transform-geometry` review and merge

**Branch:** `ps-transform-geometry` (single commit `a3f9050` + this review commit)
**Reviewed and merged by session:** `ses_f1cc60a69ffes0kT5wrXiD83xa` ("Review unmerged branch against main", 2026-09-27)
**Branched-from session:** `ses_f20141236ffeNlkIewckZUfVzq` ("Fixing Free Transform geometry ordering") — the session that wrote the original code
**Orchestrator that directed it:** `ses_f2072f4e7ffe78wAlKEv5Yk0oZ` ("Photoshop tool implementation research plan")
**Math audit of the original:** `ses_f1ffcb14cffeOGTCuq884tMCGB` ("Audit homography and CTM math")
**Peer session that owned the neighbouring `useLayer`/`materialization` files:** `ses_f203d1809ffeNPTrWZgpyj5LTO` ("Photoshop fidelity Phase 1 fixes")
**Plan documents that governed the work:** `.kilo/plans/ps-research/` — `01-photoshop-reference.md` §6, `02-implementation-plan.md` §6, `RESEARCH-BRIEF.md` (the 10 architecture constraints), `08-merge-plan.md` (the merge gate). **These are gitignored and exist only on this machine — read them before touching this code again.**

Read this document before changing `src/util/homography.ts`, `src/util/homography-resample.ts`, or the trapezoid branch of `src/tools/transform.ts`. Most of what follows is not derivable from the code.

---

## 1. What the branch was for

`ps-transform-geometry` is phase 6 of a four-worktree Photoshop-fidelity programme, branched from `50bb2b8`. It was assigned exactly one file to own (`src/tools/transform.ts` and its test) plus one new utility (`src/util/homography.ts`). It was explicitly forbidden from editing `layer-renderer.ts`, `useLayer.ts`, `materialization.ts`, `history-replay.ts`, `shape.ts`, `settings.ts` — those belonged to a concurrent session. It was told to **report** any needed change there rather than reach outside its boundary. That boundary is why several defects described below still exist.

The original assignment listed three defects:

| #   | Defect as assigned                                                              | Status after this review                                               |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Raster CTM order (`T·R·K·S`) disagreed with the retained affine order (`K·R·S`) | Fixed in `a3f9050`, but **see §5.1 — the fix is not on the live path** |
| 2   | The trapezoid strip loop was aliased (one `drawImage` per source row)           | Fixed in `a3f9050`                                                     |
| 3   | CTM order entirely untested                                                     | Fixed in `a3f9050`                                                     |

## 2. The two findings that matter most

### 2.1 The taper changed from linear to projective, and every pre-existing test was structurally blind to it

The old implementation warped with a **linear** row scale `s_lin(y) = 1 - f·y/H`. The new one warps with the **projective** row scale of a homography, `s_proj(y) = 1/(1 + f·y/((1-f)H))`. Both agree at `y = 0` and at `y = H` and **nowhere else**. At `f = 0.5`, `y = H/2`, the old code produced a row `0.750` of full width and the new code produces `0.6667` — the mid-height row is 8.3% narrower, and it is also displaced vertically, because the projective map additionally warps `y`.

This was **deliberate and reported**: the branch author computed the difference (destination `(50,25)` sampling source `(50,16.67)` instead of `(50,25)` on a 100×50 layer at `trapezoid: 50`) and flagged it as "a visible-output change, not a pure quality fix". The orchestrator and the math audit both endorsed it — Photoshop's Perspective Crop is genuinely projective, and the old loop was an approximation.

**The trap that made it survive review.** `getTrapezoidQuad` and `getAffineBounds` derive the _same quad_ under both tapers, because the boundary lines are identical. So **every assertion phrased as quad corners, quad bounding box, canvas size, or opaque-span-at-destination-row-y passes under both tapers.** Only a source whose _content varies by row_ can distinguish them. The original `imageSmoothingEnabled` and off-by-one tests were blind for the same reason. This retroactively explains why the suite was green.

Consequence for anyone writing tests here: **do not** assert trapezoid behaviour from corners, the bbox, the canvas dimensions, or edge alpha. Assert against a source with a row-dependent marker, and assert the _row position_ of a mid-source-row feature. `transform.test.ts` and `homography.test.ts` now do exactly this, including `2(1-f)/(2-f)` at the mid row and the mid-row destination position.

**The exact bilinear inverse is a one-line swap** if the linear interior warp is ever wanted back: change `solveHomography(sourceRectCorners(size), quad)` in `renderTrapezoid` to a separable-bilinear inverse. The quad, bbox, canvas size, alpha coverage and edge positions are identical either way — only the interior parameterization differs.

### 2.2 The corner-bounding-box rationale in the plan documents is wrong; the conclusion is right

The plan asserted the bbox is tight because the taper map `x' = x·s(y) + (W - W·s(y))/2` "is a **projective (homography)** map, not bilinear". That is false. Substituting `s(y) = 1 - k·y` gives `x' = x(1 - k y) + k W y / 2`; forcing it into `(ax+by+c)/(gx+hy+1)` and multiplying out, the `x²`, `xy²`, `y²` terms force `g = h = 0`, leaving a pure `xy` cross term — it is **separable bilinear**.

The bbox is still tight, for a different reason: a separable bilinear map is linear along each of the rectangle's four boundary lines, so all four edges map to straight lines and the image is exactly a quadrilateral. `homography.test.ts` pins that real invariant (mapped edge midpoint collinear with the mapped endpoints, tolerance expressed as a perpendicular deviation in pixels rather than a dimensionful cross product) instead of the false claim.

If you are tempted to "fix" the corner bbox, do not — unless you are implementing Warp, which is genuinely non-projective and out of scope.

## 3. What the review found and fixed (`a3f9050` → review commit)

### 3.1 CRITICAL — the singularity test was not translation-invariant, so a large layer threw from the UI

`homographyMagnitude` fed the relative singularity test in `isInvertibleHomography`, and it included the **translation** entries `c` and `f`. Translation does not appear in the 3×3 determinant, so including it raised the threshold of a test whose numerator translation cannot affect.

A negative taper offsets the quad sideways in proportion to layer width, so the threshold grew with the layer while the determinant stayed at `(1-|f|)²`. Independently measured on `main`+`a3f9050`:

| layer                      | taper | before                                     | after      |
| -------------------------- | ----- | ------------------------------------------ | ---------- |
| 6642×3985                  | −85   | margin exactly `1.000` (boundary)          | solved     |
| 6643×3985                  | −85   | **`Trapezoid geometry is not invertible`** | solved     |
| 6928×3464 (24 MP)          | −85   | **throws**                                 | solved     |
| 8000×6000 (48 MP)          | −85   | **throws**                                 | solved     |
| identity translated by 1e4 | —     | **not invertible** (det = 1)               | invertible |

`Transform.tsx` puts the slider at `min={-85} max={85}`, so the leftmost stop was reachable. The throw escaped `tempUpdateLayer` through the `try` in `useLayer.ts:469-492`, which caught it and `console.error`'d it — so the visible symptom was **the trapezoid slider silently doing nothing on layers wider than ~6.6 k px**, not a crash. That is why it survived the original session.

Fix: `homographyMagnitude` now considers only the entries that decide invertibility (`a, b, d, e, g, h, i`). All rejections are preserved — collinear source points, rank-deficient and singular matrices, `trapezoid ±100`, and the `(99.99999, 100)` non-invertible band.

**This was already flagged once.** The math audit's should-fix item 8 said the epsilon "is absolute but applied to px²-scaled quantities … make it scale-relative or rename it so the name stops lying". The original session made it relative to `magnitude³` but left translation in the magnitude, so the fix was half-done and the crash shipped. Treat item 8 as **not** closed.

### 3.2 The horizon guard was absolute while the matrix is scale-arbitrary

`differentiateHomography` compared the projective denominator against a bare `1e-12`. A homography is only defined up to a common factor, so the identity multiplied by `1e-13` is still the identity — and was rejected, producing a **blank image**. Replaced with `projectiveRowScale` / `projectiveDenominator`, which compare the denominator against the magnitude of the row that produces it. Verified scale-invariant from `1e-20` to `1e30`; a true horizon is still rejected, and a zero projective row returns `null`.

Known bound of that guard: the reach term scales with the point coordinates, so a point at `|x| = 1e12` under the identity is rejected even though its denominator is a healthy 1. That is unreachable here — sample coordinates are destination pixels, capped at 65536 by `MAX_AFFINE_COORDINATE` — and larger layers make the guard _looser_, not tighter. If `differentiateHomography` is ever called with coordinates above ~1e12, revisit the reach term first.

### 3.3 A `NaN` could reach the bilinear weights

The supersample loop used `denominator === 0` and had no finiteness check, so a non-finite sample could index the source buffer with `NaN` and write `NaN` into the `Uint8ClampedArray`. Both guards are now negated comparisons, which reject `NaN` for free.

### 3.4 The trapezoid path read the source at a different contract than the affine path

`renderTrapezoid` used `drawImage(bitmap, 0, 0)` (natural size) while `renderAffine` used `drawImage(bitmap, 0, 0, size.width, size.height)`. Two branches of one function, two contracts. Now explicit in both, and pinned by a test that supplies a bitmap whose intrinsic size differs from `size`.

### 3.5 The trapezoid exclusivity guard was duplicated

`transform.ts` carried a byte-copy of the `isTrapezoidOnlyTransform` predicate that `useLayer`, `history-adapter` and `history-replay` all gate on. It now calls the shared predicate, so a trapezoid that reaches the raster can never be one the publication layer would have refused.

### 3.6 The quad's bounding-box origin was computed and then discarded

`renderTrapezoid` destructured only `width`/`height` from `boundsOfPoints(quad)` and dropped `x`/`y`, while mapping absolute quad coordinates into a destination that starts at 0. Correct only because the trapezoid's AABB happens to start at 0. The quad is now translated by the bounds origin explicitly, so the code is correct by construction rather than by coincidence.

### 3.7 The source canvas outlived its usefulness

The source `OffscreenCanvas` stayed referenced while the destination was allocated. Extracted into `readSourcePixels`, which returns only the `ImageData`, so the source canvas is unreachable before the destination exists.

### 3.8 One module now owns the raster ceiling

`rasterizeBounds` moved from `src/tools/transform.ts` to `src/contexts/affine-transform.ts`, next to the `MAX_AFFINE_*` constants it enforces. The message stays distinct (`'Raster transform exceeds supported bounds'`) because it is a rounding-collapse guard, not the analytic-bounds guard; a test asserts both ceiling messages loosely so the wording is free to change.

### 3.9 Test quality

Every new test was proven to **fail against the pre-fix code** (20 failures when the old `homography.ts` was restored; restored afterwards). Specifically killed or repaired:

- Three **tautological** CTM tests that re-derived the expected value with the same helper production calls. Replaced with verified literal matrices and independent `layer-renderer` composition.
- `MockOffscreenCanvas.getContext()` returned a **new context on every call**, so assertions depended on how many times production called it. Now stable per canvas, and `putImageData` accumulates into one destination buffer, so pixel assertions describe the rasterised image rather than the strip mechanism.
- `expect(MAX_HOMOGRAPHY_SUBSAMPLES).toBe(4)` — a pin on a tuning constant. Now a bound.
- A dimensionful absolute tolerance on a px² cross product. Now a perpendicular deviation in pixels.
- Vacuous `setTransform`-call-sequence pins and filler `toBeGreaterThan(0)` assertions.
- No `trapezoid` 1/0.2/0.4/90/±99.99 edge coverage. Added: `(99.99, 100)` non-invertible band, both slider limits end-to-end, sub-pixel layers, 1×1 taper, intrinsic-bitmap-size mismatch, trailing-edge texel clamp, checkerboard minification, pure-translation invertibility at 1e2/1e4/1e6.

## 4. Decisions this review reversed after the chat-history search

The first pass of this review was done **without** reading the sessions that created the branch. Two of its changes were wrong, and were reverted. Recording them because the reasoning generalises.

### 4.1 Deleting `resampleThroughHomography` was wrong

I deleted the pure `resampleThroughHomography(source, destination, inverse)` wrapper as dead code — it had no production callers, and the row-by-row variant was the only live entry point.

The orchestrator had explicitly ordered the opposite:

> "Keep `resampleThroughHomography` as a pure function returning a full `ImageData`, and put the row-strip logic in a separate exported function beside it … Reason: the pure version is what the tests exercise and **what a deterministic replay would want**; the strip version is an allocation optimization. **Do not degrade the tested interface for the sake of the optimization.** If the two share a kernel, factor the kernel out and have both call it."

The wrapper is restored, still shares the `resampleRow` kernel, and the numerics tests exercise it again. The row-by-row entry point additionally has its own suite, including a test that it produces byte-identical output to the pure function. **A "zero references" grep is not evidence that an export is removable in this codebase** — the pure/optimised pair is a deliberate shape, and the pure half is the deterministic-replay contract.

### 4.2 Adding explanatory comments was wrong

I added doc comments explaining the translation exclusion, the scale-relative horizon test, and the inlined guard. The merge gate `08-merge-plan.md` §4 says:

> "No new comments in source except `// BUG:` and `// @ts-expect-error`."

and the orchestrator reinforced it when it asked for the `renderAffine` reachability note to be carried **in a test name** because "the source must stay comment-free" — "a test name is documentation that cannot be stripped by a linter."

All added comments are removed. The reasoning now lives here, and the two invariants most likely to be "cleaned up" by a future reader are carried in test names:

- `'resamples the same pixels as the pure function it shares a kernel with, so the horizon guard can stay hoisted out of the subsample loop where a call per subsample costs about half the throughput'`
- `'pins the retained-path raster contract reached only by a direct imageProcessor call, not the live route, because useLayer routes every trapezoid === 0 transform to the retained affine path'`

## 5. Known limitations, still open, deliberately not fixed here

### 5.1 The headline CTM fix is not on the live path — this is the most important thing to know

`useLayer.ts` returns early for `trapezoid === 0` and builds a retained affine operation instead of rasterising. `history-replay.ts` does the same. So in production:

- `renderAffine` is **unreachable**. The `T·R·K·S` → `K·R·S` unification that the commit message leads with only executes for a direct `imageProcessor` call.
- **The only user-visible change from this entire branch is the trapezoid**, i.e. the linear → projective taper of §2.1.

That is fine as groundwork, but anyone reading the commit message will assume the raster path runs for every transform. Promoting `renderAffine` to the live path is an architecture decision, not a review fix: it collides with `RESEARCH-BRIEF.md` constraint 5 ("affine transform is retained, not rasterized"), and the merge plan says a `ps-transform-geometry` report that needs a change in `useLayer`/`materialization`/`history-replay` is "a Phase 6 follow-up, not a merge conflict". **Decide it deliberately, with the operator.**

### 5.2 The `renderAffine` 90° parity test is a structure guard, not a pixel witness

The original session established that the old 90° raster output was **geometrically correct** despite its different CTM: old `T(6,15)·R` with `drawImage(…, -15, -6)` is equivalent to new `T(-9,9)·aroundCenter(R)` for a 30×12 layer. That test fails pre-fix only because the old code folded the origin into the `drawImage` offset instead of the matrix. The **skew+rotate+scale** test is the real witness (≈7.6% linear error, translation off by 2×).

### 5.3 When exactly old and new CTM orders disagree

The commit message says the disagreement occurs "when skew is non-zero and when rotate is non-zero with non-uniform scale". That is **wrong as stated**. The real condition is `sin(rotate) ≠ 0` **and** `tan(skewX) + tan(skewY) ≠ 0`. A rotation with non-uniform scale but zero skew does **not** disagree, because `S` and `K=I` commute, so `K·R·S = R·S = S·R`, and rotation commutes with uniform scale only — which is why the wrong condition survives casual testing. Do not "correct" the code based on the commit message's claim; the code is right and the message is imprecise.

### 5.4 Supersampling caps below the footprint at high tapers

`MAX_HOMOGRAPHY_SUBSAMPLES = 4` is a documented quality/performance trade-off, not a correctness fix. The traper's narrowest row at `f = 0.85` has a Jacobian footprint of ~6.7, so it gets 4×4 taps — a partial box filter, not aliasing removal. Measured: a 1 px line at 8:1 minification loses **100% of its ink** depending on phase. Raising the cap to 8 restores 10 of 11 numerics tests but costs roughly 4× in exactly the rows that are already the expensive ones, on a path that already costs 2.4–3.2 s for a 24 MP layer. **Not changed: the call is a product/perf judgement, not a review finding.** If it is revisited, anisotropic per-axis tap counts are the principled fix — the footprint is a scalar max of two axis-specific L1 norms, and they diverge under shear.

### 5.5 Memory at the ceiling

`renderTrapezoid` peaks at roughly three rasters: source canvas, source `getImageData`, destination canvas (~768 MB transient at the 64 MP cap). The row-strip design exists to cap the **destination** at `w*4` instead of `w*h*4`; the source is unavoidable, because a backward map needs random access to source pixels. The orchestrator **overruled** a proposed lower cap:

> "`MAX_TRAPEZOID_RASTER_PIXELS = 16 * 1024 * 1024` is too aggressive for this product. That caps trapezoid at roughly 4096x4096, which would reject a **6000x4000 (24 MP) image** — a completely ordinary camera resolution for an image editor whose entire premise is Photoshop parity. Rejecting it would be a worse outcome than the memory pressure."

Do not re-propose a lower cap without settling that trade-off with the operator first.

### 5.6 `|trapezoid| >= 100` is rejected, and that is a behaviour change

The old code rendered a collapsed sliver at `trapezoid = ±100`; it now throws `'Trapezoid taper must stay within 100 percent'`. For `|trapezoid| > 100` the DLT "succeeds" but the horizon crosses the interior, so the resampler leaves a transparent fold. Unreachable from the UI (slider is ±85), so this is latent-only — but it is a behaviour change, and `(99.99999, 100)` is the first rejected value.

### 5.7 Sub-half-pixel affine transforms now throw

`rasterizeBounds` rejects `round(bounds.width) < 1`, while `getAffineBounds` accepts `width > 0`. So `resizeX: 0.2` on a 100 px layer raises `'Raster transform exceeds supported bounds'` where the retained path still accepts it. The original session **deliberately kept this** and pinned it in a test, on the reasoning that rounding to 1×1 would silently turn a "scale to nothing" into a visible 1 px layer. It is pinned in `transform.test.ts` as `'throws when a rounded dimension collapses below one pixel'`. Flip it knowingly, not by accident.

### 5.8 Unifying on `transformToolArgsToAffine` inherited its error strings

Four tool error messages changed as a side effect. Only log text is affected — `useLayer`/`history-replay` catch generically and only `console.error`, and no other file asserts on these strings.

### 5.9 `e2e/transform.spec.ts` exists only as an untracked file

`/Users/bkalynovskyi/ph/.kilo/worktrees/ps-integration/e2e/transform.spec.ts` is **untracked** in that worktree. It is the only browser-level proof of any of this work, and one `git worktree remove` from being lost. Committing it is a follow-up for whoever owns that worktree; it is not part of this merge.

## 6. Performance measurements

Resampler throughput, 1200×800 source at `trapezoid: 85`, 5 iterations, min of 5 runs:

| variant                                                | ms  | note                           |
| ------------------------------------------------------ | --- | ------------------------------ |
| `a3f9050` (inline `denominator === 0`)                 | 511 | baseline                       |
| review, `projectiveDenominator()` called per subsample | 980 | **2× regression — rejected**   |
| review, guard inlined with the row scale hoisted       | 531 | **shipped, +4% over baseline** |

The lesson worth keeping: a cross-module function call in the innermost subsample loop cost more than everything else in the loop combined. The shipped version inlines `projectiveDenominator`'s comparison and hoists `projectiveRowScale(inverse)` to once per row. The formula therefore appears in two places, deliberately — see the test name in §4.2.

Other measurements from the original session: `trapezoid: 60`, 256×256 = 16 ms, 1024×1024 = 100 ms, 2048×2048 = 394 ms; full processor on 512×512 ≈ 23 ms/call. The old strip loop was `O(H)` `drawImage` calls — fast, and wrong. The 64 MP ceiling implies a worst case of several seconds, which is a real cliff for very large layers; the honest mitigations are a work budget or a banded canvas path, both out of scope.

## 7. Verification performed

On the branch, before merge:

- `npx tsc -b --force` — clean
- `npx eslint .` — 0 errors (16 pre-existing warnings in files this work does not touch)
- `npx prettier --check src/ docs/` — clean. (`.skills/broad-test-improvement.md` fails prettier and is **pre-existing**; it is untouched by this branch and fails identically on `main`.)
- `npm run test` — 106 files, 1361 passed, 2 expected fail, 0 failed
- **Gate §4 "every new test fails without its fix"** — verified by reverting each file to `a3f9050` and re-running:

  | reverted file                      | outcome                                                                 |
  | ---------------------------------- | ----------------------------------------------------------------------- |
  | `src/util/homography.ts`           | **31 failures**                                                         |
  | `src/tools/transform.ts`           | **1 failure** — `reads the source at the layer size on both paths`      |
  | `src/contexts/affine-transform.ts` | 33 failures (missing `rasterizeBounds` export; a move, not a behaviour) |
  | `src/util/homography-resample.ts`  | suite fails to load (missing `projectiveRowScale` export)               |

  The single `transform.ts` failure is the expected result, not a gap: the other three changes there are provably behaviour-preserving refactors of `a3f9050`'s own behaviour (the shared guard is equivalent for every validated input, and the quad translation is a no-op because a trapezoid's AABB origin is always 0), so no test can distinguish them.

- **Adversarial check on the new singularity gate** — 6 singular matrices including ones with 1e6-scale translations are all still rejected (0 leaks); 3 invertible matrices with large translations are all accepted; the horizon guard is scale-invariant across 10 orders of magnitude.
- **Randomized differential fuzz, 400 cases** (random homographies incl. non-zero `g`/`h`, random sources up to 12×12, random destinations up to 16×16): `resampleThroughHomography` and `resampleThroughHomographyRowByRow` agree **byte for byte** on every case, 0 exceptions, 0 out-of-bounds destination writes.
- **Solver fuzz, 3000 cases** (random tapers up to ±0.99, random sizes 1–200 px): every matrix the solver returned mapped all four correspondences within relative 1e-4, and **no solved matrix was subsequently rejected** by the invertibility gate. 0 violations.
- Merge into `main` clean; gate re-run on `main` — see §8

## 8. Post-merge state

Merged into `main` as `67a7fc4` with `git merge --no-ff`, so the branch commits `a3f9050` and `ee8b360` are preserved in history. No conflict: `homography.ts` had no dependents. The merge plan's warning that the new CTM-order test might newly _fail_ on `photoshop-fidelity`'s render path **did not materialise** — the full suite is green on `main`.

Gate re-run on `main` after the merge:

| check                                                           | result                                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc -b --force`                                            | clean                                                                                                                                                          |
| `npx prettier --check src/ docs/`                               | clean                                                                                                                                                          |
| `npx eslint .`                                                  | 0 errors **from this merge**; 1 pre-existing error in `e2e/helpers/cdp-helpers.spec.ts` from another session's uncommitted work, which the merge did not touch |
| `npm run test`                                                  | **176 files, 3881 passed, 42 expected fail, 0 failed** (branch had 106/1361 — file count increased, none deleted)                                              |
| test files deleted by the merge                                 | 0                                                                                                                                                              |
| `package.json` / `package-lock.json` / tsconfig / eslint config | unchanged                                                                                                                                                      |
| new runtime dependencies                                        | none                                                                                                                                                           |
| new comments in `src/`                                          | 0                                                                                                                                                              |

`npx prettier --check .` still reports `.skills/broad-test-improvement.md`, which is pre-existing and fails identically before this merge.

**The Playwright suite was deliberately not run.** `main`'s working tree carries another session's in-flight, uncommitted e2e edits (6 files, 189 insertions), so a run would measure their work rather than this merge and could not be attributed. The merge plan's gate is `tsc -b --force` + `eslint`/`prettier` + `npm run test`, and all three are green. If you want e2e confidence on this code, the honest way is a clean checkout of `67a7fc4`.

`ps-integration` remains unmerged and **dirty** (34 modified files, uncommitted, from a different session). It was not touched by this merge.

## 9. If you are picking this up next

1. Read `.kilo/plans/ps-research/08-merge-plan.md` §4 and `RESEARCH-BRIEF.md` before writing code. The 10 constraints are not optional, and the merge gate is stricter than `npm test`.
2. Read §2.1 before writing **any** test that touches the trapezoid. Corner/bbox/canvas-size assertions cannot distinguish the tapers.
3. If you change the sampling guard, re-run the benchmark in §6. A "harmless" refactor there costs 2×.
4. If you change `homographyMagnitude` or the singularity epsilon, re-run the large-layer cases in §3.1. That is a live user-facing regression that has already been introduced, half-fixed, and shipped once.
5. §5.1 is the biggest open question. Settle it with the operator before assuming the raster path is used.
6. `ps-integration` is dirty and diverged; its untracked `e2e/transform.spec.ts` is the only browser-level proof of this work.
