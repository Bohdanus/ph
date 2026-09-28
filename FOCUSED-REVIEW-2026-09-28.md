# Focused review — 2026-09-28

A review of the four subsystems I understand well enough to be dangerous about: the codec/raster
budget layer, the durable materialization source path, the canvas test doubles, and the branch
ownership map. Every finding below is either marked **[verified]** — I re-ran it against the tree
myself — or **[delegated]**, meaning a subagent found it and I checked the load-bearing claim but not
every supporting line.

**Read this before acting on a number.** Three findings here are more load-bearing than they look:
one is a tripwire that measures nothing, one is a merge that will land two same-named exports in one
tree, and one is a test that names a lie as the specification.

**Ownership.** Everything in §2, §3 and §4 that is not labelled FREE is owned by a GPT campaign or
an in-flight branch, per `HANDOFF.md` item 55. I recorded rather than fixed. The `FREE` codec files
(`avif-utils.ts`, `tiff-utils.ts`, `bmp-utils.ts`, `gif-utils.ts`, `ico-utils.ts`, `svg-utils.ts`)
and `src/__tests__/canvas-mock.ts` are the actionable set.

**Where each section was recorded, and why.** AGENTS.md routes by scope: `HANDOFF.md` is for
history/replay and document-state defects, `TEST-FLAKES.md` is for the runner and the gates,
`e2e/OPEN_PROBLEMS.md` is for Playwright. So §3 (codec budgets) and §4 (materialization) are in
`HANDOFF.md` — the AVIF/TIFF family was already item 45 there, and items 58 and 59 are new. §1 and §2
are **harness** defects, and their natural home is `AGENTS.md`'s "Test traps" section, which is
**GPT-owned and therefore not editable by me**. `TEST-FLAKES.md` is a single-topic hunting ground for
an uncaptured intermittent failure, so folding fourteen deterministic harness defects into it would
break its stated shape ("a hunting ground, not a changelog"). §1 is cross-referenced from
`HANDOFF.md` item 2, because that item's instruction to remove the pin in the same change as the fix
is wrong and would mislead whoever does the work. §2 and the rest of §1 live here until someone who
owns `AGENTS.md` moves them.

---

## 1. The headline: a tripwire in the suite measures nothing [verified]

`HANDOFF.md` item 2 says the `it.fails` at
`src/contexts/__tests__/materialization.ordering.test.ts:415` is a tripwire that "fails the moment
the defect is fixed", and instructs whoever fixes the ordering defect to remove it in the same
change. **That instruction cannot be followed. The pin is inert in both directions.**

The pin spies on `HTMLCanvasElement.prototype.getContext` (`ordering.test.ts:428-429`). But
`materialization.ts:55` short-circuits to `OffscreenCanvas` when one is defined, `src/test/setup.ts:53-54`
installs a global `OffscreenCanvas` unconditionally (jsdom has none), and that test file never
stubs `OffscreenCanvas` — unlike `materialization.assets.test.ts:134`, which does and whose
assertions work.

So `materializeLayer` never constructs an `HTMLCanvasElement`, the spy is never invoked,
`transformSpy` records zero calls and `drawImageCalls` stays empty. **Proven, not reasoned** — a
probe replicating the pin's instrument against the same two-operation layer reported:

```
transformSpy calls = 0 || drawImage calls = 0 || OffscreenCanvas defined = true
```

Both assertions in the pin therefore fail on `0`, not on the ordering defect. The consequences:

- The grouping defect it names still exists verbatim (`materialization.ts:247-250` does one `filter`,
  one `transform`, one `drawImage` for all retained operations), and the pin has never once observed
  it.
- **It cannot go green when the defect is fixed**, because `0 !== 2` and `0 !== 2`. A future fix will
  be forced to leave the pin, or to "fix" it by rewriting assertions that still measure nothing.
- `AGENTS.md` counts 34 `it.fails` blocks and treats each as a live tripwire. One of the 34 is not.

Secondary: `ordering.test.ts:428` captures `originalGetContext` and `:497` calls `.mockRestore()` on
it. The original has no `mockRestore`, so that line would throw — it is unreachable only because the
`expect` at `:494` throws first.

**Fix.** Re-instrument the path the code actually uses: `vi.stubGlobal('OffscreenCanvas', …)` in a
`beforeEach`, as `materialization.assets.test.ts:134` does, and assert on the recorded contexts. Add
a positive control inside the pin — `expect(recordedContexts.length).toBeGreaterThan(0)` — which
fails immediately today and proves the instrument is alive. That single assertion is what makes the
tripwire a tripwire.

**Files.** `src/contexts/__tests__/materialization.ordering.test.ts:415-500`,
`HANDOFF.md` item 2 (corrected on this branch).

---

## 2. The canvas doubles cannot represent a state leak, and one test pins a lie as the spec

HANDOFF item 39 is an OPEN defect: `Main.tsx:87` hands every tool area the **same** 2D context for the
whole session, `setupDrawCtx` and `setShapeCtx` write `globalAlpha` and six other state properties
with no `save()`/`restore()`, and nothing resets the context — so the last writer's state is the next
painter's. It is not testable today, and the reason is in the harness.

### 2.1 `save`/`restore` are no-op spies, so no test can catch a missing restore [verified]

`canvas-mock.ts:22-23` stubs both as `vi.fn()`. The HTML Standard defines `save()` as pushing a copy
of the drawing state and `restore()` as popping it, over ~20 properties including `globalAlpha` and
`globalCompositeOperation`. With no-ops, **the question "was the state restored?" is not
representable.**

Every save/restore assertion in the tree is a **call-count** assertion, which is orthogonal:
`eraser.test.ts:126-127`, `polygon-selection.test.ts:156-157`,
`layer-renderer.drawLayersToCanvas.test.ts:255-256,344`, `selection.test.ts:389,634-635` all assert
`toHaveBeenCalledTimes(n)`. `useAnts.test.tsx:83-84` asserts a bare `toHaveBeenCalled()`. A writer that
never restores passes all of them. The only state-stack semantics anywhere are hand-rolled in
`psd-utils.test.ts:33-39` and cover 3 of ~20 fields.

`text.test.ts:164-176` looks like the exception and is not — it seeds `ctx.globalAlpha = 0.2` and
asserts the fill saw `1`, which is `resetOverlayAlpha` (`tools/text.ts:26`) doing an explicit
unconditional write. It tests the per-patch, and it builds a fresh ctx, so cross-paint leakage is out
of scope by construction.

**Fix (FREE).** Give `makeMockCtx` a real `save`/`restore` over the state list, and add one test that
drives two writers on one ctx and asserts the second saw the pristine state. That single test would
have caught both root-cause writers.

### 2.2 The global stub returns a fresh context on every `getContext` call [verified]

`src/test/setup.ts:212-214`:

```ts
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
  return createMockCanvasContext(this) as unknown as CanvasRenderingContext2D;
});
```

The spec: _"Return the same object as was returned the last time the method was invoked with this same
first argument."_ This returns a new object every call, so **no state can leak between two
`getContext` calls on the same canvas** — not in the mock. Every other double in the repo gets this
right (`canvas-mock.ts:83,103`, `materialization.assets.test.ts:35-39`).

This is not merely failing to detect item 39's leak: it **removes the precondition under which the
leak exists**. The shared-context invariant that makes item 39 a defect is absent from the stub, so
no test can express it.

**Fix.** Cache per canvas element in a `WeakMap<HTMLCanvasElement, …>` keyed on `this`.
**OWNED** — `src/test/setup.ts` is on the EXCLUDED manifest. Needs an owner, not a solo edit.

### 2.3 A harness test names a lie as the specification [verified]

`src/__tests__/harness-integrity.test.ts:119-124`:

```ts
it('normalises zero and fractional OffscreenCanvas dimensions the way the real constructor reports them', () => {
  expect(new OffscreenCanvas(0, 0).width).toBe(1);
  expect(new OffscreenCanvas(20.2, 30.9).width).toBe(21);
});
```

`OffscreenCanvas`'s `width` is `[EnforceRange] unsigned long long`: it **truncates toward zero**, and
`0` is legal. So the real constructor reports `0` and `20`, not `1` and `21`. The double at
`setup.ts:69-70` does `Math.max(1, Math.ceil(width))` — both the clamp and the rounding are wrong —
and the test pins the wrong values under a title that claims spec fidelity.

That title is the corrosive part: it gives a future reader permission to trust every other
"the way the real API does X" claim in the same file. `harness-integrity.test.ts:69-75`
(`expectEveryMethod`) is genuinely good and is the standard the rest of the file should meet — and
it checks **methods only**. No property surface is guarded anywhere, which is why §2.4 went unnoticed.

**Fix.** `Math.trunc` with no clamp, in all three OffscreenCanvas doubles; correct the test. Note
`RecordingOffscreenCanvas` (`materialization.assets.test.ts:27-29`) does not normalise at all, so the
two doubles in this review's own fixture disagree with each other.
**Mixed ownership** — `setup.ts` and `fixtures/canvas.ts` are OWNED, `materialization.assets.test.ts`
is FREE.

### 2.4 Smaller, all verified

| #   | Defect                                                                                                                                                                                                                                                                                                                                                                                                                            | Where                                  | Owner |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----- |
| a   | `filter` defaults to `''`; the real default is `"none"`, which is **truthy**. `materialization.assets.test.ts:327` selects contexts with `.filter(Boolean)` and is correct _only because the mock lies_. Three regexes at `:308-318` happen not to match `'none'`, so it passes today and is one regex change from a false green.                                                                                                 | `canvas-mock.ts:65`                    | FREE  |
| b   | `strokeStyle`/`fillStyle` default to `''`; real default is black and an invalid write is **ignored**. Latent: no production code reads either back. Already costing coverage — `layer-utils.createLayerSource.test.ts:208-213` is titled _"skips the alpha write for a fully opaque fill"_ and its own comment says _"the mock records no write"_, so it has no `globalAlpha` assertion and cannot fail.                          | `canvas-mock.ts:46-47`                 | FREE  |
| c   | `lineDashOffset` is the only production-used ctx **property** the doubles omit. Missing, but write-before-read everywhere, so latent.                                                                                                                                                                                                                                                                                             | `canvas-mock.ts`                       | FREE  |
| d   | `RecordingOffscreenCanvas.getContext()` takes no argument and returns a 2D context for _any_ id, so `getContext('webgl')` yields a mock 2D context. This is why `:269-284` needs a `contextAvailable` constructor flag instead of a realistic stub.                                                                                                                                                                               | `materialization.assets.test.ts:33-40` | FREE  |
| e   | Neither OffscreenCanvas double models the real resize mechanism (the `width`/`height` setter, which resets the context to default state). Both implement a `resize()` method that is **not in the standard**. Production has zero `.resize(` call sites, so latent. The test claiming to cover it (`harness-integrity.test.ts:133-141`) never calls `resize()` and its assertions are tautologies.                                | both doubles                           | mixed |
| f   | `convertToBlob()` returns a 0-byte Blob. No current test depends on it; it is a landmine for the next one that round-trips a blob.                                                                                                                                                                                                                                                                                                | `materialization.assets.test.ts:51-53` | FREE  |
| g   | `ImageStub.src` in `avif-utils.test.ts:19` is a plain class field, so assigning it starts no load. **Reorder `raster-utils.ts:15-22` so `image.src` precedes the handler assignments and all four `loadAvifFile` tests still pass** while the code breaks in every real browser. The handler-before-src invariant is entirely unpinned.                                                                                           | `avif-utils.test.ts:19`                | FREE  |
| h   | `installImageHarness` stubs `toDataURL` with `mockReturnValue`, so the `'image/png'` argument is never checked — change it to `'image/jpeg'` in `raster-utils.ts:40` and every AVIF test still passes.                                                                                                                                                                                                                            | `avif-utils.test.ts:37`                | FREE  |
| i   | `raster-utils.ts:9` and `:32-35` guard only nullness, not `getImageData`'s existence. Under the global stub a test reaching `:12` without a per-canvas override gets `TypeError: context.getImageData is not a function` instead of the intended `'Unable to read canvas pixels'`. The rest of the codebase already uses the `typeof ctx.getImageData !== 'function'` guard (`FillToolArea.tsx:44`, `EyedropperToolArea.tsx:74`). | `raster-utils.ts`                      | FREE  |

### 2.5 Are the six vector-source tests I shipped today sound? [verified]

Yes, with one overclaim. I traced every row against `drawShape` (`shape.ts:150-217`) and `shape()`
(`:219-235`).

- **Rows 2-6 discriminate.** `oval` is the only figure calling `ellipse` and never `strokeRect`;
  `triangle`/`polygon` are the only ones calling `closePath`; `line` is the only one where `lineTo`
  is called exactly once. If `normalizeFigure` regressed to `'rectangle'`, rows 3-6 go red.
  The `lineTo` counts are `sides - 1`, because the loop's first iteration is `moveTo`.
- **Row 1 (`shape`) overclaims.** Its expectations are identical to row 2, so it already expects a
  rectangle — `normalizeFigure` degrading anything to `'rectangle'` leaves it green. Its real value
  is narrower and still real: it proves `toolName: 'shape'` routes to the deterministic shape creator
  instead of throwing. The comment at `:406-414` claims otherwise and should be corrected.
- **The comment misstates the rule** as "side counts (triangle 3, polygon 5, line 2 points)"; the
  assertion counts are 2 and 4. Correct assertions, wrong stated rule.
- **`recordedContexts[0]` is self-checking**, which is the strongest property here. `shape()` allocates
  and takes its context at `shape.ts:226-227` before drawing, and the double records on first call.
  If the materializer ever took a context on an earlier canvas, every count would be 0 and **all six
  rows would fail loudly**. An ordering regression is a red test, never a green one.
- **What they cannot cover:** the `globalAlpha` leak — `setShapeCtx` is item 39's second unbracketed
  writer, and §2.1 means no test can see it.

---

## 3. Raster budget — four codecs, one shared defect class [FREE unless noted]

The app has a pixel budget per codec. `tiff-utils.ts` derives one from the New Image dialog's
10000-per-side clamp; `avif-utils.ts` carries a hard-coded 80 MP (the operator's recorded decision,
`HANDOFF.md` item 45). The rest have nothing. Measured coverage:

| codec       | loader budget                     | encoder budget                   | same rule both sides? | check before the allocation?                 |
| ----------- | --------------------------------- | -------------------------------- | --------------------- | -------------------------------------------- |
| avif        | yes                               | yes (added this session)         | yes, one function     | yes                                          |
| tiff        | yes (pixels + bytes)              | yes (pixels + a dead byte check) | yes                   | yes — the only genuine pre-decode load check |
| bmp         | **none** — bounded by file length | **none**                         | n/a                   | n/a                                          |
| gif         | **none**                          | 65535/axis                       | no                    | **no**                                       |
| ico         | **none**                          | 1..256/axis                      | no                    | **no**                                       |
| svg         | **none**                          | **none**                         | n/a                   | n/a                                          |
| psd (OWNED) | yes                               | yes                              | yes                   | yes — the reference implementation           |

### D1 — TIFF's byte predictor ignores the tiled-allocation branch [verified]

`tiff-utils.ts:102` is the entire predictor:

```ts
const bytes = height * Math.ceil((width * bitsPerPixel) / 8);
```

It never reads `t322` (TileWidth) or `t323` (TileLength). `UTIF.js:132` allocates a **separate**
per-tile buffer for a tiled page: `new Uint8Array(Math.ceil(tw*th*bipp/8)|0)`. For the page
`{t256:[1000], t257:[1000], t258:[8,8,8,8], t322:[23170], t323:[23170]}`, `predictDecodeBytes`
returns 4,000,000 — comfortably inside the 1.6 GB ceiling — while UTIF allocates **2,147,395,600
bytes (2.15 GB)**. A ~200-byte file forces a 2.15 GB allocation, through the exact mechanism the
module documents as its reason for existing. The docstring at `:74-88` claims to model "the exact
`new Uint8Array` size `UTIF.decodeImage` reaches"; that is false for tiled pages.

**Fix.** If `t322`/`t323` are present, also predict `Math.ceil(t322[0] * t323[0] * bitsPerPixel / 8)`
and return the larger; a present `t322` with a missing `t323` should return `null`, which
`assertByteBudget:34` already refuses on the same terms as over-ceiling. **Test:** the tag set above
must reject with `/over the TIFF budget/` and `expect(decodeImage).not.toHaveBeenCalled()`.

### D2 — BMP: the only bound is the file's byte length, while the allocation is 4 bytes/pixel [verified]

`bmp-utils.ts:46-47`:

```ts
ensureRange(view, pixelOffset, rowStride * height); // bound = on-disk bytes
const output = new Uint8ClampedArray(width * height * 4); // cost = 4 B/px always
```

The ratio is exactly `32 / bitsPerPixel`: 1 bpp → **32×**, 4 → 8×, 8 → 4×, 24 → 1.33×. A
20000×40000 1-bpp BMP needs 100 MB on disk and allocates **3.2 GB**. There is no absolute pixel
ceiling anywhere in the file, and `bmp-utils.test.ts`'s largest geometry is 8×8, so no test can
reach an interesting ratio. `ico-utils.ts:95` reaches the same decoder bounded by `imageSize`.

**Fix.** `assertPixelBudget(width, height, 'open')` before `:47`, importing the same shared constant
AVIF uses. **Test:** a 1-bpp 20000×40000 header must reject; the existing 1-bit case
(`bmp-utils.test.ts:416-433`) must still decode, proving the bound is not `file size ÷ 4`.

### D3 — GIF checks the ceiling _after_ allocating the whole raster [verified]

```ts
const { data, width, height } = getCanvasImageData(canvas);   // :10  full RGBA copy first
if (width > 65535 || height > 65535) { throw ... }            // :14
```

A 70000×100000 canvas allocates 28 GB before the line that would have refused it. This is the same
ordering defect I fixed in AVIF, in the one file that still has it. `gif-utils.test.ts:472-480`
cannot catch it: it mocks `getContext` to return `{width: 70000}` from a 1×1 canvas and never asserts
`getImageData` was not called.

**Fix.** Hoist both checks above `:10`, reading `canvas.width`/`canvas.height`.
**Test:** assert the rejection _and_ `expect(getImageData).not.toHaveBeenCalled()`.

### D4 — ICO checks the ceiling after PNG-encoding the entire canvas [verified]

```ts
const png = new Uint8Array(await (await canvasToPngBlob(canvas)).arrayBuffer());  // :114
if (width < 1 || height < 1 || width > 256 || height > 256) { throw ... }          // :116
```

`Save as ICO` on a 10000×10000 document pays a full PNG encode of a 400 MP raster, then throws.
`ico-utils.test.ts`'s `canvasOf` stubs `toBlob` with a 3-byte blob, so no test detects it. **Fix:**
move `:115-118` above `:114`. **Test:** `expect(toBlob).not.toHaveBeenCalled()`.

### D5 — ICO's loader has no 256 cap, so it accepts exactly what its encoder refuses [verified]

`ico-utils.ts:23` validates only `dibSize < 40 || width <= 0 || rawHeight <= 0 || rawHeight % 2 !== 0`.
The 256 ceiling at `:84-85` is used for **entry selection** only; the geometry actually decoded is
read from the DIB at `:18-19` and never compared to 256. A file that opens cannot be saved back.
**Fix:** bound the DIB geometry on the same 256 the encoder enforces. **Test:** a 16×16 directory
entry whose DIB declares 512×512 must reject.

### D6 — four ceilings, two of them below what the app can create [verified]

| ceiling                        | value           | where                                       |
| ------------------------------ | --------------- | ------------------------------------------- |
| affine transform               | 67,108,864      | `affine-transform.ts:34`                    |
| PSD                            | 67,108,864      | `psd-utils.ts:36`                           |
| AVIF                           | 80,000,000      | `avif-utils.ts:13` (your decision, item 45) |
| TIFF                           | 200,000,000     | `tiff-utils.ts:12-23`                       |
| **largest creatable document** | **100,000,000** | `NewImageDialog.tsx:208-209`                |

The two 64 MP constants are the same number written twice, independently, in files that do not
import each other. Consequence: a 100 MP document can be saved as BMP, GIF, SVG and TIFF, but not as
AVIF and not as PSD — and the PSD cap is recorded nowhere. "One exported `MAX_RASTER_PIXELS`" would
have to reconcile **four** constants, not one.

### Smaller, all verified

- **TIFF's save-side byte check is provably dead** — `MAX_TIFF_PIXELS * 4 = 800,000,000` is always
  below `MAX_TIFF_BYTES = 1,600,000,000` (`tiff-utils.ts:175`). No test can make it fail, and the
  string it would produce says "Decoding it" on a save. Keep the invariant, fix the wording, and pin
  the arithmetic so a future constant change cannot silently kill it.
- **AVIF's `assertPixelBudget` has no finite/integer guard**, unlike TIFF's (`:45,62,158`) and PSD's
  (`:40-41`). A decoded `width: -5, height: -3` gives product 15, passes the budget, and reaches
  `createImageData(-5, -3)`, which throws a DOM `IndexSizeError` instead of an actionable message.
  Proven against a mock; whether real libavif can return it is unverified.
- **ICO tells a too-SMALL canvas it is too large** (`:116-118` reuses one message for both
  directions), and `ico-utils.test.ts:249` pins the wrong string, so fixing it needs that test too.
- **Four budget messages omit the geometry they refuse** (`gif-utils.ts:15`, `ico-utils.ts:117`,
  `bmp-utils.ts:38`, `ico-utils.ts:24`). `avif-utils.ts:17` and `psd-utils.ts:48` are the models.
- **BMP's encoder writes its size fields with `setUint32`/`setInt32`, which wrap silently above 2³²**
  (`:150,153,154,158`) rather than refusing — a concrete corrupt-header consequence of D2's missing
  budget. Not reachable today: the dialog caps at 100 MP and `affine-transform.ts:34` at 64 MP.
- **GIF and SVG loads are unbounded anywhere in the app** — `image-load-save-utils.ts:113-136`
  base64-encodes the whole file into a data URL and hands it to `new Image()` with no size check.
  **OWNED**; this is where a shared load-side ceiling would have to live for those two formats.
- **No codec budget has any e2e pin.** Grepping `e2e/` for every budget constant and error string
  returns one unrelated hit.

**Checked and found correct:** TIFF's predictor is _exact_ for strips, not merely conservative
(`UTIF.js:123`'s `bipl` is a multiple of 8, so `bipl >>> 3` equals the prediction while it fits in
32 bits, and above 2³² the `>>>3` wraps down so the prediction over-estimates). `readIfdDimensions`
reads exactly the fields UTIF uses (`UTIF.js:108-109`). No byte/pixel unit mixing anywhere. No codec
clamps or downscales — the reject-never-clamp contract **holds** for every codec checked, and the
only geometry reductions are the ICO XOR+AND halving and the 0-means-256 encoding, both applied
after the guard. BMP is NaN-proof by construction (`getInt32`/`getUint16` cannot return `NaN`).
`assertByteBudget`'s "cannot predict → refuse" contract is right. PSD is the model implementation.

---

## 4. Durable materialization — the source path fails documents, not layers [OWNED — report only]

`materializeLayer`/`materializeDocument` still have **no production caller** — verified again. These
are the defects that matter when the cutover happens, and they are why it should not happen yet.

### 4.1 A single brush stroke produces a `legacy-tool` source and fails the ENTIRE document [verified]

`history-adapter.ts:166-171` routes a source's `args.toolName` to `text` or `vector` only for `text`
and the six shape names; everything else becomes `legacy-tool`. `materialization.ts:156` throws on
it unconditionally, and `materializeDocument` releases every taken lease and rethrows (`:347-350`) —
so one layer voids the whole document.

`useLayer.ts:244-249` writes `args: { ...args }` from the concrete tool, so `args.toolName` is
`'brush' | 'pencil' | 'color-replacement'`, never `'draw'`. **All three take the `legacy-tool` route.**
Note the irony: `toolProcessors.draw:145-151` is a genuine `creator: true`, and the `draw` creator
is therefore unreachable from the durable path.

**Fix.** Either route those three to a typed source via their existing creators, or make
`materializeDocument` isolate per-layer failure so one unconvertible layer cannot void a document.
**Test.** A brush history item through `legacyHistoryToDurable` must not yield
`source.kind === 'legacy-tool'`; and `materializeDocument` over brush + two good layers must resolve
with the good layers present.

### 4.2 Three selection tools falsely claim `creator: true` [verified]

`materializeLayer` trusts `creator` as its only gate (`:168`). All three `commit: 'selection'` tools
claim it — `polygonal-lasso` (`:160-166`), `freehand-lasso` (`:167-173`),
`rectangular-selection` (`:186-192`) — and all three processors are pass-throughs over a `bitmap`
that is `undefined` on a creator call:

```ts
export const rectangularSelection =
  ({ bitmap }: ProcessorToolParams) =>
  () => [bitmap];
```

- `rectangular-selection` → `[undefined]` → caught by `if (!created) throw` (`:172`), message blames
  the tool.
- `polygonal-lasso` / `freehand-lasso` with empty `points` → `copyPolygonToCanvas` returns a **1×1
  canvas**, which is truthy, so the guard **accepts it** and the layer silently materializes blank.

Currently unreachable, because §4.1's throw fires first — which is exactly what makes it dangerous:
the flag is a lie the moment routing changes. **Fix:** drop `creator: true` from all three; they are
`commit: 'selection'` mutators, not creators. **Test:** for every entry claiming `creator: true`,
call `imageProcessor({size:{width:8,height:8}})(args)` and assert a bitmap with finite dimensions
≥ 1. Fails today for the two lasso tools.

### 4.3 The creator path bypasses `createCanvas`'s dimension clamp [verified]

`createCanvas` is the only place dimensions are sanitized (`materialization.ts:52-63`:
`Math.max(1, Math.ceil(…))`). The creator branch at `:169-171` hands the **raw** `renderSize` to the
processor, and creators allocate their own canvas (`shape.ts:226`). A durable vector layer with
`pos.width === 0` therefore dies inside `shape.ts` with an opaque `IndexSizeError`, while the same
geometry on a raster source dies with the controlled, pinned `Affine transform produced degenerate
bounds`. Two source kinds, two failure modes. Reachable because `durable-replay.ts:96-105` merges
`operation.resize` into `pos` with no validation and the geometry branch of `operationForTool`
(`history-adapter.ts:435-447`) accepts `args.resize` unvalidated — in direct contrast to the
transform branch, which calls `validateAffineTransform`.

### 4.4 A raster source's declared dimensions are dead fields [verified]

`materialization.ts:152-155` reads only `source.assetId`; `source.width`/`source.height` appear
nowhere in the file, and the only registry record access is `.generation` for the cache key. `size`
comes from `snapshot.pos`, and the retained segment stretches the bitmap to it (`:250`) — so a
snapshot whose `pos` disagrees with the bitmap's intrinsic size **silently composites a stretched
image**, no error, no diagnostic. `AssetRecord` already carries `width`/`height`
(`asset-registry.ts:11-12`), so the cross-check is one property away. Divergence already occurs
naturally: `history-adapter.ts:159-160` writes `bitmap.width`, while the registry normalizes via
`Math.max(1, Math.ceil(v))`.

### 4.5 `blank` colour and opacity fail silently rather than loudly [verified]

`materialization.ts:161-162` assigns `ctx.fillStyle = source.color` and
`ctx.globalAlpha = source.opacity` with no validation; the type is a bare `string` and a `number`
with a `// 0..1` comment (`layer-types.ts:9-12`). An **invalid `fillStyle` assignment is ignored**,
leaving the default black — so the layer renders solid black with no error. Every other untrusted
field in this file throws a named error; this one produces a plausible-looking wrong image.

### 4.6 `source.size` is honoured for `text` but ignored for `vector` [verified]

`materialization.ts:169` — `const sourceRenderSize = source.kind === 'vector' ? renderSize : source.size;`
Vector renders crisp at presentation size; text renders at `source.size` (e.g. 32×16) and is then
**stretched** by `drawImage` at `:250` because `size = layerSize(layer)`. A 6.25× upscale produces
visibly aliased glyphs where an identically-resized vector stays crisp. The only test of this branch
(`materialization.assets.test.ts:499-517`) asserts `toBeDefined()` and nothing about size, which is
how §4.6 shipped.

### 4.7 Two tests assert the opposite of their names [verified]

- `ordering.test.ts:243` _"rejects cleanly when a raster processor produces no output"_ builds a real
  `blur` op, awaits **success**, and asserts `toBeDefined()`. It is a near-duplicate of the next
  test and pins nothing about the no-output guards at `:172`/`:283`. The correct version already
  exists at `materialization.assets.test.ts:672-689`.
- `assets.test.ts:499` _"renders a text source … using its intrinsic size"_ asserts only
  `toBeDefined()`. The same file rejects that assertion class 80 lines earlier, in the comment I
  wrote at `:406-414`.

### 4.8 One test constructs an operation the adapter can never produce [verified]

`assets.test.ts:735-743` builds `{kind: 'apply-raster-processor', processorId: 'reposition', …}`. But
`reposition` has `commit: 'geometry'`, so `operationForTool` always maps it to `reposition-layer`. The
test passes only because `reposition.ts:17-19` has a `move` branch; its `resize` branch falls off the
end returning `undefined`, so the identical test with a `resize` would throw
`TypeError: undefined is not iterable`.

### 4.9 Confirmed still accurate [verified]

`rasterize-layer` still has **no production writer** (repo-wide grep: the model, the clone path, the
replay reducer, four test files, two docs) — `HANDOFF.md` item 12 stands. `commit` and `replay.kind`
are mutually consistent across all 25 registry entries. Every genuine creator honours its curried
`params.size`. `grep` for `Math.random|Date.now|new Date(|performance.now|crypto.` across `src/tools/`
returns **zero**, so the `creator` flag is a sound determinism signal where it is honestly set.
`vectorArgsForSize` cannot divide by zero (`!(sourceWidth > 0)` is false for 0, negative and `NaN`)
and does not mutate the frozen args. Cache-key stability is real — `stableValue` sorts keys.
`replay-coordinator.ts` and `replay-checkpoints.ts` have zero production importers, consistent with
their own dormant-claim blocks.

---

## 5. Branch integration hazard: a flood-fill split-brain, not a rename [verified]

`merge/ps-tool-expansion` is the largest unmerged branch (121 files against `main`). It was recorded
as renaming `src/util/floodFill.ts` to `src/util/flood-fill.ts`. **It is not a rename.**

```
src/util/floodFill.ts    exists on the branch, 205 lines
src/util/flood-fill.ts   exists on the branch, 281 lines
```

Both files export the same names:

| `floodFill.ts`        | `flood-fill.ts`                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFloodFillMask` | `createContiguousMask`, `createAllMatchingMask`, `floodFill`, `getToleranceDistance`, `getPixelColor`, `getIndex`, `getMagicWandColorDistance`, … |
| `FloodFillOptions`    | `FloodFillOptions`                                                                                                                                |
| `FloodFillResult`     | `FloodFillResult`                                                                                                                                 |

`src/util/floodFill.ts` exists in `main`; `flood-fill.ts` does not. So the merge lands **two
divergent flood-fill implementations with three colliding export names in one tree**, and whichever
import wins depends on resolution order. `createFloodFillMask` has two different implementations.

This is not a style question. `floodFill.ts` backs the Paint Bucket and Magic Eraser
(`tools/fill.ts:74-79`), so a wrong resolution silently changes fill behaviour — and the two
implementations have different `FloodFillOptions` shapes, so the type can compile against one and
run the other.

**This needs a decision before that branch merges, not a note after.** Either delete the old file in
the branch and re-point its importers, or keep one and delete the other. It also invalidates the
claim in `HANDOFF.md` item 49 that this area is merely "a new module".

---

## 6. Evidence, and what I could not verify

**What I re-ran myself**, rather than taking from a subagent: the dead tripwire (§1 — with a live
probe reporting `transformSpy calls = 0`); the TIFF tiled arithmetic (§3 D1); BMP's missing budget
(D2); GIF's and ICO's check-after-allocation ordering (D3, D4); ICO's missing loader cap (D5); the
four-constant ceiling table (D6); TIFF's dead byte check (arithmetic); the `creator: true` map and
the three selection pass-throughs (§4.2); the `legacy-tool` routing chain (§4.1); the fresh-context
global stub and the mis-pinned dimension test (§2.2, §2.3); both mis-named tests (§4.7); and the
`floodFill` split-brain (§5).

**What I took as delegated** and did not independently re-verify: the spec quotations for
`OffscreenCanvas`'s `[EnforceRange] unsigned long long` semantics and the `save`/`restore` state
list; the claim that no production code reads any ctx property back (two greps by the subagent, which
is why I recorded it as latent rather than active); the exhaustiveness of the "42 distinct ctx members
production touches" diff; the four codecs' individual test-coverage enumerations.

**Not verified at all:** whether real `@jsquash/avif` can return a negative, fractional or `NaN`
dimension — it is WASM-backed and every test mocks `decode`, so the AVIF integer-guard finding is
proven against a mock only. Whether a 3.2 GB `new Uint8ClampedArray` completes or throws `RangeError`
first — the amplification arithmetic is certain, the failure mode is engine-dependent. Whether any
existing test currently hits `TypeError: context.getImageData is not a function` via
`raster-utils.ts:12`. Whether any UI gesture can produce `pos.width === 0` (§4.3) — I verified only
that neither the adapter nor the durable reducer validates it. No browser was opened, so every
real-canvas claim is spec-derived, not executed. I did not review `psd-utils.ts` or
`affine-transform.ts` beyond their budget lines, and did not audit `src/util/draw.ts` for
nondeterminism.

**Contradictions found in my own brief to the subagents**, corrected here because they would have
become false findings if copied: `materialization.ts` does **not** call `transferToImageBitmap` (it
calls `createImageBitmap` at `:178`); a second `transferToImageBitmap` does **not** throw
`InvalidStateError` (it returns a bitmap of a now-blank canvas — the real hazard is silent data loss,
and it is unreachable, since `asset-registry.ts:107` is the only production call and it transfers
once off a fresh canvas); and `floodFill` → `flood-fill` is not a rename (§5).

---

## 7. What this means for the migration

The cutover gate in `HANDOFF.md` item 1 should not be treated as one wiring step. §4.1 means the
durable path throws on the second thing a user does in a session — draw a stroke — and takes the
whole document with it. §4.2 means the `creator` flag that gate would rely on is already false for
three tools. §4.3–§4.5 mean the failure modes are opaque or silent rather than named. And §1 means
the ordering defect blocking that work is guarded by a tripwire that has never observed it.

The one item here that is actionable today, needs no architecture decision, and is entirely in FREE
files is **D1** — a ~200-byte TIFF forcing a 2.15 GB allocation, through the exact mechanism the
module documents as its reason for existing. Six lines and one test.
