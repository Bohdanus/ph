# FOCUS AND TONE — research notes

The seven tools whose Photoshop names are the Blur, Sharpen and Smudge focus tools, the Dodge and
Burn tonal tools, and the Gradient tool. Every `file:line` below was re-derived against the
working tree in this worktree; every Photoshop claim below traces to a URL in that tool's
**Sources** list, or is admitted as unverified in the `## Unverified` section at the end.

**What the re-audit pass changed, so a reader knows what to distrust.** A second pass re-derived
every `file:line` in the data file against this worktree and re-opened Adobe's current pages for the
bar enumerations. Two classes of thing turned up. The first is stale line numbers: **six of the
sixty-six `implementationRefs` in `focus.ts` pointed at the wrong line** — five `settings.ts`
seeds, all off by a few lines, and the one `toolbar-mapping.ts` line, which was off by one and
pointed at the `Burn` row's neighbour rather than the `O` declaration it was cited for — and
**eighteen more in this file's prose**. They are corrected, and the corrections are the point: the
audit that only checks that a path resolves would not have found any of them, because every one of
these paths resolves. The second is claims that were wrong rather than merely thin, and there are
four: the Gradient's `[`/`]` style-cycling rows, which **contradicted** Adobe's own keyboard list;
the claim that no page says the Blur's `Mode` list is restricted, which was itself wrong in the
other direction; the claim that four keys are "registered on no keyboard handler at all" when two of
them are; and the Smudge's `Mode` default. Three `shortcuts` gaps were closed at the same time (the
Smudge's `R`, the Dodge's and the Burn's tonal-range trio, the brush-size pair on all three). The
reasoning behind the `partial` verdict is now written into each `appNotes` rather than living only
here, which is where it belongs — three tools inheriting one verdict from a notes file is how a
verdict quietly becomes an unexamined default.

**How the recovered session findings were treated.** A later pass recovered Photoshop research
from past sessions that never reached disk, and it was used in preference to re-deriving. Each
load-bearing claim in it was then re-checked with a live search. The ones that survived are folded in;
the ones that could not be sourced from any page I opened are in `## Unverified`; and the ones that
were **corrected** by what the searches returned are recorded here, because a correction is exactly
as load-bearing as the claim it replaces:

- **`Transparency` is not on the modern Gradient tool's bar at all.** It belongs to the **Classic**
  gradient only, and the recovery's "Transparency default OFF" is therefore not a fact about the
  tool this description is for. Source: <https://www.teachucomp.com/how-to-use-the-gradient-tool-in-photoshop-instructions/>
  — "to enable transparency in the gradient pattern if using the classic Gradient Tool, check the
  'Transparency' checkbox. **This checkbox is not available for the new Gradient Tool.**"
- **`Mode` and `Opacity` are Classic-only too, for the same reason.** The same page, on the same
  heading — "To select the blending mode of the gradient if changing pixels in a raster layer using
  the classic Gradient Tool, select a choice from the 'Mode' drop-down … **Note that these
  drop-downs do not appear in the Options bar Control panel if using the new Gradient Tool, as it
  applies its gradient adjustment in a separate adjustment layer.**" A second walkthrough puts the
  extra settings in the same place: choosing "Classic Gradient" is what produces "a few extra
  settings in the Options bar – Blend Mode, Opacity and Transparency"
  (<https://andrewhaysom.myportfolio.com/the-gradient-tool-changes-in-ps-2023>). On the live tool
  both are properties of the Gradient Fill layer in the Layers panel instead, which is what the
  data file's `appNotes` now says about the app rendering an Opacity slider.
- **The Gradient bar also has a `Tool Mode` dropdown** the recovery did not mention, and it is not
  cosmetic: it chooses between the live gradient and the destructive Classic gradient and _changes
  which options follow it_. Source: the same teachucomp page.
- **`Protect Detail` is on the current desktop bar, and the earlier "Elements only" reading was
  wrong.** Adobe's own current desktop page enumerates the Sharpen bar and instructs the reader to
  "Select **Protect Detail** to minimize pixelation and maintain image quality"
  (<https://helpx.adobe.com/photoshop/desktop/effects-filters/smart-filters/sharpen-a-selection.html>,
  indexed 2026-02-23), in the position the earlier draft had guessed wrong about. The Elements
  reference is kept as corroboration and as the source of the
  longer wording, but it is no longer the only one, and the row no longer carries a caveat saying
  the desktop bar is unverified.

The rule applied to a control's inclusion in the data file is stated once and used throughout: **a
row may appear if a page I opened puts that control on that tool, even from an adjacent Adobe
product, provided the row's `detail` names which product and version documented it. A row may not
appear if the only thing behind it is the recovered note.** That is why `Protect Detail` is in the
Sharpen's options and `Flow` and the Blur's `Sample Size` are not.

## The premise this family inherits, and what happened to it

The research corpus carries a correction that reads: **"The Blur Tool is Illustrator-only" is
WRONG; Photoshop has a Blur tool (Tools panel, ~2023+)**. The first half is right and the second
half is a fresh error, in the opposite direction.

The Blur, Sharpen and Smudge tools are not new. They are listed in the tools reference appendix of
_Essential Photoshop 6 for Web Professionals_ (2000) as the **Focus Tools — Blur, Sharpen,
Smudge**, which puts all three in Photoshop 6.0 at the latest; the same book's Dodge chapter and
its **Toning Tools — Dodge, Burn, Sponge** list put the tonal pair there too. The _Adobe Photoshop
CS3 User Manual_ then documents the Blur tool in full — brush tip, blending mode, strength and
"Use All Layers" — so by 2007 nothing about it was in question. The CS2 keyboard reference
(`flylib`) gives the Blur tool the `R` slot, names its three controls explicitly, and gives the
precise per-tool checklists that the shared options bar is still organised around. The Photoshop
CS2 A–Z reference states plainly that `Sample All Layers` is "found in the options bar of the
Clone Stamp, Smudge, Blur, Sharpen, Paint Bucket and Healing Brush tools".

The one genuinely recent thing in this family is the **Gradient tool's on-canvas controls** and its
**live/classic Tool Mode dropdown**, which Adobe shipped in the **24.5 release (May 2023)**. The
other recent thing is the Gradient's **Method** default, which changed in **23.0**. That is where a
version note belongs in this family, and not on the Blur tool.

| Tool                                                    | Earliest version established | Evidence                                                                                                                          |
| ------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Blur, Sharpen, Smudge                                   | **6.0** (September 2000)     | Focus Tools listed in the PS6 tools reference; fully documented in the CS3 manual                                                 |
| Dodge, Burn, Sponge                                     | **6.0** (September 2000)     | Toning Tools listed in the same PS6 tools reference                                                                               |
| Gradient (all five types)                               | **5.0**                      | The PS5.0 user manual documents Linear, Radial, Angular, Reflected and Diamond and the Transparency stop                          |
| `Protect Tones` on the Dodge/Burn bar                   | **CS4** (October 2008)       | The CS4 launch review names "the new 'Protect Tones' feature for the Dodge and Burn tools"; the CS4 manual documents the checkbox |
| Dodge/Burn rebuilt around the tonal engine              | **CS5** (2010)               | "Luckily, back in Photoshop CS5, Adobe updated these tools, which totally fixed the problem"                                      |
| Gradient `Method` becomes Perceptual by default         | **23.0** (November 2021)     | "Adobe recently updated Photoshop to contain a better interpolation system for gradients with version 23.0"                       |
| Gradient `Tool Mode` + on-canvas handles + live preview | **24.5** (May 2023)          | Adobe's 24.5 announcement; the teachucomp walkthrough of 24.5's bar                                                               |

**The Dodge/Burn dating was a decade out, and it was one row doing two jobs.** The old table said
"~2020–2021" for a row that bundled the rebuild with `Protect Tones` becoming default-on, and the
only evidence behind that year was a January 2021 training article describing the current tools.
`Protect Tones` is much older than that: it is announced in the **CS4** launch coverage —
"Retouchers will also be pleased with the new 'Protect Tones' feature for the Dodge and Burn tools"
(<https://www.dvhardware.net/reviews/164/photoshop_cs4>) — described in the same release as "one of
the most improved features in CS4" (<https://forums.macrumors.com/threads/my-adobe-photoshop-cs4-review.585806/>),
and documented in Adobe's own CS4 manual: "Select the **Protect Tones** option to minimize clipping
in the shadows and highlights. This option also tries to keep colors from shifting hue"
(<https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=217>). The **rebuild** is
the later of the two and is **CS5**: "Luckily, back in Photoshop CS5, Adobe updated these tools,
which totally fixed the problem" (<https://planetphotoshop.com/using-the-dodge-and-burn-tools-2.html>).
So the two are now separate rows. The **default-ON** state is unchanged and still rests on
`fstoptraining` alone; no source here states a default for it, and the row says so by omission
rather than claiming otherwise.

## Blur Tool

Photoshop's Blur tool paints a blur under the brush: the more you paint over an area, the blurrier
it becomes, and the whole stroke is one history state. It is the member of the focus trio that
**reduces local contrast and smooths** — the direction that separates it from the Sharpen, which
increases local contrast at edges over a wider radius with an unsharp-like falloff, and from the
Smudge, which transports pixels rather than transforming them. The bar is one bar shared with both
siblings: a brush preset (Size, Hardness), a Mode, Strength and Sample All Layers. Adobe's own
product page tells you to use `[` and `]` to resize the tip and to reach for Strength when the
effect needs to be stronger, and the `flylib` per-tool checklist is the compact form: "Double-check
the following: the Mode pop-up menu, Strength, and Sample All Layers checkbox. Typical Problem: The
default 50% setting for Strength is usually too high for most situations."

`Sample All Layers` is the control that makes the tool non-destructive in practice: on a blank layer
above the stack the blur is separable, opacity-adjustable, and erasable.

It is a genuinely different thing from `Filter > Blur` and from the Blur Gallery, which are
one-shot commands over a whole selection or layer with no brush and no per-stroke build-up. The
initial research brief's "Illustrator-only" premise is the error being corrected here; the
correction itself then over-corrected in the opposite direction.

| Control             | Photoshop behaviour                                                     | Default / range | App status            | App source |
| ------------------- | ----------------------------------------------------------------------- | --------------- | --------------------- | ---------- |
| Brush Preset Picker | The tip, with Size and Hardness                                         | preset library  | `missing`             | —          |
| Mode                | Blend mode the blurred result composites with                           | Normal          | `missing`             | —          |
| Strength            | Percent of the blurred result blended per pass                          | 50%, 1–100      | `missing`             | —          |
| Sample All Layers   | Blur from the composite so the result can be painted onto a blank layer | off             | `missing`             | —          |
| _Flow_              | _reported on the shared bar; see `## Unverified`_                       | _50%, 1–100_    | _omitted — unsourced_ | —          |

**The `Strength` floor is 1%, not 0%, and the range is not Adobe's to state.** No Adobe page gives
the range on any of the three tools, so it is attributed to the books and reports that do. The CS2
Bible covers all three in one sentence — "When using the Blur or Sharpen tool, the Opacity option
changes to Strength. The value determines the degree to which the tool changes the focus of the
image, **1 percent being the minimum and 100 percent being the maximum**. Strength also appears
when using the Smudge tool"
(<https://flylib.com/books/en/2.816.1.14/1/>) — and a 2009 report on the tool says the same thing
twice in one thread: "The PS blur tool can be set from 1-100%, check your settings in the top
options bar" (<https://www.photoshopgurus.com/forum/threads/why-doesnt-the-blur-tool-ever-work.22153/>).
The 50% default is unchanged and is Adobe-attributable, and so is the 10–30% / 50%+ guidance. The
range correction has one app consequence and it is recorded on the Smudge, where the bar's own
minimum is 0.

**The `Mode` row no longer claims a restricted list.** It previously said the list "is restricted to
the modes that make sense for a blur, including Normal, Darken, Lighten, Hue, Saturation, Color and
Luminosity". The seven names are third-party attested; the _restriction_ is not, by anything, and
Adobe's current Blur page does not enumerate a `Mode` control at all. The data file's `detail` now
attributes the seven to third-party walkthroughs and says plainly that no page states the list is
restricted. See `## Unverified` 13.

**App verdict: not the tool.** The app's blur is a whole-layer filter panel. Its bar is a single
`Blur Radius` slider (`src/components/ToolbarsRight/Blur/Blur.tsx` — `Blur()`'s `Blur Radius`
slider, range 0–100 px) plus its `Undo Blur` button, and its only argument is a radius handed to
the canvas blur filter (`src/tools/blur.ts` — `blur()`) — a true Gaussian, so the closest thing in
this editor to `Filter > Blur > Gaussian Blur`, wearing the Blur tool's name. There is no gesture
surface, and the surface it gets is **`DummyToolArea`**, not the Sharpen's: `Main`'s tool-area
dispatch has no `blur` branch, so blur falls through to the default (`src/components/Main/Main.tsx`
— `renderContent()`, whose last branch is `DummyToolArea`), which renders `display: none`
(`src/components/Main/DummyToolArea.tsx` — `DummyToolArea()`). The Sharpen is a different component
that reaches the same rendering on purpose — it mounts its own `SharpenToolArea`
(`src/components/Main/SharpenToolArea.tsx` — `SharpenToolArea()`), and that component's own JSDoc
is what says blur "has no tool area at all and falls through to `DummyToolArea`". Identical
rendering, two components; "the same surface the Sharpen uses" was wrong. It is registered as a
`layer-operation`, not a `raster` (`src/tools/toolProcessors.ts` — the `toolProcessors` registry's
`blur` entry), and its single seeded arg is a radius (`src/tools/settings.ts` —
`defaultSettings.blur`). All four recorded controls are `missing`, none `partial`: there is nothing
here for a partial rating to attach to. The recovered `Flow` control is missing too, and
structurally so — the app has no per-dab/per-stroke opacity pair to express one with.

**Why `partial` and not `placeholder`.** `placeholder` is defined (`src/tools/descriptions/types.ts`
— the `ToolImplementationStatus` JSDoc's `placeholder` bullet) as _selectable but committing
nothing_ — no gesture surface, `commit: 'unimplemented'`, an `imageProcessor` that returns `null`.
The app's blur does commit: it returns a real convolved canvas (`src/tools/blur.ts` — `blur()`)
under `commit: 'layer-operation'`, and `commitDirtyTool` bakes it into a layer plus a history
entry. So it is not a placeholder, and it is not `implemented` either, because what it commits is a
whole-layer Gaussian filter rather than a per-stroke brush. `partial` — "the app does something
Photoshop's tool also does, but not the same something" — is the only value left. The same argument
carries the Sharpen and the Gradient, and is now stated in each of their `appNotes` too, because
three tools inheriting one verdict is exactly where a reviewer should expect the reasoning to be
written down.

**The `Mode` row is softer than it was, because one page does claim a restriction.** An earlier
draft said no page claims the list is restricted; one does. The University of Idaho's CS-era
walkthrough of this very bar says of the Mode dropdown that "this tool only offers a limited number
of blends to choose from" (<https://www.webpages.uidaho.edu/larc246/toolBarPages/blur.htm>), and
Wikiversity says the same of "the latest edition". Neither says _to what_, so the row now reads as
"one of them says the dropdown only offers a limited number of blends, but no page states to what
the list is restricted". See `## Unverified` 13.

**The slider previews; it does not commit.** The bar routes through `tempUpdateLayer`
(`src/components/ToolbarsRight/Blur/Blur.tsx` — `throttledOnChange()`), the only writer of
`previewLayersRef`, and the history entry is written later by `commitDirtyTool()`
(`src/contexts/useLayer.ts`) on tool switch (`src/hooks/useApp.ts` — `goToTool()`), on export
(`src/components/DesktopHeader/DesktopHeader.tsx` — `handleToolSelection()`) and in
`mergeAllLayers()` (`src/contexts/useLayer.ts`). "Blurred as soon as the slider moves" overstates it:
the layer is blurred in a preview, and the undoable edit lands at the commit.

**Adobe's own current page is the source now, not the retired one.** The bar's own enumeration —
Brush Settings for Size and Hardness, Strength with "10–30% for subtle softening, 50% or higher for
stronger blur", Sample All Layers, and "intensifying the effect with each stroke" — comes from
<https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/blur-specific-areas-with-the-blur-tool.html>,
which is the page that replaced the `using/tool-techniques/blur-tool.html` URL this file used to
cite. That page also settles the **build-up while the button is held** question for the family: it
does not say it, so the build-up claim for the focus trio rests on the CS-era sources and on
Photoshop's own definition of Airbrush ("as you move the pointer over an area, paint builds up as
you hold down the mouse button", <https://helpx.adobe.com/photoshop/using/painting-tools.html>).
That same page is also where the Blur and Smudge are named as members of the painting family
("Tools like the Eraser tool, Blur tool, and Smudge tool modify the existing colors in the image"),
which is the closest Adobe comes to grouping the three.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/blur-specific-areas-with-the-blur-tool.html>
- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=210>
- <https://www.oreilly.com/library/view/adobe-photoshop-cs2/9780240520025/20_Chapter17.html>
- <https://flylib.com/books/en/2.190.1.43/1/>
- <https://flylib.com/books/en/2.816.1.14/1/>
- <https://www.photoshopgurus.com/forum/threads/why-doesnt-the-blur-tool-ever-work.22153/>
- <https://www.bwillcreative.com/how-to-use-the-blur-tool-in-photoshop/>
- <https://www.webpages.uidaho.edu/larc246/toolBarPages/blur.htm>
- <https://en.wikiversity.org/wiki/Adobe_Photoshop/Blur_Tool>
- <https://expertphotography.com/blur-tool-photoshop>
- <https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-blur-tool-to-soften-image-areas-in-photoshop-elements-9-205964/>
- <https://www.adobe.com/products/photoshop/smooth-edges.html>

## Sharpen Tool

The Sharpen tool increases local contrast at edges, and therefore apparent sharpness, only where you
brush. A KelbyOne write-up by Scott Valentine is the clearest statement of what it actually does at
the pixel level: it "samples the canvas, applies a level of sharpening, blends the result with the
original pixels, and paints the output back to the canvas", and the same source names the bar's
controls — blend modes applied as you brush, a Strength slider, Sample All Layers, and "the last
option, Protect Details, to reduce pixelation". Macphun's walkthrough is the same list.

**What separates it from the Blur** is the direction of the local change and the kernel: the Blur
smooths, the Sharpen exaggerates the difference between neighbouring pixels over a **wider radius**,
with a falloff that behaves like an unsharp mask rather than a flat average. What separates all
three from each other is that the Smudge _transports_ pixels, which is why the Smudge alone needs
`Sample All Layers`, alone needs `Finger Painting`, and is the only one of the three where sampling
the wrong pixels shows up as a visible smear.

This is worth stating plainly because the research brief frames it as "a USM-style convolution
rather than a true unsharp mask". That framing has the categories the wrong way round. The
**Unsharp Mask is the filter**, `Filter > Sharpen > Unsharp Mask`, with Amount/Radius/Threshold. The
**Sharpen tool is not a unsharp mask at all** — it applies a filtered copy of the pixels under the
brush and blends it back at the Strength rate, with no user-visible radius. So the interesting
question is not "how close is the app's kernel to USM's" but "is the app's kernel Photoshop
tool's at all", and it is not.

Against `Filter > Sharpen > Sharpen More`: Adobe's filter reference says the Sharpen filter
"focuses a selection and improves its clarity" and "the Sharpen More filter applies a stronger
sharpening effect than does the Sharpen filter". Both are one-shot, neither has a dialog, and
neither is brushable or buildable.

| Control             | Photoshop behaviour                               | Default / range | App status            | App source |
| ------------------- | ------------------------------------------------- | --------------- | --------------------- | ---------- |
| Brush Preset Picker | The tip, with Size and Hardness                   | preset library  | `missing`             | —          |
| Mode                | Blend mode applied as you brush                   | Normal          | `missing`             | —          |
| Strength            | Sharpen amount per pass                           | 50%, 1–100      | `missing`             | —          |
| Protect Detail      | Reduce pixelation at the sharpened edge           | on              | `missing`             | —          |
| Sample All Layers   | Sharpen from the composite, onto a blank layer    | off             | `missing`             | —          |
| _Flow_              | _reported on the shared bar; see `## Unverified`_ | _50%, 1–100_    | _omitted — unsourced_ | —          |

**`Protect Detail` is on the current desktop bar, and the caveat is gone.** The earlier draft read
"Documented by Adobe for the Sharpen tool in Photoshop Elements… No 2024+ Adobe desktop page was
found, so whether it is still on the current desktop bar is unverified". That caveat was false, and
it was false because the search had found the wrong page. Adobe's own **desktop** help enumerates
the bar today, in the order the table uses: set Size and Hardness in the Brush Setting dialog,
"Set the **Strength** of the sharpening effect", then "Select **Protect Detail** to minimize
pixelation and maintain image quality", then "Select **Sample All Layers** if you want sharpening to
use data from all visible layers"
(<https://helpx.adobe.com/photoshop/desktop/effects-filters/smart-filters/sharpen-a-selection.html>).
That enumeration is also why the two rows moved: `Protect Detail` sat after `Sample All Layers` in
the array, and the type contract asks for bar order. It now sits between `Strength` and
`Sample All Layers`, which is where Adobe puts it. `Mode` stays where it was — Adobe's current page
does not mention a `Mode` on this bar at all, so there is no Adobe order to defer to, and the
third-party sources that place it put it after `Strength`. The Elements reference is kept, not
because it is the only evidence but because it carries the longer wording the row quotes ("The
Sharpen tool now has a Protect Detail option, that ensures minimized pixelated artifacts while
enhancing and sharpening"), and because the third-party pages that hedged about it were hedging
about a version range the desktop bar has long since settled. `## Unverified` 5 is now about the
`Protect Tones` default, not about this control's existence.

**App verdict: the Unsharp Mask filter under the tool's name.** The bar is `Amount`
(`src/components/ToolbarsRight/Sharpen/Sharpen.tsx` — `Sharpen()`'s `Amount` slider, 0–500%, seeded
50% by `src/tools/settings.ts` — `defaultSettings.sharpen`) and `Radius` (0–100 px, seeded 1 by the
same `defaultSettings.sharpen`) — the Unsharp Mask's own control names, not the tool's — and there
is no brush and no gesture (`src/components/Main/SharpenToolArea.tsx` — `SharpenToolArea()`).

**The Radius is a second instance of the Gradient's Opacity defect, and it is the sharper one,
because Photoshop's tool has no radius control at all.** The write-up on the CS5 rebuild is
explicit: "The tool has no radius control, so it's really just for screen sharpening"
(<https://www.deke.com/content/advanced-sharpening-techniques-or-close-to-the-edge-part-deux>), and
the bar Adobe enumerates runs brush Size and Hardness, Strength, Protect Detail and Sample All
Layers with no radius among them. A slider for a control the tool does not have is the same shape
of defect as a slider in a place Photoshop moved the control out of, and it is now called out in
the Sharpen's `appNotes` for that reason. The same page is also the second source for
**`Protect Detail` defaulting on** — "By default, the check box is on, and that's the way you
should use it" — which closes half of what `## Unverified` 5 used to cover for the other control.

The kernel is a two-pass separable **box** blur subtracted from the source
(`src/tools/sharpen.ts` — `horizontalBoxPass()` is the horizontal pass, and `sharpen()`'s `factor`
is the `amount / 100` multiplier), and `horizontalBoxPass()`'s JSDoc says "THE KERNEL IS A BOX, NOT
A GAUSSIAN, AND THAT IS THE POINT" in caps.
That is where this implementation is furthest from the tool it claims to be, **but not for the
reason a first reading suggests.** It is tempting to write that "a box kernel is the one thing this
Sharpen does not have" — which is false and self-contradicting, because it has one, deliberately.
The gap is the **falloff, not the kernel class**: a real unsharp mask subtracts a _Gaussian_-blurred
copy, whose response decays smoothly away from an edge, whereas a box window responds flatly across
its full width and stops dead at its boundary. At small radii the two are nearly interchangeable;
at a wide one the app hardens a band the full width of the window with a step at its edge, where
Photoshop tapers. So the wider-radius unsharp-like falloff the addendum says distinguishes the
Sharpen from the Blur is exactly what the app does not reproduce, and the Blur/Sharpen pair differs
here in radius and magnitude rather than in the shape of the kernel's response. The one thing it
does better than the reference filter is real: the blur runs on premultiplied colour with alpha
unsharp-masked on its own 0–255 scale, so a transparent hole cannot bleed a ring into the opaque
side. Registered as `raster` (`src/tools/toolProcessors.ts` — the `toolProcessors` registry's
`sharpen` entry).

**Why `partial` and not `placeholder`:** the processor returns a real convolved canvas and
`commitDirtyTool` writes a history entry, so the tool reaches the document and is not a
placeholder; what it commits is the filter's, not the tool's. Same argument as the Blur's, now
written into the data file rather than left in this file alone.

**The bar order rests on one page, and the CS-era sources disagree with it.** Adobe's current
desktop page is the only enumeration that puts `Protect Detail` **between** `Strength` and
`Sample All Layers`, which is the order the `options` array uses. The CS3 manual and most of the
walkthroughs print the reverse — brush tip, blending mode and strength, then `Sample All Layers`,
then `Protect Detail` — and the array's `Mode` row has no Adobe order to defer to at all, because
that page never mentions a `Mode`. Both facts are recorded here so a reader who checks a
twenty-year-old manual does not read the array as a transcription error.

**The slider previews; it does not commit.** Same route as the Blur: `tempUpdateLayer`
(`src/components/ToolbarsRight/Sharpen/Sharpen.tsx` — `throttledOnChange()`) then `commitDirtyTool`
on tool switch, on export or in `mergeAllLayers`. "Sharpened when a slider moves" describes the
preview; the history entry lands at the commit.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/effects-filters/smart-filters/sharpen-a-selection.html>
- <https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html>
- <https://www.deke.com/content/advanced-sharpening-techniques-or-close-to-the-edge-part-deux>
- <https://insider.kelbyone.com/living-on-the-edge-an-exploration-of-the-sharpening-tools-in-photoshop-by-scott-valentine/>
- <https://www.macphun.com/hans/how-to/how-to-sharpen-your-image-in-photoshop>
- <https://helpx.adobe.com/nz/photoshop/using/filter-effects-reference.html>
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=221>
- <https://flylib.com/books/en/2.816.1.14/1/>
- <https://kalyankrishna4886.wordpress.com/wp-content/uploads/2013/09/adobe-photoshop-elements-reference-help-tutorial.pdf>
- <https://thelinuxcode.com/how-i-use-photoshops-blur-and-sharpen-tools-without-ruining-detail/>

## Smudge Tool

The Smudge tool simulates a finger through wet paint: Adobe's CS3 manual is explicit that it "picks
up color where the stroke begins and pushes it in the direction you drag", which is exactly the
resample-under-the-brush behaviour the brief asks about. The CS2 Bible is the richest source in the
family and settles three points the other references leave vague:

- **Strength 100% is effectively infinite.** "A Strength setting of 100 percent equates to
  infinity, meaning the Smudge tool pushes a color from the beginning of your drag until you
  release your mouse button." Below 100% the carried colour "fades out the first color and picks up
  the new one". The same book fixes the floor in the paragraph above: "1 percent being the minimum
  and 100 percent being the maximum" (<https://flylib.com/books/en/2.816.1.14/1/>), which is where
  the `Strength` range correction in the table below comes from and where its one app consequence
  comes from too.
- **`Finger Painting` was called `dipping` in older versions.** "In old versions of Photoshop, Adobe
  called this effect dipping." At Strength 100% with it on, "the Smudge tool essentially turns
  into the Brush tool, painting with the foreground color."
- **`Alt` REVERSES the checkbox rather than setting it.** "Reverse the Finger Painting setting by
  pressing the Alt key (Option on the Mac) and dragging. If the option is off, Alt-dragging dips the
  tool into the foreground color. If Finger Painting is turned on, Alt-dragging smudges normally."

The same page also corrects a common misconception about `Sample All Layers` that is worth having in
the data file: "this option instructs the Smudge tool to grab colors in all visible layers and
smudge them into the current layer. **Whether the option is on or off, only the current layer is
affected**" — which is the rule the app's implementation already happens to follow.

| Control             | Photoshop behaviour                                                                           | Default / range | App status            | App source                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------- | --------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Brush Preset Picker | The tip, with Size and Hardness                                                               | preset library  | `partial`             | `src/components/ToolbarsRight/Smudge/Smudge.tsx` — `Smudge()`'s `Size` and `Hardness` sliders |
| Mode                | Blend mode the carried colour composites with; Darken and Lighten are the useful ones         | Normal          | `missing`             | —                                                                                             |
| Strength            | Percent of the carried colour blended per dab; 100% carries one colour the length of the drag | 50%, 1–100      | `partial`             | `src/components/ToolbarsRight/Smudge/Smudge.tsx` — `Smudge()`'s `Strength` slider             |
| Finger Painting     | Start each stroke with a drop of the foreground colour ("dipping")                            | off             | `missing`             | —                                                                                             |
| Sample All Layers   | Pick colour up from the composite; only the active layer is written either way                | off             | `missing`             | —                                                                                             |
| _Flow_              | _reported on the shared bar; see `## Unverified`_                                             | _50%, 1–100_    | _omitted — unsourced_ | —                                                                                             |

**`Strength` moved from `present` to `partial`, and the range is the whole reason.** The bar's
`Strength` is a real per-dab coverage seeded at 50% as in Photoshop, wired and read by the processor,
so it was `present`. But the app's minimum is 0 — `SMUDGE_STRENGTH_MIN = 0` in `src/tools/smudge.ts`
— and the module's own comment says "0 is a legal choice: 0% is the identity and is what the slider's
own left end says" — while every source that states a floor for this control puts it at 1%. A
control the app renders and drives, whose range diverges from Photoshop's, is what `partial` is
defined to mean in the type contract, so that is what it is now. It is worth being precise about how
small the divergence is: it is one end stop out of a hundred, and nothing about the 0% case is
wrong. It is also the only reason the status is not `present`.

**App verdict: the closest match in the family, and `partial` on this file's own bar.** The
processor reads every covered pixel from the untouched source raster at the texel one dab behind
along the drag (`src/tools/smudge.ts` — `smudgeDab()`, whose `clampPointToSize` read is its only
source-texel access) and never from the buffer it is writing, so colour travels exactly one segment
per dab rather than compounding into a single streak; the falloff is the shared engine's
`tipAlphaAt`, the same edge every other paint-family tool stamps. `Strength` is seeded at 50% by
`src/tools/settings.ts` — `defaultSettings.smudge`, which is Photoshop's own default. The transport
semantics are right, and the app matches Photoshop's layering rule without having been told to. The
gesture is a real press/move/release on the active layer (`src/components/Main/SmudgeToolArea.tsx`
— `SmudgeToolArea()`), registered as `raster` (`src/tools/toolProcessors.ts` — the
`toolProcessors` registry's `smudge` entry).

Three controls are `missing` for structural reasons the component itself states. **Mode** is missing
because **no control anywhere in the app edits a layer's blend mode** — the earlier wording here
said "a layer's blend mode is a layer property the Layers panel owns", and that was false: a grep
for `blendMode` across `src/components/` returns only the paint tool's own `Mode` select
(`src/components/ToolbarsRight/Paint/Paint.tsx` — `PaintToolbar()`), and the Layers panel has no
blend-mode control at all. `Layer.blendMode` is a data field written from paint-tool args by
`src/contexts/layer-utils.ts` — `createLayerSource()` — and set by the PSD importer
(`src/contexts/psd-utils.ts`, on the flattened-composite layer literal), and nothing else can change
it. Finger Painting is missing because `SmudgeToolArgs` has no field for it and Sample All Layers
because the processor is handed one layer's bitmap. The preset picker is `partial` rather than
absent because this editor has one tip shape and no presets, though Size and Hardness — the preset's
two live parameters — are both there. `Alt` is not bound.

**`R` is on the Smudge's bar, and Adobe's own current page says so.** The page reads "Select the
Smudge tool (R) from the toolbar" and goes on to enumerate the bar as brush tip, blend mode,
`Sample All Layers` and `Finger Painting` — the same five controls the table carries, in the same
order the CS3 manual gives them, with `Strength` and the tip's `Size`/`Hardness` carried by the
brush rather than enumerated
(<https://helpx.adobe.com/photoshop/using/tool-techniques/smudge-tool.html>). That is a first-party
attribution, so the `R` row is in the data file and the `## Unverified` 11 caveat is gone. The same
page also states what `Alt` does in Adobe's own words, matching the CS2 Bible: "Press Alt (Windows)
or Option (Mac OS) as you drag with the Smudge tool to use the Finger Painting option"
(<https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/215>) — _use_, which is
the same toggle the Bible describes as _reversing_, so the `modifiers` row is now doubly sourced.

**`[` and `]` are brush-size keys in Photoshop, and the app already implements them here.** Three
independent reproductions of Adobe's default-keyboard list all give `Decrease Brush Size` = `[` and
`Increase Brush Size` = `]`, one pixel per press and repeating
(<https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/>,
<https://shortcutkeys.net/adobe-photoshop-shortcut-keys/>). The app binds exactly that, on the
`repeat: true` `[` and `]` registrations in `src/components/Common/AppKeyboardShortcuts.tsx`, and
the Smudge is in that file's `tipSizeField` so both keys
are live while it is selected. Rows for both are therefore in the data file — and the same two rows
are now on the Dodge and the Burn, which are also `tipSizeField` members. The same list gives `{`
and `}` to brush hardness, which the app does not bind; that is a capability gap, not a claim this
file makes, and it is not given a row because there is no Photoshop `control` to hang it on.

**`Mode`'s default is no longer claimed.** The row used to say "Normal by default", which no page
put on this bar. Adobe's own page says only "Choose a brush tip and and blend mode options in the
options bar" — no default named — so the row now says that, and notes that Normal is what every
painting tool starts on.

**Why `partial` and not `implemented`.** There is no build-up while the button is held. The shared
stroke hook appends a point to the gesture in `handlePointerMove()`
(`src/hooks/usePaintStroke.ts`) and nowhere else, and there is no `setInterval`, `setTimeout` or
rAF dwell in the hook or in `SmudgeToolArea.tsx`, so holding the brush still deposits nothing. (This
sentence used to cite the Dodge's and the Burn's `appNotes` by line number, which is a citation into
the very file these notes document, and so moved on every edit above it. The field name is what the
claim is actually about.) Applying one bar to one absence, the Smudge is `partial` too — but the
**load-bearing** reason is the `Strength` floor, not the dwell, and it is worth saying which is
which. The `ToolImplementationStatus` JSDoc in `src/tools/descriptions/types.ts` lists "a wrong
default" as a `partial` trigger, and the floor here is wrong: the app's minimum is 0 where the
sources put it at 1. The dwell is the weaker of the two arguments for this tool specifically, because
Photoshop's own Smudge semantics are about what happens along a drag — at `Strength` 100% the tool
"pushes a color from the beginning of your drag until you release your mouse button" — rather than
about dwelling, and the app's drag reproduces that part exactly. The drag itself is otherwise
faithful, which is what makes this `partial` and not `placeholder`: the processor returns a real
raster and the stroke writes a real history entry.

**Sources**

- <https://helpx.adobe.com/photoshop/using/tool-techniques/smudge-tool.html>
- <https://www.adobe.com/products/photoshop/blend-colors.html>
- <https://help.adobe.com/archive/en/photoshop-elements/11/photoshop-elements_reference.pdf>
- <https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=210>
- <https://flylib.com/books/en/2.817.1.103/1/>
- <https://flylib.com/books/en/2.816.1.11/1/>
- <https://flylib.com/books/en/2.816.1.14/1/>
- <https://helpx.adobe.com/si/photoshop-elements/using/painting-overview.html>

## Dodge Tool

The Dodge tool is the darkroom dodging: a printer holds light back under a finger to lighten that
part of the print. Adobe's current help page names the whole bar — brush preset, Range, Exposure,
Airbrush, and "Select the **Protect Tones** checkbox to help maintain color and prevent clipping in
highlights and shadows". A 2021 training write-up documents the rebuild: the two tools were
"completely reworked" underneath, `Range` isolates a luminance band so the effect does not spill
into neighbouring tones, and `Protect Tones` is **checked by default** in the current version.

**There is no `Mode` control on the Dodge or Burn bar, and the row has been removed.** The earlier
draft carried a `Mode` row for both tools, describing "a short list of three that the control cycles
through" — which is the recovered note, and it is also this file's `## Unverified` 2, i.e. the
thing the unverified list exists to keep out of the `options` array. No source places a `Mode`
control on that bar. Adobe's current desktop page enumerates the whole thing — brush preset, Range,
Exposure, Airbrush, and "Select the **Protect Tones** checkbox to help maintain color and prevent
clipping in highlights and shadows" — with no `Mode` on it, and the independent third-party
enumerations agree. What the blend mode actually is, is fixed rather than selectable: "The Dodge and
Burn tools can also cause color shifting, as they are **effectively operating with the Color Burn
and Color Dodge blending modes**. With the Protect Tones option enabled, the effect can be reduced,
but this ultimately results in some desaturation"
(<https://www.peachpit.com/articles/article.aspx?p=3104540>). That sentence is also why
`Protect Tones` exists, which is a better use of it than a fake three-item dropdown.

**Exposure is the only intensity control.** Neither Adobe's page nor any other opened page lists an
Opacity or a Flow on the Dodge or Burn bar, and that is the point worth recording: the tonal tools
build by dwelling, not by the per-dab/per-stroke opacity pair the paint tools use. The app matches
this correctly by accident — `DodgeBurnToolArgs` has no opacity or spacing field and takes both from
the shared engine's defaults. The type itself (`src/tools/dodgeBurn.ts` — `DodgeBurnToolArgs`) has
**no `mode` field at all**, and `Tonal.tsx` renders only Range, Exposure, Size and Hardness, so the
app never had the control to remove.

**Dodge and Burn are tone operations; the Sponge beside them is a chroma operation.** The CS2
Bible makes the distinction concrete: "The Sponge tool modifies two things: color saturation in
color images, and contrast in grayscale images. You can choose Saturate or Desaturate from the Mode
pop-up menu" — no Range, no Exposure, and a different axis entirely. It is also the source for
Airbrush on the tonal tools: "You may find it very helpful to turn on the airbrush setting ... as
well as the other toning tools, Dodge and Burn. This way, you can gradually build up effects on the
fly."

Two naming points, both of which changed my earlier draft. The brief's `Protect Skin Tone` is the
**historical** label; Adobe's current desktop help uses `Protect Tones`, and the type contract asks
for the current label verbatim. The recovered research's `Protect Texture` is a third spelling,
attributed to Adobe's iPad documentation, which I could not open — see `## Unverified`.

`O` selects the Dodge tool and `Shift+O` cycles the flyout, which is confirmed twice independently.
The app binds `O` the same way — the `Dodge Tool` entry in `toolbar-mapping.ts` declares it, and the
handler is the plain-`O` `useKeyDownShortcut` registration in
`src/components/Common/AppKeyboardShortcuts.tsx`, whose cycle branch is `selectTonalTool()`.

**Three more bindings Adobe has and the app does not: `Shift+Alt+S`, `Shift+Alt+M` and
`Shift+Alt+H` set the tonal range while the tool is held.** They sit in Adobe's
default-keyboard list under the painting section, immediately after the Sponge's own
`Desaturate`/`Saturate` pair, and read "Dodge/Burn Shadows", "Dodge/Burn Midtones", "Dodge/Burn
Highlights" — the wording itself names both tools, so it is one row covering both
(<https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/>, corroborated by
<https://shortcutkeys.net/adobe-photoshop-shortcut-keys/> and
<https://shortcuts.design/data/design/toolspage-adobephotoshop-windows>). Both tools' `shortcuts`
arrays now carry all three, plus `0`, which the same list gives to "set opacity, tolerance, strength,
or exposure" on any painting or editing tool, and the `[`/`]` brush-size pair the app already
implements. **Adobe's own default-keyboard page was not opened** — these are reproductions of it,
which is why `## Unverified` 14 keeps the provenance open — but the bindings are in the published
list, so they are on the bar in the data file rather than in the unverified section.

**Adobe's current page lists the Range menu in a different order than the app does.** It reads
"Midtones – affects mid-range grays. Shadows – affect darker areas. Highlights – affects lighter
areas", where the app's `DODGE_BURN_RANGES` is Shadows, Midtones, Highlights. The CS-era sources
print the app's order, and the descriptions do not claim a bar order for the dropdown's own
options, so nothing in the data file changes; it is recorded here because it is the kind of
one-word divergence that is easy to act on and worth knowing about.

**`Airbrush` "Off by default" is convention, not a sourced default.** Adobe documents Airbrush as
a toggle and never says which state it ships in, on this bar or any other. It is left in the row
because a build-up accelerator that shipped on would be the surprise, and hedging every checkbox
in the family would make the table unreadable. It is the same species of claim as `## Unverified` 5
and it is flagged as such here.

| Control             | Photoshop behaviour                               | Default / range | App status | App source                                                                                 |
| ------------------- | ------------------------------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Brush Preset Picker | The tip, with Size and Hardness                   | preset library  | `partial`  | `src/components/ToolbarsRight/Tonal/Tonal.tsx` — `Tonal()`'s `Size` and `Hardness` sliders |
| Range               | Shadows / Midtones / Highlights                   | Midtones        | `present`  | `src/components/ToolbarsRight/Tonal/Tonal.tsx` — `Tonal()`'s `Range` dropdown              |
| Exposure            | Strength of each pass; the only intensity control | 50%, 0–100      | `present`  | `src/components/ToolbarsRight/Tonal/Tonal.tsx` — `Tonal()`'s `Exposure` slider             |
| Protect Tones       | Stop lightening desaturating and clipping         | on              | `missing`  | —                                                                                          |
| Airbrush            | Keep building while the brush rests               | off (unsourced) | `missing`  | —                                                                                          |

**App verdict: Range and Exposure are real; the defining interaction is absent.** Range writes a
field the processor reads, and Exposure drives a per-pixel amount rather than a display-only value,
with the band's **power** driven by the exposure (`src/tools/dodgeBurn.ts` — `tonalWeight()` and
`tonalAmount()`) so a high value narrows the band instead of dragging a hard edge across the
picture. The band is a quadratic falloff in Rec.709 luma of the
**encoded** sRGB the editor stores, split at a flat luma 128. That is a defensible reading, since
Photoshop also scales stored channel values towards 255, but it is one hard split against a real
tonal scale, and the three Photoshop bands are not equal halves of the range.

Dodge and Burn deliberately share one options component (`Tonal.tsx` serves both, keyed off the
store's `toolName`), so a control-set change cannot land on one tool and miss the other. The
component is explicit that `Protect Tones` is a real omission, not an oversight: there is no args
field, so the checkbox would be a switch that reads as on while doing nothing. `Airbrush` is missing
for the same structural reason. There is no `Mode` to be missing, for the reason given above.

The largest gap is not a control. **There is no build-up.** One stroke commits once, at the slider's
full Exposure value in a single pass, because a one-shot commit has to be a pure function of its
args — which is also what makes the registry's `requiresRaster` replay reproduce it exactly. The
phrase matters in one respect: the per-pixel amount a commit emits is a **curve** of the Exposure
value, not the value itself. `tonalAmount()` (`src/tools/dodgeBurn.ts`) returns
`band ** (level * EXPOSURE_EXPONENT) * level * EXPOSURE_GAIN * paint` with the exponent in
`EXPOSURE_EXPONENT` and the gain in `EXPOSURE_GAIN`, both 4 and 1, so at the default Exposure of 50
the peak of the chosen band shifts a pixel by 0.5 and a quarter of the way down the band by a far
smaller amount; the "full Exposure value" is the slider's setting being honoured end to end, not the
whole value being written to every pixel. Holding the button still does nothing — there is no
`setInterval`, `setTimeout` or rAF dwell
anywhere in `src/hooks/usePaintStroke.ts` or in this file's tool area — and the tool's whole reason
for existing is what happens while you hold it. Airbrush, which exists precisely to make that
build-up automatic when you cannot hold still, is missing for the same reason. **This, not any
control, is what makes the verdict `partial` rather than `implemented`**, and it is also what keeps
it off `placeholder`: a real raster and a real history entry come out of the other end.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html>
- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://www.peachpit.com/articles/article.aspx?p=3104540>
- <https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/>
- <https://fstoptraining.com/dodge-burn-tools/>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=211>
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=217>
- <https://www.webpages.uidaho.edu/larc246/toolBarPages/dodge.htm>
- <https://flylib.com/books/en/2.816.1.11/1/>
- <https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-dodge-and-burn-tools-in-photoshop-elements-9-205974/>

## Burn Tool

The Burn tool is the same darkroom move from the other side: let more light onto the print and that
part of the image deepens. It is the Dodge tool's control set under another name, which is why the
app gives the two one shared `DodgeBurnToolArgs` and one shared options component — both in
`src/tools/dodgeBurn.ts`. The two processors are separate function references by design (`dodge()`
and `burn()` in that same module) because a test pins processor identity, and the module is
explicit that **burn is not the inverse of dodge**: with `q` the amount, `burn(dodge(c)) =
[c + (255 - c)q](1 - q)`, which equals `c` only at `q = 0` and `q = 1`. They are two ends of one
axis, not a pair that cancels.

Everything said about the Dodge above applies here unchanged, including the shared component, the
two `missing` controls, the `partial` preset picker, the absent build-up — and the absence of a
`Mode` row, for the same reason: there is no such control on the bar, and the blend mode is fixed.
`Shift+O` is how you reach the Burn tool from the Dodge, and the three `Shift+Alt+…` range
bindings and the `[`/`]` brush-size pair apply to it exactly as they do to the Dodge. The app binds
none of the four.

| Control             | Photoshop behaviour                               | Default / range | App status | App source                                                                                 |
| ------------------- | ------------------------------------------------- | --------------- | ---------- | ------------------------------------------------------------------------------------------ |
| Brush Preset Picker | The tip, with Size and Hardness                   | preset library  | `partial`  | `src/components/ToolbarsRight/Tonal/Tonal.tsx` — `Tonal()`'s `Size` and `Hardness` sliders |
| Range               | Shadows / Midtones / Highlights                   | Midtones        | `present`  | `src/components/ToolbarsRight/Tonal/Tonal.tsx` — `Tonal()`'s `Range` dropdown              |
| Exposure            | Strength of each pass; the only intensity control | 50%, 0–100      | `present`  | `src/components/ToolbarsRight/Tonal/Tonal.tsx` — `Tonal()`'s `Exposure` slider             |
| Protect Tones       | Stop darkening raising saturation or clipping     | on              | `missing`  | —                                                                                          |
| Airbrush            | Keep building while the brush rests               | off (unsourced) | `missing`  | —                                                                                          |

**App verdict: same processor, other endpoint, same gaps — including the `partial` verdict.** Burn
is `applyDodgeBurn(..., false)` against the dodge's `true` (`src/tools/dodgeBurn.ts` — `burn()`), so
the pixel rule is `c' = c - c * amount` where the dodge's is `c' = c + (255 - c) * amount`. Range and
Exposure are genuinely wired to per-pixel work through the same band function. Registered as
`raster` (`src/tools/toolProcessors.ts` — the `toolProcessors` registry's `burn` entry); the gesture
is `src/components/Main/BurnToolArea.tsx` — `BurnToolArea()`, a deliberate duplicate of the Dodge's
own file. The seeded args are `src/tools/settings.ts` — `defaultSettings.burn`. The absent build-up
is the same absence and gets the same phrasing: one stroke, one commit, at the slider's full
Exposure value in a single pass, with the emitted per-pixel amount a curve of that value rather than
the value itself, and no dwell anywhere in the stroke hook to accumulate more.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html>
- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://www.peachpit.com/articles/article.aspx?p=3104540>
- <https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/>
- <https://fstoptraining.com/dodge-burn-tools/>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=211>
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=217>
- <https://flylib.com/books/en/2.816.1.11/1/>
- <https://www.lenscraft.co.uk/photo-editing-tutorials/tutorial-mastering-the-photoshop-dodge-and-burn-tool/>
- <https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-dodge-and-burn-tools-in-photoshop-elements-9-205974/>

## Sponge Tool

The seventh member of this family, and the only **chroma** operation in it. Where the Dodge and the
Burn scale a channel towards white or black inside a chosen tonal band, the Sponge scales a pixel's
distance from its own luminance — which is exactly why its bar carries `Mode` and `Flow` where the
pair carry `Range` and `Exposure`, and why this family's notes had to be reopened rather than
extended: nothing here transfers.

**The bar, in Adobe's order: Mode ▾ · Flow ▾ · Vibrance ☐ · and the brush preset's Size and
Hardness.** Adobe's desktop page enumerates it as the brush tip, `Mode`, `Flow` and `Vibrance`
(<https://helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html>), and the
tool-techniques page repeats the set (<https://helpx.adobe.com/photoshop/using/tool-techniques/sponge-tool.html>).
`Vibrance` is the CS4 addition — the release that reworked all three toning tools at once, giving
the Dodge and the Burn `Protect Tones` in the same pass
(<https://jnack.com/blog/2008/11/02/cs4_whats_in_it_for_photographers/>) — and a 2009 CS4 Mac
shortcut sheet already carries it, so it predates every current release by a long way.

**Two controls are deliberately absent from the data file's `options` array rather than filed as
`missing`,** and the reason is the array's own inclusion rule: it lists what Photoshop places in
**this tool's** options bar.

- **`Protect Texture`** is a **Brush-panel** checkbox, not a Sponge-bar control. It is described as
  ensuring "the same texture is used for every brush with a texture"
  (<https://www.smashingmagazine.com/2009/11/brushing-up-on-photoshops-brush-tool/>) and community
  enumerations place the Sponge among the painting tools that use brush settings — but no source
  shows the checkbox on the Sponge's own bar.
- **`Tolerance`** is not on this tool's bar **at all**, and the common belief that it is a Dodge/Burn
  control is wrong too. Photoshop's Action Manager descriptor for this tool carries only `flow`
  (`SaturationToolOptionsDescriptor { flow }`, against `DodgeBurnToolOptionsDescriptor { exposure }`,
  <https://github.com/simonhenke/photoshop-types/blob/main/types/Tool.d.ts>); `tolerance` appears on
  the Magic Wand and the Color Replacement. One Grinnell course PDF puts an "EXPOSURE option" beside
  the Saturate/Desaturate box and is simply wrong about this tool.

**The algorithm is inferred, not published, and this file says so where it is used.** Adobe documents
no per-pixel specification. What is established is that the tool is a **chroma scale about a luma
pivot**, and the one community reimplementation of this family states the rule directly — "Sponge
scales chroma around fixed Rec. 709 luma, optionally reducing the effect for already-saturated
colors" (<https://github.com/SethRobinson/Patchy/blob/main/docs/brushes.md>). The module implements
`c' = L + (c - L) * (1 ± amount)` in the **encoded** sRGB the editor stores, on the same grounds as
`dodgeBurn.ts` gives for its own pivot, and pins the choice in a unit test.

**`Vibrance` is implemented as a gamut-headroom cap**, from Adobe's only sentence about it: "Select
the Vibrance option to minimize clipping for fully saturated or desaturated colors". Capping the
chroma scale at the pixel's own boundary is the strictest reading of "minimize clipping" — the
result then cannot clip at all — and it is the only geometric quantity that sentence names. It binds
**only in the Saturate direction**, and that is a property of the arithmetic rather than a
simplification: Desaturate moves every channel _toward_ the pixel's own luma, so its result is the
convex combination of two in-range values and provably cannot leave `[0, 255]`. A test pins that
equality rather than leaving it as a claim.

**Adobe's Grayscale-mode rule is real and is NOT implemented**, which is the one place this family
meets a platform limit rather than a missing feature. Adobe: "When an image is in Grayscale mode, the
tool increases or decreases contrast by moving gray levels away from or toward the middle gray"
(<https://helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html>), and Photoshop
Elements splits the direction: "In grayscale, Saturate increases contrast … In grayscale, Desaturate
decreases contrast" (<https://helpx.adobe.com/photoshop-elements/using/adjusting-color-saturation-hue-vibrance.html>).
The rule is scoped to a document **MODE**, and this app has no `Image > Mode` surface at all —
`color`'s `grayscale` is a per-layer filter amount, and a layer made grey by it is still an RGB layer,
where the rule does not apply. On an RGB pixel with no chroma the chroma scale is already an exact
no-op, so implementing the pivot anyway would make the tool behave the way Photoshop behaves in a mode
this app cannot reach. `docs/OVERRIDES.md` may not be edited by an agent, so the gap is recorded in
`HANDOFF.md` instead.

**The one place `Vibrance`'s behaviour diverges from what a tutorial says.** A 2026 walkthrough
describes it as "adjusts the intensity of subtle colors in an image while minimizing the effect on
highly saturated colors" (<https://glensmith.co.uk/photoshop/sponge-tool>) — a _saturation-weighted_
easing, which is the Lightroom Vibrance semantic, not a clip guard. Adobe's own sentence is the
opposite shape, and Adobe is the higher authority in the ladder, so the clip guard is what shipped.
The alternative reading is in `## Unverified` below.

### Sources

- <https://helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html> — the Grayscale-mode sentence; `Mode` semantics; `Flow` as "the rate of saturation change"; `Vibrance`'s only description; `O` on the Sponge page.
- <https://helpx.adobe.com/photoshop/using/tool-techniques/sponge-tool.html> — the desktop bar enumeration including `Vibrance`; "select and hold the Dodge tool to show the other related tools".
- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html> — the Dodge/Burn bar as `Range`/`Exposure`/`Airbrush`/`Protect Tones`, and the negative that `Tolerance` appears nowhere.
- <https://helpx.adobe.com/photoshop-elements/using/adjusting-color-saturation-hue-vibrance.html> — the per-mode grayscale contrast split.
- <https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html> — `Shift+Alt+D` → Desaturate and `Shift+Alt+S` → Saturate, from an Adobe Principal Evangelist, plus the Dodge/Burn `S`/`M`/`H` collision on the same page. Carries her own "these views are my own" disclaimer.
- <http://www.cheat-sheets.org/saved-copy/PSCS2_Shortcuts_Windows.pdf> — the Adobe-branded table rows "Dodge / Burn / Sponge Tool O", "Cycle Dodge / Burn / Sponge Tools Shift+O", "Desaturate (Sponge Tool) Alt+Shift+D", "Saturate (Sponge Tool) Alt+Shift+S".
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=646> — the CS3 manual's shortcut table, the same two rows.
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=217> — the CS4 bar listing, which already carries `Vibrance`.
- <https://flylib.com/books/en/2.816.1.14/1/> — the CS2 Bible on Flow as the per-dab amount and on the digits stepping Flow.
- <https://www.glensmith.co.uk/photoshop/sponge-tool> — Flow's 50% default, and the alternative reading of `Vibrance` recorded above as rejected.
- <https://jnack.com/blog/2008/11/02/cs4_whats_in_it_for_photographers/> — the CS4 rework of all three toning tools at once.
- <https://github.com/simonhenke/photoshop-types/blob/main/types/Tool.d.ts> — `SaturationToolOptionsDescriptor { flow }` and the absence of `tolerance` on this tool.
- <https://github.com/SethRobinson/Patchy/blob/main/docs/brushes.md> — the one published statement of the per-pixel rule, and `Protect Texture`'s meaning.

## Gradient Tool

The bar, left to right: **tool-preset picker · Tool Mode ▾ · gradient swatch ▾ · the five type
buttons · Dither · Reverse · Method ▾**. The `Tool Mode` dropdown exists in 24.5 and later and picks
the live gradient or the destructive Classic one, and it _changes which options follow it_ — on the
Classic one, `Mode`, `Opacity` and `Transparency` join the bar; on the live one they do not, because
the live tool writes an adjustment layer and those three are properties of that layer instead.

**The Tool Preset Picker is the first control on the bar, and the table used to start past it.** The
bar-order sentence in this file already named a "tool-preset picker" first, but the `options` array
opened with `Tool Mode`, and the `Tool Mode` detail put itself "to the right of the gradient swatch" —
so the one control every Photoshop bar opens with had no row at all, and the array's first row was
in the wrong place. The teachucomp walkthrough is exact about the position: "To show a drop-down menu
of saved tool presets for the Gradient Tool from which you can choose, click the 'Click to open the
Tool Preset picker' button at the **left end** of the Options bar Control panel. The Gradient Tool
comes with one 'Circular Rainbow' Gradient Tool preset" — and about what follows it, "from the
**next drop-down to the right**". So the order is preset picker, then `Tool Mode`, then the swatch,
and the `Tool Preset Picker` row is now row 1 with status `missing`: the app's bar opens with `Type`
(`src/components/ToolbarsRight/Gradient/Gradient.tsx` — `Gradient()`'s `Type` select) and there is no
preset recall of any kind, so nothing to point at.

Five types, per Adobe's help and a CS2 keyboard reference that predates the name change: **Linear,
Radial, Angular, Reflected, Diamond**. Adobe's current page spells them "Linear, Radial, Angular,
Reflected, or Diamond". The drag sets both endpoints at once, and the gradient **clamps to its
ends** beyond the drag rather than fading to transparent — which is why a short drag fills the whole
layer — and `Shift` constrains the drag to multiples of 45°.

**`Mode` and `Opacity` are Classic-only, and the `Opacity` row is `partial` because of it.** Both
were recorded as though they sat on the current bar, and `Opacity` was even `present` — judged
against a control the modern tool does not carry. teachucomp puts them under a heading that says
"for the **Classic** Gradient Tool" and then says the thing that settles it: "Note that these
drop-downs do not appear in the Options bar Control panel if using the new Gradient Tool, as it
applies its gradient adjustment in a separate adjustment layer." A second walkthrough shows the
Classic bar in a screenshot and says choosing Classic gives you "a few extra settings in the Options
bar – Blend Mode, Opacity and Transparency" (<https://andrewhaysom.myportfolio.com/the-gradient-tool-changes-in-ps-2023>).
`Transparency` was already handled this way; `Mode` and `Opacity` were the same mistake. The
`Opacity` status is now `partial` rather than `present` for one specific reason: the app does render
an Opacity slider, and it does what Photoshop's Classic one does, but Photoshop has moved the
setting out of the options bar entirely and onto the adjustment layer, so the app is showing a
control in a place the current tool has no control. That divergence belongs in `appNotes` and is
now there.

**`Method` is the substantive one, and it is a default that changed.** `teachucomp` states it
exactly: "The 'Perceptual' choice is the default choice and interpolates the gradient using the
**OKLab** color space to better show a gradient that is perceived as natural by the human eye. The
'Linear' choice uses the linear color space to accomplish a similar result. The 'Classic' choice
displays the classic Photoshop gradient interpolation and is also useful for backwards-compatibility,
if needed." `taylorhieber` dates it: "Adobe recently updated Photoshop to contain a better
interpolation system for gradients with **version 23.0**", and describes Perceptual as "the new
default interpolation method ... said to produce a more realistic and dependable result" and Linear
as using "the same interpolation settings as Adobe Illustrator". `photoshopessentials` corroborates
the pairing in use: "ensure Reverse is turned off, Dither is turned on (to reduce color banding),
and set the Method set to Perceptual".

**`Transparency` is the one the recovery got wrong for this tool.** It is Classic-gradient-only and
is not present on the modern bar at all; the teachucomp walkthrough says so in as many words and
also notes that Dither and Reverse are _live_ on a live gradient ("you can check or uncheck the
previous two checkboxes for a selected gradient adjustment layer created using the new Gradient
Tool to immediately change it") while on the Classic tool "you must reapply the gradient to the
raster layer after checking these checkboxes". That asymmetry is a Tool Mode question, which is
exactly why the recovery's flat "Transparency default OFF" does not describe the tool this file is
about.

**`photoshopName` is singular, and Adobe's own painting table prints the plural.** The data file
says `Gradient Tool`, which is what the Tools panel tooltip prints and what every other page I
opened says. Adobe's painting-tools table is the exception: it lists the tile as **"The gradient
tools"**, plural, in the same row where the Blur, Sharpen and Smudge entries are the Focus tools and
the Dodge/Burn pair is the Toning tools — a table that is naming _groups_ by other rules while the
row itself pluralises a tool that has exactly one tile. That is an Adobe-side inconsistency, not a
choice this file gets to make silently, so it is recorded here and the data file keeps the singular.
The Tools panel has printed `Gradient Tool` in every version I could check, and `G` selects the
Paint Bucket in current versions precisely because the Gradient is not the tile's own letter.

**`[`/`]`, `,`/`.` are gone from the `shortcuts` array, and two of the four rows were wrong rather
than merely unsourced.** The array used to claim that `[` and `]` "cycle backwards/forwards through
the gradient styles" and that `,` and `.` select the previous/next gradient preset. Three
reproductions of Adobe's own default-keyboard list give those four keys to the brush instead:
`Decrease Brush Size` = `[`, `Increase Brush Size` = `]`, `Decrease Brush Hardness` = `{`,
`Increase Brush Hardness` = `}`, and `Select previous/next brush` = `,` and `.`
(<https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/>,
<https://shortcutkeys.net/adobe-photoshop-shortcut-keys/>,
<https://keycombiner.com/collections/photoshop/>). Nothing in Adobe's list makes any of the four a
gradient control, and the two style-cycling rows **contradicted** it rather than merely outrunning
it — which is the stronger of the two failure modes, and the reason they are deleted rather than
moved to `## Unverified`. The `,`/`.` rows are deleted on the weaker charge: a context-sensitive
reading in which they cycle gradients while the Gradient tool is selected is plausible and widely
repeated, but no page I opened says so, so they go the same way. What survives is the app-side
fact, which is in the `appNotes`: `,` and `.` are on no keyboard handler in the app at all, and `[`
and `]` are registered but gated to `tipSizeField`, which the Gradient is not a member of. An
earlier version of this file said the four keys were "registered on no keyboard handler at all",
which was wrong about two of them.

**The load-bearing control is not in the options bar.** From 24.5, the tool creates a live gradient
on the canvas and the gradient line itself is editable in place: two round handles mark the ends and
a small diamond between them sets the midpoint. Adobe's own Learn walkthrough describes dragging
"either of these points" to lengthen or shorten the gradient and "the small Diamond icon in the
center" to modify the transition. **Moving the whole line takes no modifier at all**, and that is
the correction: the data file used to carry a `Cmd`-drag row for it, sourced from a page describing
**Illustrator's** gradient panel. The teachucomp walkthrough of the live gradient is about
Photoshop's own canvas and says no key is involved — "A selected gradient adjustment layer's gradient
line appears in the document window as a straight line with two dot icons at either end … **To move
the entire gradient line, click and drag the gradient line, avoiding any dot or diamond icons on the
line, in the document window**"
(<https://www.teachucomp.com/how-to-edit-a-gradient-adjustment-in-photoshop-instructions/>) — and the
glensmith walkthrough says the same in a caption, "Click on the line and drag to move it"
(<https://glensmith.co.uk/photoshop/gradient-tool>). The `Cmd` row is gone and the plain line drag
now sits in the `On-canvas gradient handles` row, which is where a reader of the bar will look for
it. `Delete` removing a stop stays in `shortcuts` as a third-party-corroborated binding, but the
"not below two stops" floor is gone with it; see `## Unverified`.

**The `Shift` constraint is Adobe's own sentence, on the page the file already cites.** "Press Shift
while dragging to constrain the angle to multiples of 45°"
(<https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html>,
read 2026-04-28) — the same page that gives the five types by name, "Linear, Radial, Angular,
Reflected, or Diamond", and both checkboxes. That page is the current, first-party source for the
bar's shape, and it names neither `Method` nor `Tool Mode` nor an `Opacity` control, which is worth
recording next to the claim that the latter two are present in 24.5+: Adobe's own bar documentation
is not exhaustive, and the rows that rest on the teachucomp walkthrough rest on it because it is the
page that photographs the whole bar.

**`Tool Mode` is 24.5, and one source says "2023".** The teachucomp walkthrough of 24.5's bar and
Adobe's 24.5 announcement put the Tool Mode dropdown in **24.5** (May 2023), and the data file says
"24.5 and later". A later third-party walkthrough calls it "new as of Photoshop 2023"
(<https://www.photoshopessentials.com/photo-effects/add-a-vignette-to-a-photo-with-photoshops-live-gradients/>),
which is the same year and a looser version label rather than a contradiction. Noted so a reviewer
who meets the second phrasing is not surprised; no change.

| Control                    | Photoshop behaviour                                                                                    | Default / range       | App status | App source                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Tool Preset Picker         | The saved-tool-preset drop-down at the left end of the bar; ships one, "Circular Rainbow"              | 1 preset              | `missing`  | —                                                                                      |
| Tool Mode                  | Live gradient vs Classic gradient; changes which options follow (24.5+)                                | Gradient              | `missing`  | —                                                                                      |
| Gradient preset picker     | Click the swatch for the Gradient Editor, its arrow for the presets library                            | the shipped library   | `missing`  | —                                                                                      |
| Gradient Type              | Linear, Radial, Angular, Reflected, Diamond                                                            | Linear                | `partial`  | `src/components/ToolbarsRight/Gradient/Gradient.tsx` — `GRADIENT_TYPES`                |
| Mode                       | Blend mode the gradient composites with — **Classic tool only**                                        | Normal                | `missing`  | —                                                                                      |
| Opacity                    | Opacity of the whole fill, multiplied over the gradient's own alpha ramp — **Classic tool only**       | 100%, 0–100           | `partial`  | `src/components/ToolbarsRight/Gradient/Gradient.tsx` — `Gradient()`'s `Opacity` slider |
| Dither                     | Noise the interpolation to break 8-bit banding                                                         | not stated            | `missing`  | —                                                                                      |
| Transparency               | Applies the gradient's opacity stops — **Classic tool only**                                           | off                   | `missing`  | —                                                                                      |
| Reverse                    | Swap the gradient ends                                                                                 | off                   | `missing`  | —                                                                                      |
| Method                     | Perceptual (OKLab) / Linear / Classic interpolation                                                    | Perceptual since 23.0 | `missing`  | —                                                                                      |
| On-canvas gradient handles | Two end handles and a midpoint, draggable on canvas; dragging the line itself moves the whole gradient | —                     | `missing`  | —                                                                                      |

**App verdict: the fill is right, everything around it is thinner, and the handles are gone.** Four
controls against Photoshop's eleven, and the app's four do not even include the one Photoshop's bar
opens with. `GradientToolArgs` holds exactly `type`, `from`, `to`,
`colorA`, `colorB`, `alpha` and nothing else (`src/tools/gradient.ts` — `GradientToolArgs`), which is
the structural reason for most of the rows above. The `Type` select carries **two** entries, Linear
and Radial (`src/components/ToolbarsRight/Gradient/Gradient.tsx` — `GRADIENT_TYPES`); Angle,
Reflected and Diamond have no
representation in a fixed `from`/`to` pair. `Method` is the most consequential omission of the three
missing options, because the app interpolates the two stops as plain
per-channel RGB (`src/tools/gradient.ts` — `sampleStop()`, one stop sampled at `t` in each channel),
which is
closest to the Classic behaviour Photoshop stopped defaulting to in 23.0 — so every gradient this
editor paints is one dropdown away from a different ramp. `Opacity` is the
one control the app carries that the current tool's bar does not: Photoshop has moved it onto
the Gradient Fill layer, and the app still shows it as a bar slider, which is what its `partial` status
records. The preset picker and the Gradient Editor are absent entirely, so there are
no multi-stop gradients, no per-stop opacity or position, no midpoints, and no gradient styles. The
two stops are two colour inputs in the bar (`src/components/ToolbarsRight/Gradient/Gradient.tsx` —
`Gradient()`'s `Colour A` and `Colour B` inputs) rather than a picker, and
they are the tool's only gradient state — there is no Foreground-to-Background preset and nothing
to reset to. **The verdict is `partial` and not `placeholder`** because the fill does reach the
document as a real raster with a real history entry; what it commits is simply a narrower, uneditable
gradient than Photoshop's tool commits, which is the definition `partial` is for.

**The handles are genuinely absent, and I checked carefully.** `GradientToolArea` accepts
`overlayCtxRef` and **never draws to it** — the `GradientToolArea` JSDoc in
`src/components/Main/GradientToolArea.tsx` says so ("`overlayCtxRef` is therefore accepted and
unused") — and `buildArgs()` in the same file writes `from`/`to` from the drag's first and last
point and from
nothing else. There is no pointer-down handler for a handle anywhere in the component, and no
second gesture surface. So once a fill is committed its geometry cannot be changed at all without
painting a second gradient over it. Photoshop's live-preview gradient is not a refinement of that;
it is the difference between a fill and an editable object. `Shift` is not bound either — there is
no `shiftKey` read anywhere in `GradientToolArea.tsx` or in `src/hooks/usePaintStroke.ts` — and
neither `,` nor `.` is on any keyboard handler. `[` and `]` are registered, but as the shared
tip-size nudge at the `[` and `]` registrations in `src/components/Common/AppKeyboardShortcuts.tsx`,
gated to that file's `tipSizeField`, and the Gradient is not a member, so both are dead while this
tool is selected. The only `Delete` bindings belong to the two lasso tool areas
(`src/components/Main/FeatherMagneticLassoToolArea.tsx` and
`src/components/Main/PolygonClickToolArea.tsx` — each file's `Delete` registration for
`removeLastAnchor`), so no key removes a gradient stop.

**The Radial's "Photoshop mirrors" clause is gone, and the sentence it was attached to was doing two
jobs.** The data file asserted that the app's Radial "holds its end colour past the circle through
the second stop **where Photoshop mirrors**". No Adobe page says that, and a third party discussing
Photoshop's gradient types says the opposite — asked about it, the answer is "I personally, I wish
Photoshop would add a mirror feature". What the app actually does is fall out of its own shape: a
`from`/`to` pair with a projected `t` clamped to `[0, 1]` has no way to express a mirrored falloff, so
the clause about Photoshop was doing the explanatory work that the structural clause should have
done. The claim is now stated as an app fact and the Photoshop half is gone. **The identical
sentence still lives in `src/tools/gradient.ts`** — in `gradient()`'s JSDoc, the `RADIAL` bullet:
"Photoshop mirrors past that circle;
this does not, and a mirrored radial has no representation in the fixed `from`/`to` args" — and that
file is outside this family's two, so it is reported rather than fixed.

**`G` does not reach the Gradient on a first press, which the data file used to claim.** A plain `G`
runs `selectFillTool(false)`, which lands on `'paint-bucket'`
(`src/components/Common/AppKeyboardShortcuts.tsx` — `selectFillTool()`; its plain-`G` handler is the
`key: 'g'` `useKeyDownShortcut` registration in the same file); the
Gradient is what the cycle reaches, via the `Shift+G` binding into `selectFillTool`'s
cycle branch. The tile declarations agree: the `Paint Bucket Tool` entry in `toolbar-mapping.ts`
declares `shortcut: 'G'` and the `Gradient Tool` entry declares none at all.
The data file's `shortcuts` row now says exactly that rather than
"pressing it again cycles to that tool", which described a first press that selects the other tool.
Third-party walkthroughs routinely say "`G` selects the Gradient tool", which is the CS-era ordering
where the Gradient was the tile's own letter; wikihood's 2007 text spells the current behaviour out
("If the Paint Bucket Tool … is selected, press Shift-G until the Gradient tool is selected"), and it
is also why the shortcut row's wording leads with what a second press does.

**Sources**

- <https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/gradient-tool.html>
- <https://www.teachucomp.com/how-to-use-the-gradient-tool-in-photoshop-instructions/>
- <https://www.teachucomp.com/how-to-edit-a-gradient-adjustment-in-photoshop-instructions/>
- <https://andrewhaysom.myportfolio.com/the-gradient-tool-changes-in-ps-2023>
- <https://taylorhieber.co/how-to-use-the-improved-gradient-interpolations-in-adobe-photoshop/>
- <https://www.adobe.com/learn/photoshop/web/blend-two-images-gradient>
- <https://community.adobe.com/announcements-710/photoshop-24-5-is-now-available-1154445>
- <https://www.photoshopessentials.com/photo-effects/fade-an-image-to-color-in-photoshop-faster-with-live-gradients/>
- <https://luminousworks.substack.com/p/grokking-gradients>
- <https://glensmith.co.uk/photoshop/gradient-tool>
- <https://digital-photography-school.com/photoshop-gradient-tool/>

## Unverified

Claims I could not establish from a page I actually opened, including the three recovered
findings that did not survive re-verification. They are here and not in the data file's `options`
prose as fact. Two of them (2 and 7) are no longer footnotes on a kept row but the reason a row or
a binding is **absent**, which is the stronger form of the same objection.

1. **`Flow` on the Blur, Sharpen and Smudge options bar.** The recovered research places `Flow :50%`
   between `Strength` and `Sample All Layers` on the shared focus-tool bar. **No page I opened
   lists it there.** The three best enumerations of that bar each omit it: `flylib`'s per-tool
   checklist is "the Mode pop-up menu, Strength, and Sample All Layers checkbox"
   (<https://flylib.com/books/en/2.190.1.43/1/>), `bwillcreative` names the Brush Preset Picker,
   Strength and Sample All Layers (<https://www.bwillcreative.com/how-to-use-the-blur-tool-in-photoshop/>),
   and `thelinuxcode` walks the bar as Brush preset picker / Mode / Strength / Sample All Layers /
   pen pressure, explicitly flagging that "the names can vary slightly by version"
   (<https://thelinuxcode.com/how-i-use-photoshops-blur-and-sharpen-tools-without-ruining-detail/>).
   It is possible `Flow` is a very recent addition to the bar, or that the ⚠ in the recovery marks
   it as uncertain; either way it is **omitted from all three tools' `options` arrays** rather than
   recorded, by the inclusion rule stated at the top of this file. It would be `missing` in the
   app — the app has no per-dab/per-stroke opacity pair — so the omission costs no fidelity claim.
   The same search found **no `Opacity` control** on the focus bar, consistent with the Brushing
   model in the corpus, but the negative is not independently sourced either.
2. **The Dodge and Burn tools' three-mode `Mode` lists — and, with them, whether the control exists
   at all.** "Color Dodge → Linear Dodge → Overlay" and "Color Burn → Linear Burn → Hard Light" come
   from the recovered research, which is all this item ever was: a list nobody could corroborate,
   describing a control nobody had found. The three blend modes involved are attested on Adobe's own
   blend-mode pages and the recovered ordering is consistent with the darken/contrast groupings, but
   **no page I opened places a `Mode` dropdown on the Dodge or Burn bar at all**, and none describes
   clicking a control to cycle modes. Adobe's current desktop page enumerates the bar in full — brush
   preset, Range, Exposure, Airbrush, `Protect Tones` — and no `Mode` is on it
   (<https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html>).
   What the tools actually composite with is fixed, not selected: "The Dodge and Burn tools can
   also cause color shifting, as they are effectively operating with the Color Burn and Color Dodge
   blending modes" (<https://www.peachpit.com/articles/article.aspx?p=3104540>). **The `Mode` row
   has therefore been removed from both tools rather than reworded**, and the data file's `appNotes`
   records the fixed blend mode instead. This is the one place in the family where a `## Unverified`
   item is not a footnote on a kept row but the reason a row is gone.
3. **The Dodge/Burn tonal range boundaries: 0–85 shadows, 85–170 midtones, 170–255 highlights.**
   From the recovered research. One targeted search returned **no relevant result at all** — the
   top hits were a C64 debugger's RGB memory-map documentation, an image-recognition patent, and a
   physics problem, all of which use 85/170 as thirds of a 0–255 range for unrelated reasons. Not
   established. **This is why the data file's dodge and burn `appNotes` say the app's band "is a
   single hard split against a real tonal scale, and the three Photoshop bands are not equal halves
   of the range", and do not quote 85/170 as Photoshop's values.** The app's own split is luma 128
   (`TONAL_SPLIT` in `src/tools/dodgeBurn.ts`), which is a different proposition and is
   verifiable in the tree.
4. **`Protect Texture` as the desktop control name.** The recovered research states the control is
   **Protect Texture**, and that Adobe's iPad documentation says so explicitly for the equivalent
   "Protect Tones", defaulting it ON. Two searches returned nothing relevant, and **the iPad page
   was never opened**. Adobe's _desktop_ help page that I did open uses **Protect Tones**
   (<https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html>),
   as does the 2021 training page. The data file uses `Protect Tones` because that is the spelling a
   page I opened puts on the desktop bar, and the type contract asks for the current options-bar
   label verbatim. If `Protect Texture` is correct for the desktop bar and `Protect Tones` is the
   iPad or legacy spelling, three control names change and the citation changes with them. The
   **default-ON** state _is_ independently sourced, by `fstoptraining`, and is asserted.
5. **The Dodge/Burn `Protect Tones` **default**, not the control.** The control's existence and its
   current desktop spelling are settled (see item 4 and the version table), and the **default-ON**
   state is the weaker half: `fstoptraining` is the only source, and Adobe's current page does not
   state a default for it. The data file asserts it anyway, because a positive third-party
   statement beats silence, but this is the item to close if someone opens the bar and finds it
   off. The CS5 write-up behind the Sharpen's `Protect Detail` does say that control's box is on by
   default (<https://www.deke.com/content/advanced-sharpening-techniques-or-close-to-the-edge-part-deux>),
   which is a different product's control and does not transfer. The `Airbrush` rows on both tools
   carry the same species of unsourced default and the same reasoning, and the Dodge table now marks
   it "off (unsourced)" so the reader can see it. The Elements-era `Protect Detail` question this
   item used to hold is gone: see the header above.
6. **The Blur tool's `Sample Size` control.** The only source that puts "Sample Size" near the Blur
   tool is the `flylib` CS2 reference, whose Blur section carries a stray bullet "Double-check the
   Sample Size pop-up menu" immediately after the Blur controls — but the same book documents
   `Sample Size` as the **Eyedropper's** options-bar control elsewhere
   (<https://flylib.com/books/en/2.134.1.34/1/>), so that bullet is most likely bleed-over from an
   adjacent tool entry rather than evidence about the Blur bar. Four targeted searches for the
   modern Blur bar returned only Mode / Strength / Sample All Layers. **Omitted from the Blur's
   `options` array** rather than recorded with a `missing` status. If a reviewer can open the current
   Blur bar and find it, the row belongs back in.
7. **`Delete` removing a stop, and the "not below two stops" floor.** The sourced part is that the
   two end handles and the midpoint diamond are draggable directly on the canvas
   (<https://www.adobe.com/learn/photoshop/web/blend-two-images-gradient>, and 24.5's announcement
   for the on-canvas controls themselves), and that the line itself can be moved by dragging it.
   The two key bindings came from a third-party page describing **Illustrator's** native gradient
   panel (<https://astutegraphics.com/plugins/subscribe/gradient-forge-documentation>), not
   Photoshop's canvas. **The `Cmd`-drag row is deleted outright** — no modifier is involved, and
   teachucomp's walkthrough of Photoshop's own live gradient says so in as many words ("To move the
   entire gradient line, click and drag the gradient line, avoiding any dot or diamond icons on the
   line"), corroborated by <https://glensmith.co.uk/photoshop/gradient-tool>. The plain line drag is
   now in the `On-canvas gradient handles` row. **`Delete` stays in `shortcuts`** because it is
   corroborated for Photoshop by a third party, but **the two-stop floor is gone from its `action`
   text**: Adobe documents removal only as "Drag a stop away from the line to remove it" and no
   source states a minimum. If someone opens the current bar and finds a floor, that sentence goes
   back in with the citation.
8. **The Gradient tool's `[`/`]` style cycling and `,`/`.` preset cycling.** From the recovered
   research. Plausible — they are the standard Photoshop pattern-key families and the pair matches
   the Brushing model in the corpus — but **not attested by any page I opened**. They are in the
   data file's `shortcuts` and are unverified here.
9. **The Gradient Editor's stop-type list** (Color / RGB / RGBA / HSB / CMYK / Lab / Grayscale),
   which the brief specifically asked to be researched. One search returned **nothing relevant**:
   the top hits were Krita's `KisStopGradientEditor` source, a Swift package registry entry, and a
   reader for Photoshop's own `.grd` gradient file format. The last of those is suggestive rather
   than conclusive — it shows Photoshop's format encoding `FrgC`/`BckC`/`UsrS` stop types and
   `RGBC`/`HSBC` colour types — but it is a third-party parser, not Adobe, and it does not establish
   the _editor's_ dropdown. The `Smoothness` control is attested on the Properties panel
   (<https://www.teachucomp.com/how-to-edit-a-gradient-adjustment-in-photoshop-instructions/>), as
   are `Angle`, `Scale` and the `Solid`/`Noise` gradient-type choice; the stop-type dropdown is
   not, and no data-file row depends on it.
10. **What each of the three `Method` values changes beyond its colour space.** The colour spaces
    are sourced (OKLab for Perceptual, linear for Linear, the legacy interpolation for Classic) and
    the data file stops there. The _perceptual_ effect — that Perceptual pulls the blacks in and
    puts the 50% point halfway along the ramp, where Classic at Smoothness 0 is precisely linear —
    is a forum analysis (<https://www.photoshopgurus.com/forum/threads/how-ps-gradients-change-with-smoothness-and-method-options.76770/>)
    and one author's own Levels-equivalent reading of it, so it is not asserted as fact. A `Smoothness`
    control (0–100%, and higher emphasises the colours AT the stops rather than smoothing the
    ramp) is documented at <https://luminousworks.substack.com/p/grokking-gradients> and is a real
    Photoshop gradient property the app has no counterpart for; it is a Properties-panel control
    rather than an options-bar one, so it has no row, and it is noted here because the brief asked
    about the Methods and this is the other half of their behaviour.
11. **The `R` keyboard shortcut for the Blur and the Sharpen, and only those two.** This item used
    to ask about the whole group. **It is answered for the Smudge**: Adobe's current page for the
    tool states "Select the Smudge tool (R) from the toolbar"
    (<https://helpx.adobe.com/photoshop/using/tool-techniques/smudge-tool.html>), and Photoshop
    Elements' reference prints `R` for the three-tool group
    (<https://help.adobe.com/archive/en/photoshop-elements/11/photoshop-elements_reference.pdf>), so
    the row is in the Smudge's `shortcuts`. The two CS-era sources that give the group `R`
    (`flylib`, and the CS2 keyboard sheet on
    <https://alexandru2882.wordpress.com/wp-content/uploads/2016/10/2074975-adobe-photoshop-cs2-tools-and-basics.pdf>)
    now only corroborate it. **Still open: the Blur and the Sharpen.** Adobe's current Blur page
    names no letter, and the current Sharpen page could not be opened, so neither carries an `R`
    row — the same rule the other five controls in this file follow, where a claim goes in the data
    file only if a page puts it on that tool. The app binds none of the three: the `Blur`, `Sharpen`
    and `Smudge` entries in `toolbar-mapping.ts`'s Focus flyout all declare no `shortcut`, so this
    is an accuracy question, not an app-fidelity one.
12. **`Dither`'s and `Reverse`'s defaults, and the removal of `Reverse`'s.** The data file used to
    say "On by default" for `Dither` and "Off by default" for `Reverse`, and both were silence
    dressed as a fact. They are now both gone from the `detail` text and the rows say that no page
    I opened states a default. The evidence now points the other way for `Dither` and is worth
    having: a 2023 walkthrough says "Leave Dither turned on and the Method set to Perceptual.
    **Both are the default settings**"
    (<https://www.photoshopessentials.com/photo-effects/add-a-vignette-to-a-photo-with-photoshops-live-gradients/>),
    while an earlier write-up tells the reader to ensure Dither is _turned on_ as a step, and
    teachucomp says only "check the 'Dither' checkbox". Adobe says nothing either way. One
    third-party statement of a default is not two, so the row keeps the honest phrasing and the
    citation is the third party's. `Reverse` has no statement at all in any direction.
13. **The Blur `Mode` restriction, narrowed but not closed.** The Blur's `Mode` list is said by two
    pages to be restricted: the University of Idaho's CS-era walkthrough says the dropdown "only
    offers a limited number of blends to choose from"
    (<https://www.webpages.uidaho.edu/larc246/toolBarPages/blur.htm>), and Wikiversity says "In the
    latest edition of Adobe Photoshop there are seven blur tool modes" and enumerates them. The
    seven modes are also attested by `expertphotography` and `dummies`. What no page says is what
    else, if anything, the dropdown offers — so "restricted to these seven" remains unestablished
    and the `detail` now attributes the restriction claim to the page that makes it while saying it
    does not name the restriction's extent. The row is kept, because `Mode` itself is on the bar by
    several independent enumerations.
14. **The provenance of the keyboard bindings, which are reproductions rather than Adobe's page.**
    The Smudge's `R`, the Dodge's and the Burn's `Shift+Alt+S/M/H`, the `0` for Exposure and the
    `[`/`]` brush-size pair are all in Adobe's published default-keyboard list, and three
    independent reproductions of it agree on the wording
    (<https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/>,
    <https://shortcutkeys.net/adobe-photoshop-shortcut-keys/>,
    <https://shortcuts.design/data/design/toolspage-adobephotoshop-windows>). **Adobe's own
    default-keyboard page was not opened**, so the rows carry a third-party citation for a
    first-party fact. The Smudge's `R` is the one that is not in this category: Adobe's current
    tool page states it in the body text ("Select the Smudge tool (R) from the toolbar"), so that
    row is first-party. What is still open under this item is the `R` for the **Blur** and the
    **Sharpen**: Adobe's current Blur page names no letter, and the current Sharpen page could not
    be opened, so neither tool's `shortcuts` array carries `R` even though they share the flyout
    and Photoshop Elements' own reference prints `R` for all three
    (<https://help.adobe.com/archive/en/photoshop-elements/11/photoshop-elements_reference.pdf>).

15. **Which `Mode` the Sponge's bar opens on. Adobe states no default, and one source is not
    enough.** `helpx.adobe.com/photoshop/using/change-color-saturation-sponge-tool.html` is
    imperative throughout — "Select Saturate or Desaturate from the Mode option as per your
    requirement" — which is equally consistent with either default. A dedicated second search found
    **no Adobe statement of a default and no second independent source** for the one non-Adobe
    claim that it is `Desaturate`. Julieanne Kost's "set the Sponge tool to Desaturate" and the
    SitePoint/Tuts+ walkthroughs are _instructions_, not default claims; the Weingart tutorial
    instructs `Saturate`. The app seeds `Desaturate` and says so at `SPONGE_MODE_DEFAULT` — the
    choice is the non-destructive direction, since a saturated stroke that clips a channel cannot be
    painted back — and the gap is in `HANDOFF.md`, not here, because it is an operator's call against
    a live Photoshop rather than a research defect.
16. **Whether Adobe ships the Sponge's `Vibrance` checked.** Adobe's sentence is an _action_ ("Select
    the Vibrance option to minimize clipping"), which reads as an instruction to enable it and so
    points at unchecked, while the two indirect signals — the CS4 framing that the tool "can now
    saturate or de-saturate with the intelligence of the Vibrance logic", and the web-app page's
    "Vibrance on by default" — point at checked. **Neither was confirmed**, and the web-app page's
    body could not be retrieved by the crawler, so do not treat that phrase as verified. The app
    seeds it **on**, because a control Adobe documents as the thing that prevents clipping should
    not ship in a state that allows it.
17. **`Flow`'s default and range.** 50% and 1-100% are one third-party walkthrough and the CS2 Bible
    respectively; Adobe describes `Flow` only as "the rate of saturation change" and gives neither.
18. **`Airbrush` on this bar.** The checkbox is documented as a general Airbrush behaviour
    (<https://www.smashingmagazine.com/2009/11/brushing-up-on-photoshops-brush-tool/>) and one
    Sponge-specific tutorial names it, but **Adobe's own enumeration of this bar does not include
    it**. It is filed `missing` on the strength of the Adobe bar census being incomplete rather than
    on a first-party statement that the control exists.
19. **The colour space the tool works in.** Nothing from Adobe: Lab is asserted for the Vibrance
    adjustment _layer_ by some sources and denied by others, HSB is asserted by others, and the one
    published statement of the per-pixel rule names Rec. 709 luma in a third-party clone's own
    implementation rather than as a Photoshop fact. The app's choice — encoded sRGB, on the grounds
    `dodgeBurn.ts` gives — is recorded at `spongeLuma` and pinned by a test.
20. **The alternative reading of `Vibrance`, rejected rather than adopted.** See §Sponge Tool: a
    tutorial describes it as boosting _subtle_ colours more than saturated ones, which is the
    Lightroom semantic, against Adobe's own "minimize clipping". Recorded because a future reader
    meeting that tutorial will otherwise think the app got it wrong.
