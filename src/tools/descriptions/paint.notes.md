# Paint family — research notes

The seven tools whose work is putting pixels on, taking them off, or moving them: `brush`, `pencil`, `color-replacement`, `eraser`, `magic-eraser`, `paint-bucket`, `clone-stamp`.

**How to read the tables.** `Status` is the app's fidelity for that one Photoshop control, checked against **both** `src/tools/settings.ts` and the tool's own component under `src/components/ToolbarsRight/` before anything was called `missing`. `present` renders and behaves; `partial` renders but diverges; `missing` renders nothing; `inert` renders with Photoshop's own label but writes nothing. `appRef` points at the **wiring**, not at the label, and every line number was re-derived against this worktree.

**Version.** Photoshop 2024–2026 throughout. Two version boundaries are load-bearing and are named where they occur: `Smoothing` and `Symmetry` are 2017/18-era additions, and the option-bar `Hardness` control is gone from current Photoshop (it lives in the Brush Preset picker popout and in the Brush Settings panel).

**Retrieval boundary.** `webfetch` on `helpx.adobe.com` returns HTTP 403 on every path — re-confirmed this pass on the painting-tools page — so every Adobe claim below was read through the live search crawler, which is the documented route. Two Adobe manuals are cited through mirrors of Adobe's own text (`manualsdir.com`, `adobe.manymanuals.com`, and a Wacom-hosted PDF of the CC 2018 help); each is labelled as such where it is load-bearing, because the mirror is not Adobe but the words are Adobe's.

---

## Brush Tool

Photoshop's general painting tool. Click and drag to lay down a stroke of the foreground color on the active layer.

**Load-bearing distinction — Opacity is not Flow.** Opacity is a hard ceiling for one stroke: the stroke cannot exceed the set level however many times the pointer crosses the same pixels, and only a new stroke re-applies it. Flow is the per-dab build-up _inside_ that ceiling, so a single pass with Flow at 33% moves the pixels 33% toward the brush color and no further. The composition is `ps = flow + op − flow·op`. This is the single most commonly mis-implemented pair in a paint engine, and it is why `Flow` is `missing` for the app's Brush rather than `partial`.

**Mode is a layer property, not a stroke property.** The app seeds the created layer's `blendMode` from the tool args. That is a defensible simplification for a Normal-mode brush and a visible divergence for the other fifteen.

**Version note — a control that is gone, not one that is missing here.** Photoshop's bar used to open with a **Tool Preset Picker** at the far left, beside the tool icon, whose menu carried `New Tool Preset`, `Rename Tool Preset`, `Delete Tool Preset`, `Reset Tool` and `Reset All Tools`. It is not on the current bar: "In Photoshop CS6 or early CC versions, Tool Presets had their own dropdown menu at the far left of the Options bar… The Preset Manager is gone. Tool presets are now found inside the Brush Settings or Presets interface," and they are saved automatically as you work.

So the app's `Brush Preset` select — three synthetic settings snapshots plus a `Custom` row, wired at `Paint.tsx:123` — is **not** standing in for a control Photoshop still renders. It sits where the Brush Preset picker sits, applies options-bar state the way a tool preset used to, and is the app's own addition. That is why there is no `Tool Preset Picker` row in `paint.ts` at all, and why the `Brush Preset Picker` row is `partial` — the tip popout is absent — rather than `missing`.

This is the same class of version boundary as `Hardness` leaving the top bar, and the two belong together: **current Photoshop's paint bar is smaller than the 2020-era bar.** A control being absent from the app is not evidence the control exists in Photoshop, and reading a 2020-era bar order into a 2026 description produces a row for a control that no longer exists.

| Photoshop control               | What it does                                                                                                                                                         | Default / range                                | App       | Why                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Brush Preset Picker             | Tip thumbnail + chevron; popout with Size, Hardness, Angle/Roundness, settings gear, New Preset, tip grid                                                            | last used                                      | `partial` | No tip asset to show; the app's settings-snapshot select sits in the same position and is its own addition           |
| Size                            | Tip diameter, px                                                                                                                                                     | 1–5000                                         | `partial` | Renders 1–500 (`brush.ts:62`); the cap exists because a stroke allocates a canvas padded by the full tip width       |
| Mode                            | Blend mode of the stroke                                                                                                                                             | Normal; 27 modes + Dissolve/Behind/Clear       | `partial` | 16 canvas operations (`brush.ts:23`); applied to the created layer (`layer-utils.ts:146`) not to the stroke's pixels |
| Opacity                         | Per-stroke ceiling                                                                                                                                                   | 100%; 0–100                                    | `present` | `globalAlpha` on one `stroke()` over the whole path is exactly a per-stroke cap                                      |
| Flow                            | Per-dab build-up                                                                                                                                                     | 100%; 0–100                                    | `missing` | No `flow` field in `settings.ts`, no control in the bar                                                              |
| Airbrush                        | Keeps stamping while the pointer is still                                                                                                                            | off                                            | `missing` | Needs a dwell timer; a mouse-driven stroke ends at pointer-up                                                        |
| Always Use Pressure for Opacity | Forces stylus pressure onto opacity                                                                                                                                  | off                                            | `missing` | No pointer-pressure pipeline                                                                                         |
| Always Use Pressure for Size    | Forces stylus pressure onto tip size                                                                                                                                 | on for Hard-Round class                        | `missing` | Same                                                                                                                 |
| Smoothing                       | Amount of stroke smoothing                                                                                                                                           | 10%; 0–100                                     | `partial` | Real, but a different algorithm — see below                                                                          |
| Smoothing Options               | Gear: Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End, Adjust for Zoom                                                                                   | Catch-up on, Adjust for Zoom on, other two off | `missing` | Four booleans in no args type                                                                                        |
| Symmetry                        | Butterfly: 10 modes, Radial 2–12 and Mandala 3–10 segments                                                                                                           | off                                            | `missing` | Needs the stroke replayed per dab through an active transform                                                        |
| Toggle the Brush Settings panel | Opens Brush Tip Shape, Shape Dynamics, Scattering, Texture, Dual Brush, Color Dynamics, Transfer, Brush Pose, Noise, Wet Edges, Airbrush, Smoothing, Protect Texture | closed                                         | `missing` | No panel, no tip model, no RNG                                                                                       |

**Smoothing: same name, different algorithm.** The app pulls every interior sample toward the midpoint of its neighbours by `smoothing/100` (`brush.ts:101`, consumed at `util/draw.ts:96`), which is a point-space filter. Photoshop's is a trailing anchor over the **raw** input stream at input rate, which is what makes Stroke Catch-up, Catch-up on Stroke End and Pulled String Mode expressible and what couples smoothing to zoom. The app's version is recognizably the same feature and not the same mechanism — hence `partial`, not `missing`.

**What matches.** One history state per stroke: the commit is the pointer-up (`DrawToolArea.tsx:143`). Opacity as a per-stroke ceiling. Smoothing at Photoshop's own 10% default (`brush.ts:66`).

**The largest divergence is not on the bar.** A brush stroke is committed by `createLayerFromTool` — it creates a **new layer** rather than painting the active one. Photoshop's Brush paints into the active layer. Nothing in the options table shows this.

**Modifiers and shortcuts.** `Alt` temporarily switches to the Eyedropper; `Shift` constrains the stroke to a straight line between a click and a Shift-click. `B` selects the tool, `[`/`]` change the tip size, and `0`–`9` set Opacity in tens.

**Sources**

- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://community.wacom.com/en-us/guide-to-photoshop-brushes-pt-1/>
- <https://flylib.com/books/en/4.462.1.114/1/>
- <https://asktimgrey.com/2017/03/21/pencil-brush-shape/>
- <https://web.archive.org/web/20201111235536/https:/helpx.adobe.com/photoshop/using/whats-new/2018.html>
- <https://helpx.adobe.com/photoshop/using/paint-symmetry.html>
- <https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/>
- <https://clippingpathca.com/photoshop-tool-presets/>

---

## Pencil Tool

A Brush whose tip is always hard-edged. Adobe's own one-line distinction: "The Brush tool creates soft strokes of color. The Pencil tool creates hard-edged lines."

**The hard edge is not antialiasing.** Two independent sources state it: the O'Reilly _Photoshop Elements_ Missing Manual — "it offers only hard-edged brushes. In other words, you can't draw fuzzy lines with the pencil"; and dummies.com, on the partial-sketch feature — "the edges of a pencil stroke can't even be antialiased." Ask Tim Grey's sharpening is that this is what creates the jagged stair-step diagonal: a round tip at 100% hardness with no antialiasing rasterizes as a chain of square pixels. That is also why the Pencil's default tip is the 1-pixel brush (dummies.com), and why the missing control most people would name first is not a rendering bug but a tip-model one.

**Auto Erase is decided once, at mouse-down.** Adobe's exact wording, from the CS3 manual: "If the center of the cursor is over the foreground color when you begin dragging, the area is erased to the background color. If the center of the cursor is over an area that doesn't contain the foreground color when you begin dragging, the area is painted with the foreground color." Crossing the other color mid-stroke does not switch modes. This is the only genuinely Pencil-specific feature, and it is `missing` in the app for a structural reason worth stating plainly: **the app has no background color in its tool state**, so the checkbox has nothing to choose between.

| Photoshop control               | What it does                                                            | Default / range                 | App       | Why                                                                        |
| ------------------------------- | ----------------------------------------------------------------------- | ------------------------------- | --------- | -------------------------------------------------------------------------- |
| Brush Preset Picker             | Tip popout with Size, Hardness, Angle/Roundness, gear, New Preset, grid | last used                       | `partial` | No tip asset; the app's settings-snapshot select sits in the same position |
| Size                            | Tip diameter, px                                                        | 1–5000                          | `partial` | Renders 1–500                                                              |
| Mode                            | Blend mode of the stroke                                                | Normal                          | `partial` | 16 operations; layer property                                              |
| Opacity                         | Per-stroke ceiling                                                      | 100%; 0–100                     | `present` | Same single-pass alpha as the Brush                                        |
| Auto Erase                      | Paints background over foreground, decided at mouse-down                | off                             | `missing` | No background color in the tool state                                      |
| Smoothing                       | Amount of stroke smoothing                                              | 10%; 0–100                      | `partial` | Point-space filter, not a raw-input anchor                                 |
| Smoothing Options               | Gear: four checkboxes                                                   | Catch-up on, Adjust for Zoom on | `missing` | No args fields                                                             |
| Symmetry                        | Butterfly: 10 modes                                                     | off                             | `missing` | Brush, Pencil and Eraser only in Photoshop; nothing here                   |
| Toggle the Brush Settings panel | Opens the panel                                                         | closed                          | `missing` | No panel                                                                   |

**Flow is absent from the Pencil's bar entirely** — not listed above because Adobe's current Pencil bar does not carry it, which Ask Tim Grey states directly ("The Pencil tool also lacks the Flow setting on the Options bar"). That is a Photoshop fact the app happens to match, and the one place the app is not behind.

**The hard edge here is real but by construction.** Both the Brush and the Pencil go through the same bar factory and the same single-`stroke()` painter with a round cap, so the two do agree on the one property that distinguishes them — and they agree for the wrong reason. The edge is hard because the canvas rasterizes a round cap that way, not because a hard tip was selected. There is no tip model that could be made soft, which is the same root cause as the Eraser's `disabled` Brush mode.

**Keyboard.** Photoshop binds the Pencil to `N` (O'Reilly and dummies.com both). The app has no `N`; the Pencil is reached only by cycling the Brush tile with `Shift+B`.

**Sources**

- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/auto-erase-with-the-pencil-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=337> — Adobe's CS3 manual, on a mirror
- <https://www.oreilly.com/library/view/photoshop-elements-8/9780596809188/ch12s04.html>
- <https://www.dummies.com/article/the-new-partial-sketch-photoshop-elements-feature-259266>
- <https://asktimgrey.com/2025/08/08/pencil-versus-brush/>
- <https://asktimgrey.com/2017/03/21/pencil-brush-shape/>
- <https://flylib.com/books/en/4.462.1.114/1/>
- <https://helpx.adobe.com/photoshop/using/paint-symmetry.html>

---

## Color Replacement Tool

Substitutes one color for another in a stroke while keeping the luminosity and the texture underneath. Adobe describes the default options bar as one that "maintain[s] the luminosity and saturation of a color while replacing its hue."

**The whole tool is a blend mode.** Adobe: "Generally, you should keep the blending mode set to Color." That is why it is a replacement and not a paint — the mode transfers the source color's hue and chroma onto the destination's luminosity rather than compositing on top. `Hue`, `Saturation` and `Luminosity` transfer a different single component each. Remove the mode and the tool is a brush.

**Sampling and Limits are two different questions.** Sampling decides _which_ color is the target: Continuous (default) resamples under the crosshair on every move, Once locks the color of the first click for the whole stroke, Background Swatch targets the background color. Limits decides _how far_ the replacement spreads: Contiguous (default) from the pixel under the pointer, Discontiguous anywhere under the pointer, Find Edges contiguous but stopping at strong shape edges. A tolerance slider then sets how similar a pixel must be to count.

**Version note on Tolerance.** Adobe's CS4 manual says "enter a percentage value (ranging from 0 to 255)," which is the same odd unit the bucket uses. The commonly-cited default of 30% comes from third parties (photoshopessentials.com), not from Adobe — see `## Unverified`.

| Photoshop control   | What it does                                                            | Default / range                     | App       | Why                                                                                                       |
| ------------------- | ----------------------------------------------------------------------- | ----------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Tool Preset Picker  | Applies a saved options-bar state                                       | last used                           | `missing` | Placeholder chips only                                                                                    |
| Brush Preset Picker | Tip popout with Size, Hardness, Angle/Roundness, gear, New Preset, grid | last used                           | `missing` | No tip asset                                                                                              |
| Size                | Tip diameter, px                                                        | 1–5000                              | `missing` | No control; `lineWidth` is only reachable through a bar that does not render                              |
| Mode                | Hue / Saturation / Color / Luminosity                                   | Color                               | `missing` | **Load-bearing.** The `blendMode` field seeds to Normal and is read only for a layer a paint tool creates |
| Opacity             | Strength of the replacement                                             | 100; 0–100                          | `missing` | No control                                                                                                |
| Sampling            | Continuous / Once / Background Swatch                                   | Continuous                          | `missing` | No args field; no background color to name                                                                |
| Limits              | Contiguous / Discontiguous / Find Edges                                 | Contiguous                          | `missing` | No args field                                                                                             |
| Tolerance           | Slider, entered as a percentage                                         | 0–255 per Adobe; 30% commonly cited | `missing` | No args field                                                                                             |
| Anti-aliased        | Anti-aliased edges on the deposited color                               | on                                  | `missing` | No args field                                                                                             |

**The app's Color Replacement paints a spray can.** The processor forces `penType: 'spray'` (`toolProcessors.ts:276`) and `setupDrawCtx` returns before writing any stroke state for that pen type, so what is committed is a soft spray of the foreground color with `source-over` compositing. That is the precise inverse of the tool's contract: it covers texture and luminosity rather than preserving them, and it replaces nothing — no pixel is sampled, compared or transformed. The bar is a `PlaceholderTool` with six disabled chips naming the real controls (`toolbarPlaceholderConfig.ts:13`).

**Keyboard.** The app reaches the tool only by cycling the Brush tile with `Shift+B` (`AppKeyboardShortcuts.tsx:18`). No letter of its own; see `## Unverified` for the Photoshop binding.

**Sources**

- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/215> — Adobe's CS4 manual, on a mirror
- <https://www.photoshopessentials.com/photo-editing/color-replacement-tool/>
- <https://www.creativebloq.com/how-to/photoshop-colour-change>
- <https://design.tutsplus.com/tutorials/how-to-use-the-color-replacement-tool-in-photoshop--cms-39825>
- <https://flylib.com/books/en/4.462.1.114/1/>

---

## Eraser Tool

Removes pixels to transparency under a dragged tip; on a Background layer, or one with transparency locked, to the background color instead.

**Adobe's own description of the three modes** is unusually clean: "Brush: Erases pixels with adjustable softness and opacity settings. Pencil: Erases pixels with hard edges. Block: Erases pixels in a fixed-size square shape without opacity control." And: "In Brush and Pencil modes, adjust Size, Hardness, Opacity, and Flow from the Options bar."

**Erase to History turns the same drag into a restore**, and `Alt`-dragging turns it on temporarily — Adobe: "Hold Alt (Windows) or Option (macOS) while dragging to temporarily switch to Erase to History mode."

| Photoshop control   | What it does                                                   | Default / range                              | App       | Why                                                                      |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| Mode                | Brush / Pencil / Block                                         | Pencil                                       | `partial` | All three are offered; `brush` is `disabled` at `Eraser.tsx:56`          |
| Brush Preset Picker | Tip popout with Size, Hardness, gear, grid                     | last used                                    | `missing` | No tip asset                                                             |
| Size                | Tip diameter, px                                               | 1–1000                                       | `partial` | Renders 1–500 (`ERASER_SIZE_MAX`)                                        |
| Hardness            | Tip falloff                                                    | 0–100; fixed at 100 in Pencil; none in Block | `missing` | No field in `EraserToolArgs`; same root cause as the disabled Brush mode |
| Opacity             | Strength of the erasure; 100 erases completely                 | 100; 0–100                                   | `present` | Correctly withheld in Block mode, as Adobe does                          |
| Flow                | How quickly the erasure is applied, building up within Opacity | 100; 0–100                                   | `inert`   | See below                                                                |
| Airbrush            | Keeps erasing while the pointer is still                       | off                                          | `missing` | Brush mode only; needs a dwell timer                                     |
| Erase to History    | Drag restores to the History panel's current state or snapshot | off                                          | `missing` | No args field, and no Alt-drag gesture                                   |
| Symmetry            | Butterfly: 10 modes                                            | off                                          | `missing` | Brush, Pencil and Eraser only in Photoshop                               |

**`Flow` is the finding on this tool.** The bar renders Photoshop's real `Flow` label, Photoshop's 1–100 range and a hardcoded 100% value — and the `<input>` carries `disabled`, so nothing is ever written. There is no `flow` field on `EraserToolArgs` at all, which means the control is not merely unwired: it has no destination. The reason is structural, and the component says so: Flow is a per-dab alpha ramp, and this renderer issues one `beginPath` / `moveTo` / `stroke()` per stroke, which has no falloff and therefore no place to apply a per-dab rate. `Opacity` is the honest substitute, and it is what the app's Opacity actually is.

**`Mode: Brush` is the same root cause, one level up.** The option is present with Adobe's own label and `disabled`, because a soft tip needs a stamped-dab engine this renderer does not have. Offering it enabled would have made a "Brush" eraser silently render as Pencil.

**What matches.** The Eraser edits the **active** layer in place by subtracting alpha (`composite: 'destination-out'`, `eraser.ts:39`) rather than creating a layer, which is what Photoshop does and which the DrawToolArea path cannot do. One history state per stroke, committed on pointer-up (`EraserToolArea.tsx:169`). Opacity is correctly removed from the bar in Block mode rather than greyed out — Adobe removes it, and the component matches.

**Keyboard.** `E` selects the Eraser, matching Photoshop. The app also reaches it by cycling the Brush tile with `Shift+B`, which is its own choice — Photoshop keeps the Eraser in its own Tools-panel slot.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335> — Adobe's CS3 manual, on a mirror
- <https://www.mediacollege.com/adobe/photoshop/tool/eraser.html>
- <https://www.underwaterphotography.com/photoshop/photoshop/1_12_3_1.html>
- <https://www.glensmith.co.uk/photoshop/eraser>
- <https://helpx.adobe.com/photoshop/using/paint-symmetry.html>
- <https://flylib.com/books/en/4.462.1.114/1/>

---

## Magic Eraser Tool

The Paint Bucket run in reverse: one click erases every pixel within Tolerance of the clicked pixel. Adobe describes the entire bar in five lines, and the list is exact:

> Define the range of colors to be erased by entering a **Tolerance** value. Select **Anti-aliased** to smooth the edges. Select **Contiguous** to erase only the pixels contiguous to the one you select, and vice-versa. Select **Sample All Layers** to sample the erased colors. Define the strength of the erasure by specifying **Opacity**.

**Note the naming difference from the bucket, which is real and not a typo.** The bucket's checkbox is `All Layers` and the Magic Eraser's is `Sample All Layers`. They are the same idea — read the color data from the merged visible layers rather than the active one — and the two Adobe pages use the two different words.

**The cost of the tool is that there is no preview.** It works like the Magic Wand without the selection, so the region it is about to remove is visible only in the History panel afterwards. glensmith.co.uk makes the comparison plain: "with the Magic Wand you can see if any part of your subject will be selected and you can adjust this before deleting pixels. The Magic Eraser does not allow you to see this."

**Default Tolerance is 32**, per two independent third parties (glensmith.co.uk and an Adobe community answer from an Adobe expert). Adobe's own pages do not state a default; the bar's scale of 0–255 is Adobe's, from the CS3 manual.

| Photoshop control | What it does                                                                         | Default / range | App       | Why                                                               |
| ----------------- | ------------------------------------------------------------------------------------ | --------------- | --------- | ----------------------------------------------------------------- |
| Tolerance         | How far a pixel's color may differ and still be erased                               | 32; 0–255       | `present` | Correct scale, correct default, hard threshold                    |
| Anti-aliased      | Smooths the edges of the erased area                                                 | on              | `inert`   | See below                                                         |
| Contiguous        | On: erase only pixels contiguous to the click. Off: every similar pixel in the layer | on              | `present` | Real 4-neighbor scan at `floodFill.ts:124`                        |
| Sample All Layers | Sample the erased colors from all visible layers                                     | off             | `missing` | The tool reads only the active layer's own raster                 |
| Opacity           | Strength of the erasure; 100 removes completely                                      | 100; 0–100      | `present` | Scales the alpha removed per pixel, so a partial erase is partial |

**`Anti-aliased` is `inert` and the reason is arithmetic.** It renders with Photoshop's real label and Photoshop's real checked state, and the DOM input is `disabled`. The flood fill's test is a hard threshold (`isPixelWithinTolerance`, `floodFill.ts:76`) producing a `Uint8Array` mask of 0s and 1s, so there is no coverage value to smooth — anti-aliasing needs a fractional boundary, and this tool never computes one.

**Tolerance is on the right scale, which is a real and easy thing to get wrong.** The Magic Wand uses 0–100 against a 4-channel distance that includes alpha; the bucket, the Magic Eraser and the Background Eraser use 0–255 against a 3-channel RGB distance, where a pixel differing only in alpha is _inside_ the region. The app gets this right, and the two scales cannot drift into each other because both bars render against the same shared constant.

**Also absent: the locked-transparency rule.** On a Background layer, or a layer with transparency locked, Photoshop writes the background color into the matched pixels instead of clearing them, and using the tool on a Background layer converts it to a normal layer first. The app refuses the Bedrock layer outright and treats every other layer identically.

**Keyboard.** Photoshop's own help page prints "(E)" for this tool, which contradicts the usual convention that `E` is the Eraser group; no source was found binding the Magic Eraser to a letter of its own. The app's `G`/`Shift+G` fill group contains the Paint Bucket and the Gradient only, so the Magic Eraser has no shortcut at all.

**Sources**

- <https://helpx.adobe.com/photoshop/using/tool-techniques/magic-eraser-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335> — Adobe's CS3 manual, on a mirror
- <https://www.glensmith.co.uk/photoshop/magic-eraser>
- <https://www.ephotozine.com/article/introduction-to-photoshop-s-magic-eraser-tool-18410>
- <https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Magic_eraser.html>
- <https://www.teachucomp.com/the-magic-eraser-tool-in-photoshop-elements-instructions/>
- <https://community.adobe.com/questions-712/why-does-the-magic-eraser-tool-delete-everything-1055165>

---

## Paint Bucket Tool

Fills the whole connected region of similar color around the click in a single click. Shares a Tools-panel slot with the Gradient tool; Adobe's page says so and the `G` / `Shift+G` cycle follows from it.

**Adobe's bar, in their order**: Fill (Foreground or Pattern), then under Blending the Mode, then Opacity, then Tolerance, then Anti-alias, Contiguous and All Layers. Adobe's Tolerance note is the useful one: "Lower values (10-20) fill similar colors, while higher values (100 or more) fill a broader range," and "Lower opacity values create more transparent fills."

| Photoshop control | What it does                                                     | Default / range | App       | Why                                                                                                      |
| ----------------- | ---------------------------------------------------------------- | --------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| Fill              | Foreground, or Pattern (which enables a second dropdown)         | Foreground      | `partial` | `Foreground` enabled and live; `Pattern` `disabled` at `PaintBucket.tsx:51` — no pattern registry exists |
| Mode              | Blend mode for the fill                                          | Normal          | `missing` | `FillToolArgs` declares no blend mode, and the fill writes into the _active_ layer's pixels              |
| Opacity           | Lower values create more transparent fills                       | 100; 0–100      | `present` | Real straight-alpha source-over                                                                          |
| Tolerance         | Range of colors filled                                           | 32; 0–255       | `present` | Shared with the Magic Eraser against one constant                                                        |
| Anti-aliased      | Smooths the filled area's edges                                  | on              | `inert`   | Same hard-threshold mask as the Magic Eraser                                                             |
| Contiguous        | On: only pixels contiguous to the click. Off: all similar pixels | on              | `present` | Shared flood-fill code                                                                                   |
| All Layers        | Fill from the merged color data of all visible layers            | off             | `missing` | Reads only the active layer                                                                              |

**`Mode` is `missing` for a structural reason that is worth more than the fact itself.** The Paint Bucket is a `commit: 'raster'` tool that edits the **active** layer's pixels in place, so a blend mode here would be a per-pixel composite against a destination the processor does not address — unlike the Brush, where the stroke creates its own layer and a layer blend mode is exactly the right seam. Adding it needs both an args field and a different composite primitive.

**`Pattern` is `partial` rather than `missing` because half of it works.** The `Fill` control itself is real: the readout shows the store's foreground color live, so a user can see what the click will paint, and `Foreground` is the one fill the tool performs. The `Pattern` option is present with its real label and `disabled`.

**The one place this implementation is better than the obvious version.** The fill is a real source-over (`blendPixel`, `fill.ts:151`), not a lerp of straight RGB against straight RGB. The difference is visible at partial opacity over a transparent region, where a lerp writes half the fill color mixed with half of nothing — half-black — and correct compositing writes half coverage of clean red. Adobe's own sentence, "Lower opacity values create more transparent fills," only holds if the fill color survives the blend.

**The commit is the click, with no drag.** `FillToolArea` handles `pointerdown` and nothing else, by design: Photoshop commits the fill on the click, so a drag-to-adjust gesture would add a second history state the product does not have. A fill that matches nothing writes no history at all — the mask is computed before the commit, and a null result ends the gesture silently.

**Keyboard.** `G` selects it, `Shift+G` cycles back from the Gradient. Matches Photoshop.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=359> — Adobe's CS3 manual, on a mirror
- <https://www.underwaterphotography.com/photoshop/photoshop/1_12_8_0.html>
- <https://www.mediacollege.com/adobe/photoshop/tool/paint-bucket.html>
- <https://www.glensmith.co.uk/photoshop/paint-bucket>
- <https://www.photoshopbuzz.com/how-to-use-paint-bucket-tool/>
- <https://shotkit.com/paint-bucket-photoshop/>

---

## Clone Stamp Tool

Copies pixels from one part of an image and paints them into another. Adobe's gesture, verbatim: "Press the Alt key (Windows) or the Option key (macOS) and click the area of the image that you want to copy. This sets a starting point from which the tool will begin copying. Release the Alt or Option key and drag over the new area where you want to place your copied content."

**Full bar, left to right** — `[Tool presets] | [Brush presets] | Mode ▾ | Opacity :100% | Flow :100% | ⊙Pressure-for-opacity | ☑Aligned | Sample ▾ | ☐Ignore Adjustment Layers | ⊙Pressure-for-size | [Clone Source / Brush panel toggle]`.

`Flow` and the airbrush semantics are the Brush tool's, already researched there, so they are not re-derived. `Sample` and `Ignore Adjustment Layers` are Adobe's CS4 manual verbatim, and the manual names the position of the second control, which is the part most third-party pages get wrong:

> Sample — Samples data from the layers you specify. To sample from the active layer and visible layers below it, choose Current And Below. To sample only from the active layer, choose Current Layer. To sample from all visible layers, choose All Layers. To sample from all visible layers **except adjustment layers**, choose All Layers and click the **Ignore Adjustment Layers icon to the right of the Sample pop-up menu**.

The button was added in CS3 as an unlabeled toggle, per properproof's write-up: "Adobe Photoshop CS3 includes a small improvement… a new, unlabeled button that lets you ignore all adjustment layers while cloning," motivated by a concrete failure — "If we start using our clone tool with the color adjustment layer visible, and our clone tool set to 'Sample All Layers' we end up cloning with a weird green hue." Four independent sources place it immediately right of the Sample menu: two mirrors of the CS4 manual, jkost, and underwaterphotoshop.

**Aligned is two different rules, and this is where the app is wrong.** Adobe: "Select Aligned to paint the most recent sampling point. Deselect Aligned to restart sampling from the original point each time." The most precise statement of the mechanism is uidaho's tool-bar page, and it is not what the arithmetic is usually written to do:

> If you have Aligned checked, your clones will be applied as if you were working with **a copy of the image that has been displaced the distance of your first stroke after Alt-clicking**. All subsequent strokes (prior to another Alt-click) will fill in the copied image relative to that first stroke. When you do not have Aligned checked, all (separate) strokes after an Alt-click will apply **from the single spot that you Alt-clicked**. Each time you end one stroke and make a new one, the new one will use the same starting spot.

So the anchor is established **once, at the first stroke after the Alt-click, and persists across strokes** until another Alt-click replaces it. Aligned and unaligned are the same subtraction against two different anchors: a stored one versus the fixed Alt-clicked point. The same page states the unaligned consequence for the reader directly: "Thus you can repeatedly apply the same image data (the Alt-click location) to different spots."

**The app implements neither arm.** `cloneOffset` at `src/tools/cloneStamp.ts:89` takes the **current gesture's** path and anchors to `points[0]` when aligned, `points[points.length - 1]` when not. There is no field anywhere on `CloneStampToolArgs` for a stored offset. Consequences:

- _Aligned_: the offset is constant within one stroke — which matches — and re-anchors to each new stroke's own start, which is precisely the drift the mode exists to remove. The control is wired and reads as its own value; it is `partial`, not `present`.
- _Unaligned_: the read point slides backwards by the drag's displacement as the gesture progresses, rather than staying at the Alt-clicked spot with only the destination moving.

Both arms are one subtraction, so this is a **missing anchor, not a wrong formula** — the fix is a stored offset on the args, not new pixel code. This is the single most consequential finding on this tool.

**The source-not-output guarantee is real, and it holds for a structural reason worth naming twice.** Every read in `cloneDab` indexes an immutable copy of the raster and every write indexes the buffer, so no dab can sample a texel a previous dab laid down. The copy is taken once per _processor invocation_, and the guarantee upgrades to once per _stroke_ for a second reason: the live preview re-runs the processor on every pointer move but always against the store's own pre-stroke raster, never the previous frame's preview — `src/contexts/useLayer.ts:557` reads `layers[id].tmpCanvas ?? layers[id].bitmap` from the store layer, while the accumulated preview lives in `previewLayersRef` and is never the input. The commit then re-runs the processor once over the whole path before publishing. So neither the live preview nor the committed stroke can compound itself.

**The Photoshop side of that is not a documented guarantee, and the honest record says so.** See `## Unverified`: the widely repeated "Photoshop samples the source once at stroke start" rule is folklore with no Adobe source. What _is_ sourced is the artifact and its documented remedy — the classic failure being that the source cursor reaching the area already painted makes the removed thing reappear, with the advice to "clone-stamp a little bit at a time… stamp a little, release, stamp a little, release" (graphicdesign.stackexchange). That the remedy is needed is itself the evidence that a per-stroke snapshot is not something Photoshop can be relied on to provide, which is what makes the app's structural version worth stating as a divergence in its favour.

**Layer edge cases.** Adobe states one directly: "Make sure you are not working on an adjustment layer. The Clone Stamp tool does not work on adjustment layers." The app's gate (`CloneStampToolArea.tsx:210`) refuses the Bedrock layer and requires a source, but it **does not check the layer's lock flag** — and `psd-utils.ts:268` round-trips that lock as `protected: { composite, position }`. So a layer the UI presents as locked will still accept a cloned stroke, and a file saved from that state is protected in a reader and freely overwritable in the editor. That is the opposite failure direction from the Eraser's, which at least honours the Bedrock refusal.

`Ignore Adjustment Layers` has nothing to ignore here even in principle: a layer source in this app is `blank`, `image`, `tool` or an `affine-transform` operation, and Levels, Color, Transform and Blur are destructive operations on a raster rather than layers sitting above a clone target.

**The Clone Source panel** holds up to five sampling sources, "these can be from the same document or from multiple documents" (photoshopcafe), with per-source flip, rotate, scale and opacity, a Show Overlay checkbox, and a Clipped option that limits the overlay to the brush size. Since CS4 the sampled source is displayed live under the brush, which hoffmanartdesign credits to a feature "migrated over from the Vanishing Point filter" and describes as "a colored blob that is the source of confusion for many people." None of it exists in the app; the only trace of the idea is a crosshair drawn on the overlay canvas.

| Photoshop control               | What it does                                                             | Default / range | App       | Why                                                                               |
| ------------------------------- | ------------------------------------------------------------------------ | --------------- | --------- | --------------------------------------------------------------------------------- |
| Brush Preset Picker             | Tip popout with Size, Hardness, gear, grid                               | last used       | `missing` | No tip picker; the app renders both sliders as top-bar controls instead           |
| Mode                            | Blend mode for the copied pixels                                         | Normal          | `missing` | `commit: 'raster'` on the active layer; the one composite primitive takes no mode |
| Opacity                         | Strength of each stamped copy                                            | 100; 0–100      | `present` | Mapped onto the tip engine's per-dab coverage                                     |
| Flow                            | Per-dab build-up, as on the Brush                                        | 100; 0–100      | `missing` | No args field                                                                     |
| Always Use Pressure for Opacity | Forces pressure onto the copy's opacity                                  | off             | `missing` | No pressure pipeline                                                              |
| Aligned                         | Offset fixed at the first stroke's displacement, held across strokes     | on              | `partial` | Wired, but re-anchors per stroke; see above                                       |
| Sample                          | Current Layer / Current & Below / All Layers                             | Current Layer   | `missing` | Reads the active layer's own raster only                                          |
| Ignore Adjustment Layers        | Samples all visible layers except adjustment layers                      | off             | `missing` | No adjustment layers exist in the app                                             |
| Always Use Pressure for Size    | Forces pressure onto the tip size                                        | off             | `missing` | No pressure pipeline                                                              |
| Toggle the Clone Source panel   | Five sources, each with flip/rotate/scale/opacity, Show Overlay, Clipped | closed          | `missing` | No panel, no second source, no source geometry                                    |

**What matches.** The Alt-click sets the source at **pointer-down** and paints nothing; the decision is made at down, so a drag that began as a plain press keeps cloning even if the modifier is released mid-stroke, and a press that began with it down never starts a stroke at all. Both the source and the stroke are rebased into the active layer's frame, which is safe precisely because the processor only uses their _difference_. With no source set the gesture is **refused** — not-allowed cursor, no stroke, no history entry — rather than accepted and committed as a no-op. The copy carries the source texel's own alpha, so cloning out of a transparent region leaves the destination transparent instead of painting it opaque black. Size, Hardness and Opacity are all wired, and the tip is borrowed from the shared brush engine, so a soft Clone edge is the same soft edge.

**Keyboard.** `S` selects it, matching Photoshop.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/heal-clone/retouch-images-with-the-clone-stamp-tool.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/clone-stamp-tool.html>
- <https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/209> — Adobe's CS4 manual, on a mirror
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=211> — the same manual, independent mirror
- <https://www.properproof.com/digital/Photoshop/photoshop_cs3s_clone_tool_adds_ignore_adjustment_layers_option.html>
- <https://www.underwaterphotoshop.com/power-of-the-clone/>
- <https://jkost.com/blog/2021/12/10-tips-for-the-clone-stamp-and-healing-brush-tools-in-photoshop.html>
- <https://photoshopcafe.com/cs3/CS3.htm>
- <https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Clone_stamp_tool.html>
- <https://www.webpages.uidaho.edu/larc246/toolBarPages/cloneStamp.htm>
- <https://www.glensmith.co.uk/photoshop/clone-stamp>
- <https://www.psdvault.com/basics/photoshop-clone-stamp-tool/>
- <https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/>
- <https://graphicdesign.stackexchange.com/questions/21866/why-does-the-clone-stamp-tool-seem-to-be-misaligned>

---

## Unverified

Claims that came up in the brief, in the prior research corpus, or in this pass and could **not** be established from a source that was actually opened. They are deliberately absent from `paint.ts`. Each entry names the URL that came closest.

- **The Tool Preset Picker as a current options-bar control, and the exact version that removed it.** The claim is sourced only for its absence: clippingpathca.com (2025) says Tool Presets "had their own dropdown menu at the far left of the Options bar" in "Photoshop CS6 or early CC versions" and that they are "now found inside the Brush Settings or Presets interface." The removal is therefore dated only as "by 2025, and after early CC" — no Adobe page stating the version that folded it in was opened. The control's own menu contents (`New Tool Preset`, `Rename Tool Preset`, `Delete Tool Preset`, `Reset Tool`, `Reset All Tools`) come from two blogspot/HTML transcriptions of the CS2 menus, which is weak sourcing and is the reason those items are described from the secondary clippingpathca page rather than quoted. `paint.ts` states the current absence and the fold-in, and records no row for the control. Closest URL: <https://clippingpathca.com/photoshop-tool-presets/>.
- **Holding `Alt` to re-stamp a single dab many times without moving the mouse.** The brief lists this as a Clone Stamp behaviour; two rounds of searching produced no source for it. What was found is adjacent and weaker: graphicdesign.stackexchange on repeatedly cloning from a static point — "If you copied from a static point constantly it would create strange patterns. This can be avoided by 'spacing' out the cloning action. Simply clicking repeatedly accomplishes this 'spacing' action" — which describes _repeated clicking_ building up repeated identical dabs, and is a technique, not a modifier. No Adobe page stating an `Alt`-hold re-stamp gesture was opened, so the data file records `Alt` as source-setting only, which is what `CloneStampToolArea.tsx:343` actually implements. Closest URL: <https://graphicdesign.stackexchange.com/questions/31245/how-can-i-use-the-clone-stamp-tool-with-a-static-source-point-in-adobe-photoshop>.

- **Holding `Alt` to re-stamp a single dab many times without moving the mouse.** The brief lists this as a Clone Stamp behaviour; two rounds of searching produced no source for it. What was found is adjacent and weaker: graphicdesign.stackexchange on repeatedly cloning from a static point — "If you copied from a static point constantly it would create strange patterns. This can be avoided by 'spacing' out the cloning action. Simply clicking repeatedly accomplishes this 'spacing' action" — which describes _repeated clicking_ building up repeated identical dabs, and is a technique, not a modifier. No Adobe page stating an `Alt`-hold re-stamp gesture was opened, so the data file records `Alt` as source-setting only, which is what `CloneStampToolArea.tsx:343` actually implements. Closest URL: <https://graphicdesign.stackexchange.com/questions/31245/how-can-i-use-the-clone-stamp-tool-with-a-static-source-point-in-adobe-photoshop>.
- **"Photoshop samples the clone source once at stroke start" as a guarantee.** This is the most-repeated claim about the tool and the basis of the brief's "source-not-output" framing, and no Adobe or independent source stating it was opened. The claim is also in tension with the sourced evidence: the documented remedy for the self-overlap artifact is to end the stroke and start again, which would be unnecessary if the source were guaranteed frozen for the stroke. `paint.ts` therefore asserts nothing about Photoshop's internal snapshot timing. It records the _artifact_ and the _remedy_ — in `purpose`, as a consequence of dragging over the copy area — and states the app's own guarantee in `appNotes`, where it is a code fact I derived. Closest URL: <https://graphicdesign.stackexchange.com/questions/21866/why-does-the-clone-stamp-tool-seem-to-be-misaligned>.
- **What happens when `Aligned` is switched off mid-stroke, and the exact source-offset reset.** The two arms of the mode are well sourced (Adobe's help page for the "most recent sampling point" / "original point" pair, and uidaho for the displacement-of-the-first-stroke mechanism), but nothing was found describing a mid-stroke toggle. The nearest statement — the CS2/CS3/CS4 book at neathphotographicsociety.co.uk's "Samples pixels continuously, without losing the current sampling point, even if you release the mouse button" — describes behaviour across strokes, not across a live toggle. The data file's `Aligned` detail states the two stroke-to-stroke rules and stops there.
- **The Clone Stamp on a locked-transparency layer or a Background layer.** Adobe documents the tool refusing adjustment layers, and the general lock rule is sourced for other commands (lapseoftheshutter: a pixel lock or a full lock prevents the command), but no source was opened stating what the Clone Stamp does on a locked or Background layer. The data file makes no Photoshop claim either way. The app-side fact is asserted from code instead: the gate at `CloneStampToolArea.tsx:210` checks `isBedrock` and `source` but not `locked`, and `psd-utils.ts:268` exports that lock as `protected: { composite, position }`. Closest URL: <https://www.lapseoftheshutter.com/photoshop-replace-color-not-working/>.
- **The `Always Use Pressure for Opacity` / `for Size` toggles specifically on the Clone Stamp's bar.** tipsquirrel.com enumerates the tools carrying them — "Found in the Heal, Brush, Clone, Art History, Eraser, Smudge and Dodge/Burn tools" — which is one source naming Clone explicitly, and the Wacom guide establishes the pair for the Brush. No source showing the pair on the Clone Stamp's own bar was opened, so both rows rest on the single enumeration. Closest URL: <https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/>.
- **The Clone Source panel's per-source flip, rotate, scale and opacity controls, and its Clipped option.** These come from one third party (neathphotographicsociety.co.uk, whose text is Adobe's own manual) corroborated only in part by brysonleidich.com for flip, rotate and Clipped. The five-source limit and Show Overlay are independently sourced by photoshopcafe.com. The scale and opacity controls are single-sourced. Closest URL: <http://www.neathphotographicsociety.co.uk/Tutorials/Photoshop/Cloning_and_Repairing.pdf>.
- **The Paint Bucket's Shift-drag multiple-fill sequence.** The well-known behavior — that a Shift-click with the bucket adds a further region to the fill set and that the previous fill is replaced rather than stacked, so several separate clicks compose into one fill and one undo. Two rounds of searching produced only unrelated Shift-click behaviors: Manifold's own paint bucket (a different product, where Shift-click overrides Contiguous), and colorwithleo.com's "Shift-click to fill while preserving hard edges." Nothing from Adobe or from an independent source establishes the sequence or its history semantics, so it is not asserted here and the app's `FillToolArea` is described as click-only with no drag. Closest URL: <https://manifold.net/doc/mfd8/paint_bucket_tool.htm>.
- **The Magic Eraser and Paint Bucket work per-channel, unlike the ordinary Eraser.** The claim that tolerance is applied to color channels independently, so a click can clear one channel and leave others, which is why the Magic Eraser can strip a single channel out of a photograph. This is widely repeated in forums and is consistent with the app's own 3-channel RGB distance, but no Adobe or independent source stating it was opened. The `## Unverified` boundary is why the data file says only that the tool "erases every pixel similar to the one you click" and makes no claim about per-channel behavior. Closest URL: <https://helpx.adobe.com/photoshop/using/tool-techniques/magic-eraser-tool.html>.
- **The Color Replacement Tool's default Tolerance of 30%.** adobeessentials-class sources state "The default value is 30% which is usually a good starting point," but Adobe's own manual gives only the range ("ranging from 0 to 255") and no default. The data file records the range as Adobe's and names 30% explicitly as a third-party figure. Closest URL: <https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/215>.
- **The Color Replacement Tool's keyboard shortcut (`Shift+S`).** No source stating the letter was opened. Adobe's CS4 manual establishes only that the tool lives in the Brush tool's flyout ("If the tool isn't visible, access it by holding down the Brush tool"), which does not imply `Shift+S`. The data file therefore records no shortcut, and the app's `Shift+B` cycle reachability is stated in `appNotes` instead. Closest URL: <https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/215>.
- **`Shift+[` and `Shift+]` for tip Hardness, in 25% steps.** The prior research pass recorded these from a 2026 training PDF and a brush-ladder page; neither was re-opened in this pass, so the shortcut is omitted rather than carried forward on a second-hand record. The bare `[` / `]` size shortcuts _were_ re-opened this pass and are asserted. Closest URL in this pass: <https://asktimgrey.com/2017/03/21/pencil-brush-shape/>.
- **`Shift`+digit keys driving Flow, and the Airbrush swap that reverses that binding.** Widely repeated; no source opened this pass. The bare digit-to-Opacity binding was opened (flylib's _Photoshop CS Savvy_: "When the Brush tool is active, you can type a number from 01 to 100 to set the opacity on the Options bar") and is asserted; the Shift variant is not.
- **The Magic Eraser's keyboard shortcut.** Adobe's own help page prints "Select the Magic Eraser tool (E) from the toolbar," which contradicts the convention that `E` selects the Eraser group. No source binding it to a distinct letter was found, and the contradictory Adobe text was not treated as establishing one. The data file records no shortcut. Closest URL: <https://helpx.adobe.com/photoshop/using/tool-techniques/magic-eraser-tool.html>.
- **The Eraser's `Flow` in Pencil mode.** Adobe's current page says Size, Hardness, Opacity and Flow are adjusted "in Brush and Pencil modes," but a third-party reference (uidaho.edu's tool-bar page) says "When pencil is chosen, the Flow setting is not available." The data file follows Adobe, the current authority, and records Flow without a mode restriction. If the third party is right, the Eraser's Flow row is over-scoped in the current Photoshop UI. Closest URL: <https://www.webpages.uidaho.edu/larc246/toolBarPages/eraser.htm>.
- **The Paint Bucket's `Mode` list includes `Behind` and `Clear` beyond the 27 layer modes.** jkost's CS3 tips PDF says so ("The Paint Bucket has two additional blend modes: 'behind' for filling transparent images, and 'clear' for erasing based on the color clicked on"), but that is a 2003-era source and Adobe's current page does not enumerate the list. The data file says "the 27 layer blend modes plus Dissolve, Behind and Clear" for the Brush, following the general paint-mode convention, and does not make a bucket-specific claim. Closest URL: <http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf>.
- **Photoshop's default `Size` and default selected preset on a fresh launch.** Sources conflict outright — sydspix.wordpress.com says "default soft round 90 pixel brush," linkedin.com's 2024 course says "General Brushes, the Hard Round brush" — and `Reset Tool` restores the last-used size rather than a factory number. No default is asserted for the app or for Photoshop anywhere in `paint.ts`. Closest URL: <https://sydspix.wordpress.com/2023/02/26/how-to-decide-which-sketch-brush-to-use/>.
- **Any `developer.adobe.com` scripting reference for exact parameter names, ranges or defaults** for these seven tools' options-bar state. The brief notes this domain is fetchable where `helpx.adobe.com` is not; no `developer.adobe.com` page establishing a paint-family parameter was opened this pass, so no batchPlay-level claim appears in `paint.ts`.
