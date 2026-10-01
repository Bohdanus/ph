import type { ToolDescription } from './types.ts';

type FocusToolName = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'gradient';

export const focusDescriptions: Record<FocusToolName, ToolDescription> = {
  blur: {
    photoshopName: 'Blur Tool',
    summary:
      'Paints blur under the brush, softening hard edges and reducing detail wherever you drag; the effect builds up pass by pass.',
    purpose:
      "The Blur tool reduces local contrast and smooths detail in the areas you paint it over, so one pass is subtle and repeated passes are not. It shares a Tools-panel slot, a single options bar, and a tip with the Sharpen and Smudge tools: the bar carries a brush preset with its Size and Hardness, a Mode, a Strength percentage that seeds at 50% and which Adobe's own guidance says to keep low, and Sample All Layers, which is what makes the effect paintable onto a blank layer above the stack for non-destructive work. It is a different thing from Filter > Blur and from the Blur Gallery, which run a Gaussian, Box, Lens, Motion, Radial, Smart, Surface or Tilt-Shift, Iris or Field blur over a whole selection or layer in one command with no brush and no per-stroke build-up.",
    options: [
      {
        control: 'Brush Preset Picker',
        detail:
          "The tip the blur is painted with, carrying its Size and Hardness. Photoshop exposes the whole preset library here; Size and Hardness are the preset's two live parameters, and a soft tip is what lets a stroke blend into its surroundings instead of standing out against them.",
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          "The blend mode the blurred result is composited with, rather than drawn at Normal, and a mode that shifts hue or saturation blurs the colour differently from one that does not. Third-party walkthroughs name Normal, Darken, Lighten, Hue, Saturation, Color and Luminosity as the choices, and one of them says the dropdown 'only offers a limited number of blends' - but no page states to what the list is restricted, and Adobe's current Blur page does not enumerate a Mode control at all.",
        status: 'missing',
      },
      {
        control: 'Strength',
        detail:
          'The percentage of the blurred result blended in per pass, 1-100% and 50% by default. It is the per-stroke build-up rate, not a radius: at 100% one pass is the full blur, and at a low value the same stroke has to be repeated to get there. Adobe and the CS-era documentation both describe 10-30% as the subtle setting and 50% or more as strong. The 1% floor is not Adobe\'s own statement - no Adobe page gives the range either way - but the CS2 Bible states it directly ("1 percent being the minimum and 100 percent being the maximum"), and a 2009 report on the tool repeats that the range is 1-100%.',
        status: 'missing',
      },
      {
        control: 'Sample All Layers',
        detail:
          'Off by default. With it on, the blur samples the composite of every visible layer, so painting on a blank layer above the stack produces a separable, opacity-adjustable result; with it off the tool reads only the active layer. The blur is written into whichever layer is active either way.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/blur.ts:11',
      'src/tools/settings.ts:52',
      'src/components/ToolbarsRight/Blur/Blur.tsx:101',
      'src/components/ToolbarsRight/Blur/Blur.tsx:121',
      'src/components/Main/Main.tsx:236',
      'src/components/Main/SharpenToolArea.tsx:33',
      'src/tools/toolProcessors.ts:119',
    ],
    appNotes:
      "The app's blur is a whole-layer FILTER, not a paint tool, and the two are not the same thing. Its options bar is a single Blur Radius slider plus an Undo Blur button; there is no brush, no Size, no Hardness, no Mode, no Strength and no Sample All Layers, because the bar's only argument is a radius in pixels that the processor hands straight to the canvas blur filter. There is no gesture surface at all: `Main`'s tool-area dispatch has no `blur` branch, so the canvas area for blur falls through to `DummyToolArea`, the inert `display: none` surface every unrouted tool gets. That is a different component from the Sharpen's: the Sharpen mounts a `SharpenToolArea` of its own, which also renders `display: none` and is documented as the deliberate absence of a gesture. Two components with the same rendering, not one. So nothing can be painted, and the whole active layer is previewed as soon as the slider moves: the bar routes through `tempUpdateLayer`, which publishes a preview layer and no history entry, and the entry is written later by the dirty-tool commit on tool switch, on export or in `mergeAllLayers`. That makes it the closest thing this editor has to Filter > Blur > Gaussian Blur - a true Gaussian, with the canvas blur filter as its kernel - wearing Photoshop's Blur tool's name. The verdict is `partial` and not `placeholder` for one specific reason, and it is the same reason the Sharpen's is: the tool does reach the document. It commits a real blurred raster with a real history entry, and `placeholder` is defined as committing nothing. What it commits is simply not what Photoshop's tool commits, which is what `partial` is for. Every one of the four controls above is therefore absent rather than incomplete. `Flow` is not one of them: no page I opened puts it on the Blur bar, so it is omitted from the table as unsourced rather than recorded as a gap - and the app could not have rendered it in any case, having no per-dab and per-stroke opacity pair to express one with, so the omission costs no fidelity claim.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/effects-filters/blur-sharpen-filters/blur-specific-areas-with-the-blur-tool.html',
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=210',
      'https://www.oreilly.com/library/view/adobe-photoshop-cs2/9780240520025/20_Chapter17.html',
      'https://flylib.com/books/en/2.190.1.43/1/',
      'https://flylib.com/books/en/2.816.1.14/1/',
      'https://www.photoshopgurus.com/forum/threads/why-doesnt-the-blur-tool-ever-work.22153/',
      'https://www.bwillcreative.com/how-to-use-the-blur-tool-in-photoshop/',
      'https://www.webpages.uidaho.edu/larc246/toolBarPages/blur.htm',
      'https://en.wikiversity.org/wiki/Adobe_Photoshop/Blur_Tool',
      'https://expertphotography.com/blur-tool-photoshop',
      'https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-blur-tool-to-soften-image-areas-in-photoshop-elements-9-205964/',
      'https://www.adobe.com/products/photoshop/smooth-edges.html',
    ],
  },
  sharpen: {
    photoshopName: 'Sharpen Tool',
    summary:
      'Paints extra edge contrast where you drag, so a soft area reads sharper without sharpening the rest of the image at all.',
    purpose:
      'The Sharpen tool increases local contrast at edges, and therefore the apparent sharpness, only in the areas you brush. It shares one options bar and one tip with the Blur and Smudge tools, and what separates it from the Blur is the direction of the local change: the Blur smooths, the Sharpen exaggerates the difference between neighbouring pixels over a wider radius, with a falloff that behaves like an unsharp mask rather than a flat average. Its bar carries a brush preset, a Mode, a Strength percentage, Sample All Layers and Protect Detail. It is not the Filter > Sharpen family: those are one-shot commands with no brush and no per-stroke build-up, and Sharpen More in particular is simply the Sharpen filter with a larger fixed amount and no controls of its own.',
    options: [
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip the sharpening is painted with, carrying its Size and Hardness. A small hard tip over one edge and a large soft tip over a whole face are two different jobs, and the tool has no other way to express that choice.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the sharpened result is composited with as you brush. On a dark edge Luminosity or Color keeps the sharpening from dragging the hue with it, which is why the mode is worth setting per area rather than once.',
        status: 'missing',
      },
      {
        control: 'Strength',
        detail:
          'How much sharpening each pass contributes, 1-100% and 50% by default. It is a per-stroke build-up rate on a filtered copy of the pixels under the brush, not a kernel radius; the effect accumulates with repeated passes over the same place, and at 10-20% it is subtle where at 50% or more it degrades quickly. No Adobe page gives the range either way; the CS2 Bible states the floor directly ("1 percent being the minimum and 100 percent being the maximum") for the Blur and Sharpen Strength alike.',
        status: 'missing',
      },
      {
        control: 'Protect Detail',
        detail:
          'On by default, and on the current desktop bar rather than an Elements leftover. Adobe enumerates it there between Strength and Sample All Layers as "Select Protect Detail to minimize pixelation and maintain image quality" - the sharpening is what produces the pixelation and this is the checkbox that keeps it from doing so. The wording is the same one Adobe used for the Sharpen tool in Photoshop Elements, where it "ensures minimized pixelated artifacts while enhancing and sharpening".',
        status: 'missing',
      },
      {
        control: 'Sample All Layers',
        detail:
          'Off by default. With it on, the tool sharpens using the composite of every visible layer, so on a blank layer above the stack the sharpening is a separable, opacity-adjustable layer rather than a destructive change to the pixels underneath.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/sharpen.ts:243',
      'src/tools/sharpen.ts:90',
      'src/tools/settings.ts:245',
      'src/components/ToolbarsRight/Sharpen/Sharpen.tsx:125',
      'src/components/ToolbarsRight/Sharpen/Sharpen.tsx:143',
      'src/components/Main/SharpenToolArea.tsx:46',
      'src/tools/toolProcessors.ts:226',
    ],
    appNotes:
      "What the app ships under this name is the Filter > Sharpen > Unsharp Mask filter, not the tool. The options bar is Amount (0-500%, 50% by default) and Radius (0-100 px, 1 px by default) - the Unsharp Mask's own control names, not the tool's - and there is no brush, no Strength, no Mode, no Sample All Layers and no Protect Detail. The Radius is the sharper divergence of the two, because Photoshop's tool has no radius control at all: the bar Adobe enumerates runs brush Size and Hardness, Strength, Protect Detail, Sample All Layers, and a write-up on the CS5 rebuild is explicit that 'the tool has no radius control, so it's really just for screen sharpening'. A slider the tool does not have is a control rendered in a place Photoshop has nothing, which is the same defect the Gradient's Opacity slider is filed under. There is no gesture either: the Sharpen's canvas area renders display:none by design, so nothing can be brushed. The layer is previewed when a slider moves rather than committed by it: the bar routes through `tempUpdateLayer`, which publishes a preview layer and no history entry, and the entry is written later by the dirty-tool commit on tool switch, on export or in `mergeAllLayers`. As on the Blur, the verdict is `partial` and not `placeholder` because the tool does reach the document: it commits a real convolved raster with a real history entry, and `placeholder` is defined as committing nothing. The kernel is a two-pass separable BOX blur subtracted from the source, which is an unsharp mask over a box kernel rather than over Photoshop's Gaussian; the file says so. That matters more for this tool than for the filter, because the addendum's own account of the three focus tools is that they are distinguished precisely by kernel behaviour - the Blur smooths, the Sharpen uses a wider radius with unsharp-like falloff rather than a box blur. The kernel class is not the gap here, because the app does have the box kernel and says so in caps. What is missing is Photoshop's Gaussian: a real unsharp mask subtracts a Gaussian-blurred copy, whose response decays smoothly away from an edge, while a box window responds flatly across its whole width and stops dead at the edge. At small radii the two are nearly interchangeable; at a wide one the app's Sharpen hardens a band of the full window width with a step at its boundary, where Photoshop tapers. So the Blur and the Sharpen here differ in radius and in magnitude, not in the shape of the kernel's response - which is exactly the distinction the addendum says separates them, and the app does not reproduce it. The one genuine strength here is over the pixels underneath: the blur runs on premultiplied colour with alpha unsharp-masked on its own scale, so a transparent hole does not bleed a ring into the opaque side - a halo Photoshop's own USM does not go out of its way to avoid either.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/effects-filters/smart-filters/sharpen-a-selection.html',
      'https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html',
      'https://www.deke.com/content/advanced-sharpening-techniques-or-close-to-the-edge-part-deux',
      'https://insider.kelbyone.com/living-on-the-edge-an-exploration-of-the-sharpening-tools-in-photoshop-by-scott-valentine/',
      'https://www.macphun.com/hans/how-to/how-to-sharpen-your-image-in-photoshop',
      'https://helpx.adobe.com/nz/photoshop/using/filter-effects-reference.html',
      'https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=221',
      'https://flylib.com/books/en/2.816.1.14/1/',
      'https://kalyankrishna4886.wordpress.com/wp-content/uploads/2013/09/adobe-photoshop-elements-reference-help-tutorial.pdf',
      'https://thelinuxcode.com/how-i-use-photoshops-blur-and-sharpen-tools-without-ruining-detail/',
    ],
  },
  smudge: {
    photoshopName: 'Smudge Tool',
    summary:
      'Drags the pixels under the brush along the stroke, picking up colour where the stroke begins and pushing it where you pull.',
    purpose:
      'The Smudge tool simulates a finger through wet paint: it picks up the colour where the stroke starts and pushes it in the direction you drag, blending what it carries into what it passes over. It is the only one of the three focus tools that transports rather than transforms, which is why it is the only one that needs Sample All Layers, the only one with Finger Painting, and the only one where sampling the wrong pixels shows up as a visible smear. Alongside the brush preset and Mode the bar has a Strength percentage - where 100% is described as effectively infinite, carrying one colour the whole length of the drag - plus Finger Painting, which starts each stroke with the foreground colour instead of the colour under the pointer.',
    options: [
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip the smudge is carried with, carrying its Size and Hardness. The smudge is the size of the fingertip, so the preset is a statement about scale rather than about texture.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Smudge/Smudge.tsx:138',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the carried colour is composited with; Adobe\'s own page for this tool puts "blend mode options" on the bar without naming a default, and Normal is the one every painting tool starts on. Darken and Lighten are the useful ones here: they smear only the pixels that are darker or lighter than the colour the stroke started on, which is how a smudge is used to push a background out from behind a subject.',
        status: 'missing',
      },
      {
        control: 'Strength',
        detail:
          'The percentage of the carried colour blended per dab, 1-100% and 50% by default. A Strength of 100% is described as equivalent to infinity: it carries the colour sampled at the start of the drag all the way to the release, at which point the smudge is effectively painting. Below 100% the carried colour fades and picks up the new colour under the brush as it goes. No Adobe page gives the range either way; the CS2 Bible covers the Smudge Strength in the same paragraph as the Blur and Sharpen one and gives the same floor ("1 percent being the minimum and 100 percent being the maximum").',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Smudge/Smudge.tsx:168',
      },
      {
        control: 'Finger Painting',
        detail:
          'Off by default, and called "dipping" in older versions of Photoshop. With it on, the stroke first applies a drop of the foreground colour and blends it into the image, then smudges that through as if a finger had been dipped in paint; the Strength setting then specifies how much foreground colour is applied, so at 100% the Smudge becomes the Brush. With it off, the colour under the pointer at the start of the stroke is used instead.',
        status: 'missing',
      },
      {
        control: 'Sample All Layers',
        detail:
          'Off by default, and called "Use All Layers" before CS2. With it on, the tool grabs colour from every visible layer and smudges it into the current layer. The layers underneath are not modified either way, which is what makes the recommended workflow - a new empty layer with the box ticked - non-destructive.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Reverses the Finger Painting setting for the length of the drag: if the box is off, Alt-dragging dips the tool into the foreground colour; if Finger Painting is on, Alt-dragging smudges normally.',
      },
    ],
    shortcuts: [
      {
        keys: 'R',
        action:
          'Selects the Smudge tool, which is the tool that owns the R slot in the Focus flyout; Shift+R cycles to the Blur and the Sharpen.',
      },
      {
        keys: '[',
        action: 'Decreases the brush tip size by one pixel, and repeats as a scrub while the key is held.',
      },
      {
        keys: ']',
        action: 'Increases the brush tip size by one pixel, and repeats as a scrub while the key is held.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/smudge.ts:149',
      'src/tools/smudge.ts:123',
      'src/tools/settings.ts:246',
      'src/components/ToolbarsRight/Smudge/Smudge.tsx:138',
      'src/components/ToolbarsRight/Smudge/Smudge.tsx:153',
      'src/components/Main/SmudgeToolArea.tsx:62',
      'src/components/Common/AppKeyboardShortcuts.tsx:49',
      'src/components/Common/AppKeyboardShortcuts.tsx:518',
      'src/tools/toolProcessors.ts:232',
    ],
    appNotes:
      "This is the closest match in the family. The processor reads each covered pixel from the untouched source raster at the texel one dab-behind along the drag, never from the buffer it is writing, so colour travels exactly one segment per dab instead of compounding into a single streak; the falloff is the shared brush engine's tipAlphaAt, so the smudge's soft edge is the same edge the Brush, Eraser, Dodge, Burn and Clone Stamp stamp. Strength is a real per-dab coverage seeded at 50% as in Photoshop, and it is `partial` rather than `present` for one narrow reason: the bar lets the slider reach 0, where `SMUDGE_STRENGTH_MIN` is 0 and the module says so in caps, while every source that states a floor for this Strength puts it at 1%. The transport semantics are right, and the app matches Photoshop's layering rule without being told to: the stroke edits the active layer, which is exactly what Sample All Layers does not change. Three controls are missing rather than wrong. Mode has nowhere to live because no control anywhere in the app edits a layer's blend mode: `Layer.blendMode` is a data field the paint tool's own Mode select writes and the PSD importer sets, and a grep for `blendMode` across `src/components/` finds only that select - the Layers panel has no blend-mode control at all. Finger Painting needs an args field of its own before it can be a control, and it is a per-dab source selection rather than a setting on the same axis as the other three. Sample All Layers would need the composite, and the processor is handed one layer's bitmap. The Brush Preset Picker is partial rather than absent because this editor has one tip shape and no presets, though Size and Hardness - the preset's two live parameters - are both there. Alt is not bound to Finger Painting. There is no build-up while the button is held: the shared stroke hook appends a point to the drag on a pointer move and there is no timer and no dwell accumulation anywhere in it, so holding the brush still deposits nothing, and one stroke is one undo entry. That is the same absence this file calls the tool's defining interaction on the Dodge and the Burn, and it is why this tool is filed `partial` on the same bar rather than `implemented` - not because the drag misbehaves, which it does not, but because the interaction the tool exists for is not there.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/smudge-tool.html',
      'https://www.adobe.com/products/photoshop/blend-colors.html',
      'https://help.adobe.com/archive/en/photoshop-elements/11/photoshop-elements_reference.pdf',
      'https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=210',
      'https://flylib.com/books/en/2.817.1.103/1/',
      'https://flylib.com/books/en/2.816.1.11/1/',
      'https://flylib.com/books/en/2.816.1.14/1/',
      'https://helpx.adobe.com/si/photoshop-elements/using/painting-overview.html',
    ],
  },
  dodge: {
    photoshopName: 'Dodge Tool',
    summary:
      'Lightens the tonal range you choose as you paint, the way holding back paper under a finger brightens a print.',
    purpose:
      'The Dodge tool comes from the darkroom: a printer holds light back under a finger to lighten that part of the print, and this is the digital version. Dragging it lightens the pixels it passes over, and it keeps doing so for as long as the button is held, so the effect is built by dwelling rather than by painting more. It is a tone operation gated by a tonal range, which is what separates it from the Sponge tool in the same flyout - the Sponge is a chroma operation with a Saturate/Desaturate mode and neither a Range nor an Exposure. Exposure is the only intensity control on the bar: there is no Opacity and no Flow, unlike the paint tools. The bar also offers Airbrush, which makes the build-up automatic while the brush rests, and Protect Tones, which is on by default and keeps the lightening from shifting hue or clipping the ends of the range.',
    options: [
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip the dodge is painted with, carrying its Size and Hardness. A large soft tip with a low Exposure is how a dodge is built gradually; a small hard one is how a catchlight is placed.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Tonal/Tonal.tsx:156',
      },
      {
        control: 'Range',
        detail:
          'Which tonal range the stroke is allowed to touch: Shadows, Midtones or Highlights, with Midtones as the default. Choosing the range is what makes the same tool usable on a face without taking the specular highlights with it, and it is why the Dodge and Burn are tone operations while the Sponge beside them is not.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Tonal/Tonal.tsx:126',
      },
      {
        control: 'Exposure',
        detail:
          'How strongly each pass lightens, as a percentage, 0-100% with 50% as the default, and the only intensity control on the bar. A low value with repeated passes is the intended workflow; a high one in a single pass is how a dodge turns into a blown highlight.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Tonal/Tonal.tsx:139',
      },
      {
        control: 'Protect Tones',
        detail:
          "On by default. A boolean that changes which pixels the stroke will touch: it helps maintain colour and prevents clipping in the highlights and shadows, which is the same work Adobe's older bar called Protect Skin Tone.",
        status: 'missing',
      },
      {
        control: 'Airbrush',
        detail:
          'Off by default. With it on, the effect keeps building on its own wherever the brush rests, without needing a new stroke - the automatic version of what holding the button still otherwise does, and the reason the tool is a "toning tool" that can build up "on the fly".',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'O',
        action: 'Selects the Dodge tool; the letter is shared with the Burn and Sponge tools in the same flyout.',
      },
      {
        keys: 'Shift+O',
        action:
          'Cycles through the tools that share the O shortcut, which reaches the Burn tool without leaving the canvas.',
      },
      {
        keys: 'Shift+Alt+S',
        action:
          'Sets the stroke to the Shadows range while the Dodge tool is active, the same key the Sponge uses to desaturate. Photoshop prints it Shift+Option+S on macOS.',
      },
      {
        keys: 'Shift+Alt+M',
        action: 'Sets the stroke to the Midtones range. Photoshop prints it Shift+Option+M on macOS.',
      },
      {
        keys: 'Shift+Alt+H',
        action: 'Sets the stroke to the Highlights range. Photoshop prints it Shift+Option+H on macOS.',
      },
      {
        keys: '0',
        action:
          'Sets Exposure to 100% while the Dodge tool is active, on the rule that any painting or editing tool takes a bare number for opacity, tolerance, strength or exposure.',
      },
      {
        keys: '[',
        action: 'Decreases the brush tip size by one pixel, and repeats as a scrub while the key is held.',
      },
      {
        keys: ']',
        action: 'Increases the brush tip size by one pixel, and repeats as a scrub while the key is held.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/dodgeBurn.ts:125',
      'src/tools/dodgeBurn.ts:177',
      'src/tools/dodgeBurn.ts:90',
      'src/tools/settings.ts:247',
      'src/components/ToolbarsRight/Tonal/Tonal.tsx:126',
      'src/components/ToolbarsRight/Tonal/Tonal.tsx:139',
      'src/components/ToolbarsRight/Tonal/Tonal.tsx:156',
      'src/components/Main/DodgeToolArea.tsx:50',
      'src/components/Common/AppKeyboardShortcuts.tsx:437',
      'toolbar-mapping.ts:94',
      'src/tools/toolProcessors.ts:238',
    ],
    appNotes:
      "Range and Exposure are both real and both wired: Range writes a field the processor reads, and Exposure drives a per-pixel amount rather than a display-only value, with the band's power driven by the exposure so a high value narrows the band instead of dragging a hard edge across the picture. The band itself is a quadratic falloff in Rec.709 luma of the encoded sRGB the editor stores, split at a flat luma 128. That is a defensible reading of what the tool does - Photoshop also scales stored channel values towards 255 - but it is a single hard split against a real tonal scale, and the three Photoshop bands are not equal halves of the range. The bar also matches Photoshop in a negative that is easy to get wrong: there is no Opacity and no Flow, only Exposure, which is why `DodgeBurnToolArgs` has no opacity or spacing field and takes both from the shared engine's defaults. Three controls are missing. There is no `Mode` control on the Dodge or Burn bar to be missing: the blend mode is fixed, and Peachpit's account of the tools is that they 'are effectively operating with the Color Burn and Color Dodge blending modes', which is why they shift colour and why Protect Tones has to be there to hold the colour back. Protect Tones is a real omission and the component says so: there is no field for it, so a checkbox would read as on while doing nothing. Airbrush is missing for the same reason. The Brush Preset Picker is partial rather than absent because Size and Hardness, the preset's two live parameters, are both present and clamped to 1-500 px and 0-100%. The largest behavioural gap is not a control: there is NO BUILD-UP. Each stroke commits once, at the slider's full Exposure value in a single pass, because a one-shot commit has to be a pure function of its args, which is also what makes the registry's replay reproduce it exactly. Holding the button still does nothing, so the tool's defining interaction is absent - and Airbrush, which exists precisely to make that build-up automatic when you cannot hold still, is missing for the same reason. Dodge and Burn deliberately share one options component, so a change to this control set cannot land on one tool and miss the other.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html',
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://www.peachpit.com/articles/article.aspx?p=3104540',
      'https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/',
      'https://fstoptraining.com/dodge-burn-tools/',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=211',
      'https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=217',
      'https://www.webpages.uidaho.edu/larc246/toolBarPages/dodge.htm',
      'https://flylib.com/books/en/2.816.1.11/1/',
      'https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-dodge-and-burn-tools-in-photoshop-elements-9-205974/',
    ],
  },
  burn: {
    photoshopName: 'Burn Tool',
    summary:
      'Darkens the tonal range you choose as you paint, the way letting more light onto a print deepens its shadows.',
    purpose:
      "The Burn tool is the Dodge tool measured from the other end: instead of holding light back, you let more of it onto the print, which deepens that part of the image. Dragging darkens the pixels it passes over, and it keeps darkening for as long as the button is held. Range confines the work to Shadows, Midtones or Highlights, and Exposure - the bar's only intensity control, with no Opacity and no Flow - sets how hard each pass works. Airbrush makes the build-up automatic while the brush rests, and Protect Tones is on by default and keeps the darkening from raising saturation or clipping the shadows and highlights.",
    options: [
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip the burn is painted with, carrying its Size and Hardness. A large soft tip with a low Exposure builds a burn gradually; a small hard one places a precise one.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Tonal/Tonal.tsx:156',
      },
      {
        control: 'Range',
        detail:
          'Which tonal range the stroke is allowed to touch: Shadows, Midtones or Highlights, with Midtones as the default. Restricting a burn to the shadows is what keeps it from muddying the midtones it was not aimed at.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Tonal/Tonal.tsx:126',
      },
      {
        control: 'Exposure',
        detail:
          'How strongly each pass darkens, as a percentage, 0-100% with 50% as the default, and the only intensity control on the bar. Low values with repeated passes are the intended workflow; a high one in a single pass closes the shadows up.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Tonal/Tonal.tsx:139',
      },
      {
        control: 'Protect Tones',
        detail:
          "On by default. A boolean that changes which pixels the stroke will touch: without it a burn raises the saturation of what it darkens as well as darkening it, and it can clip the ends of the range. This is the control Adobe's older bar called Protect Skin Tone.",
        status: 'missing',
      },
      {
        control: 'Airbrush',
        detail:
          'Off by default. With it on, the darkening keeps building wherever the brush rests, without needing a new stroke.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'Shift+O',
        action:
          'Cycles from the Dodge tool to the Burn tool, which share the O shortcut; press it again to reach the Sponge tool.',
      },
      {
        keys: 'Shift+Alt+S',
        action:
          'Sets the stroke to the Shadows range while the Burn tool is active. Photoshop prints it Shift+Option+S on macOS.',
      },
      {
        keys: 'Shift+Alt+M',
        action: 'Sets the stroke to the Midtones range. Photoshop prints it Shift+Option+M on macOS.',
      },
      {
        keys: 'Shift+Alt+H',
        action: 'Sets the stroke to the Highlights range. Photoshop prints it Shift+Option+H on macOS.',
      },
      {
        keys: '[',
        action: 'Decreases the brush tip size by one pixel, and repeats as a scrub while the key is held.',
      },
      {
        keys: ']',
        action: 'Increases the brush tip size by one pixel, and repeats as a scrub while the key is held.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/dodgeBurn.ts:394',
      'src/tools/dodgeBurn.ts:125',
      'src/tools/dodgeBurn.ts:177',
      'src/tools/settings.ts:255',
      'src/components/ToolbarsRight/Tonal/Tonal.tsx:126',
      'src/components/ToolbarsRight/Tonal/Tonal.tsx:139',
      'src/components/Main/BurnToolArea.tsx:56',
      'src/components/Common/AppKeyboardShortcuts.tsx:437',
      'toolbar-mapping.ts:94',
      'src/tools/toolProcessors.ts:244',
    ],
    appNotes:
      "The same processor as the Dodge, with the endpoint swapped: the burn's rule is c' = c - c * amount against the dodge's c' = c + (255 - c) * amount, and the module is explicit that burn is not the inverse of dodge. Range and Exposure are both wired to real per-pixel work through the same band function, and the band is a quadratic falloff in Rec.709 luma of the encoded sRGB the editor stores - a defensible reading, since Photoshop also scales stored channel values towards 0, but a single hard split at luma 128 where the three real tonal bands are not equal halves of the range. Protect Tones and Airbrush are both missing for the same reason as on the Dodge: `DodgeBurnToolArgs` has no field to hold them, and a control that renders a value the processor never reads is the failure this bar is written against. As on the Dodge there is no `Mode` control to miss, because the blend mode is fixed in Photoshop rather than selectable. The Brush Preset Picker is partial because Size and Hardness are present. The defining gap is again the absence of build-up while the button is held - one stroke, one commit, at the slider's full Exposure value in a single pass - which is a deliberate choice to keep the commit a pure function of its args so the registry replays it exactly, and which costs the tool the behaviour it exists for. This tool and the Dodge share one options component by design, so the control set cannot drift between them.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html',
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://www.peachpit.com/articles/article.aspx?p=3104540',
      'https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/',
      'https://fstoptraining.com/dodge-burn-tools/',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=211',
      'https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=217',
      'https://flylib.com/books/en/2.816.1.11/1/',
      'https://www.lenscraft.co.uk/photo-editing-tutorials/tutorial-mastering-the-photoshop-dodge-and-burn-tool/',
      'https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-dodge-and-burn-tools-in-photoshop-elements-9-205974/',
    ],
  },
  gradient: {
    photoshopName: 'Gradient Tool',
    summary:
      'Fills a selection or layer with a gradient you define by dragging: the click sets the first colour stop, the release the second.',
    purpose:
      'The Gradient tool fills the current layer, or the selection when there is one, with a smooth blend between two or more colours. Where you click is where the first stop sits and where you release is where the second sits, so the drag sets the length and the angle of the gradient at once, and the gradient clamps to its ends beyond the drag rather than fading to transparent - which is why a short drag fills everything. The bar runs from a tool-preset picker, past the Tool Mode dropdown, to the gradient swatch and then through the five gradient types, the Dither and Reverse checkboxes and a Method dropdown, and every one of those controls belongs to the tool itself rather than to a brush. A blend Mode, an Opacity and a Transparency checkbox are also part of the Gradient tool, but only on the older destructive Classic gradient: on the live tool they are layer properties in the Layers panel instead. From 24.5 the bar also offers that Tool Mode dropdown, which picks between the two, and the live gradient can be corrected after the fact by dragging its handles on the canvas.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail:
          'The button at the left end of the bar, before everything else, which opens the drop-down of saved tool presets for the Gradient tool. Photoshop ships one - a "Circular Rainbow" - and it is the control every tool carries for recalling a saved bar configuration, so it is the bar\'s first stop rather than a Gradient-specific setting.',
        status: 'missing',
      },
      {
        control: 'Tool Mode',
        detail:
          'The dropdown immediately to the right of the Tool Preset picker, picking between "Gradient" and "Classic gradient". It exists only in 24.5 and later, and it is not cosmetic: the choice changes which options follow it, since Mode, Opacity and Transparency belong to the Classic one alone. The classic tool is destructive and must be reapplied after Dither or Reverse changes; the live one writes an editable gradient adjustment layer instead.',
        status: 'missing',
      },
      {
        control: 'Gradient preset picker',
        detail:
          'The gradient swatch just to the right of the Tool Mode dropdown. Clicking it opens the Gradient Editor, where the stops, their locations, their colours, their opacity stops and their midpoints are edited and the preset saved; its dropdown arrow opens the presets library instead. It is two controls in one swatch, and the two do different things. On the live tool the Gradient Editor cannot be opened this way at all - the swatch is read-only there, and a live gradient is edited from its adjustment layer instead.',
        status: 'missing',
      },
      {
        control: 'Gradient Type',
        detail:
          'Five buttons: Linear, a straight ramp from the start point to the end point; Radial, a circle from the start point at its centre to the end point at its outer edge; Angle, a sweep in the direction the drag points; Reflected, a linear ramp mirrored about the start point; and Diamond, a rhombus radiating from it. Linear is the default, and Angle, Reflected and Diamond are the three most often left off a smaller implementation.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Gradient/Gradient.tsx:13',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the gradient is composited with, Normal by default, which is how a gradient is used to tint or to knock back whatever is beneath it rather than to replace it. It is a control of the Classic gradient only: on the live (default) Gradient tool there is no Mode in the bar at all, because the gradient is written as an adjustment layer and the blend mode is a property of that layer in the Layers panel instead.',
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail:
          'The opacity of the whole gradient, 0-100% and 100% by default. It scales the fill and is not a third stop: the gradient keeps its own alpha ramp, and this multiplies it. It is a control of the Classic gradient only - the teachucomp walkthrough is explicit that the Mode and Opacity drop-downs "do not appear in the Options bar Control panel if using the new Gradient Tool, as it applies its gradient adjustment in a separate adjustment layer", and on the live tool opacity is the adjustment layer\'s own property. So this row describes a control that is not on the 27.x bar for the default tool, and the app\'s status is partial because it renders a slider in a place Photoshop has moved the setting out of.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Gradient/Gradient.tsx:129',
      },
      {
        control: 'Dither',
        detail:
          'It adds noise at the boundaries of each colour in the interpolation so transitions appear smoother, which is what stops an 8-bit ramp from showing visible banding. On a live gradient the setting is live, so ticking it updates the existing gradient immediately; on the Classic tool it has to be reapplied. No Adobe page states a default for it, and a third-party walkthrough is the only one that calls it one, describing Dither-on and Perceptual as "both the default settings".',
        status: 'missing',
      },
      {
        control: 'Transparency',
        detail:
          'Enables the gradient pattern transparency. It is not available on the new Gradient tool at all - the checkbox belongs to the Classic gradient only - and with it off the opacity stops in the gradient are ignored.',
        status: 'missing',
      },
      {
        control: 'Reverse',
        detail:
          'Swaps the gradient ends, so the colour that was at the first stop moves to the second. As with Dither it is live on a live gradient and requires reapplying the gradient on the Classic tool, and as with Dither no page I opened states a default for it.',
        status: 'missing',
      },
      {
        control: 'Method',
        detail:
          'The interpolation method: Perceptual, which is the default and interpolates in the OKLab colour space so the ramp looks natural to the eye; Linear, which interpolates in linear colour space; and Classic, the interpolation Photoshop used for decades, kept for backwards compatibility. Perceptual became the default in 23.0, so gradients made in 22.x or earlier render differently in 23.0 and later unless this is set back to Classic.',
        status: 'missing',
      },
      {
        control: 'On-canvas gradient handles',
        detail:
          'Not an options-bar control but the tool defining editing surface, and the load-bearing one. After the drag, two round handles mark the gradient ends and a small diamond between them sets the midpoint, all draggable straight on the canvas. Dragging a handle re-aims the gradient and changes its length; dragging the line itself - avoiding the dots and the diamond - moves the whole gradient rather than one end of it, and no modifier is involved. Photoshop added these on-canvas controls together with an automatic live preview in 24.5.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action: 'Constrains the drag to multiples of 45 degrees, so a linear gradient lands on a square angle.',
      },
    ],
    shortcuts: [
      {
        keys: 'G',
        action:
          "Reaches the Gradient tool, but only on the second press: a plain G selects the Paint Bucket, and it is Shift+G that cycles the pair. The Gradient tile declares no shortcut letter of its own, while the Paint Bucket's declares G.",
      },
      {
        keys: 'Delete',
        action: 'Removes the stop under the pointer from the on-canvas gradient line.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/ToolbarsRight/Gradient/Gradient.tsx:13',
      'src/components/ToolbarsRight/Gradient/Gradient.tsx:116',
      'src/components/ToolbarsRight/Gradient/Gradient.tsx:129',
      'src/components/ToolbarsRight/Gradient/Gradient.tsx:146',
      'src/tools/gradient.ts:132',
      'src/tools/settings.ts:234',
      'src/components/Main/GradientToolArea.tsx:40',
      'src/components/Main/GradientToolArea.tsx:95',
      'src/tools/toolProcessors.ts:220',
    ],
    appNotes:
      "The fill itself is right: the drag sets both endpoints, the projection clamps to the ends rather than fading to transparent, and a linear ramp puts the exact mean of the two stops at the midpoint of the axis. Everything around it is thinner than the bar. The bar has four controls where Photoshop's bar has eleven, and it does not even start where Photoshop's does: the Tool Preset picker is the control at the left end of the Photoshop bar and this bar opens with `Type` instead, so there is no saved-preset recall at all. Gradient Type offers only Linear and Radial - Angle, Reflected and Diamond have no representation in a fixed from/to pair. The Radial is also a different fill: the app's holds its end colour past the circle through the second stop, and no page I opened states that Photoshop mirrors there, so that difference is recorded as a structural consequence of the fixed `from`/`to` args rather than as a Photoshop behaviour. Dither, Reverse and the Method dropdown are all missing, and Method is the most consequential omission of the three: the app interpolates the two stops as plain per-channel RGB, which is closest to the Classic behaviour that Photoshop stopped defaulting to in 23.0, so every gradient this editor paints is one Method dropdown away from a different ramp. The Tool Mode dropdown is missing too, so there is no live/classic choice at all - the app is permanently the destructive one, and even a Dither checkbox would have had to be reapplied by hand. Transparency is absent, which happens to match the modern tool rather than the Classic one, but for the wrong reason: there is no alpha ramp at all. The Opacity slider is the one control the app carries that Photoshop has taken off the live tool's bar entirely - on the Classic gradient it is a bar dropdown, and on the live one it is the adjustment layer's own property in the Layers panel - so the app shows a control Photoshop moved, which is why that row is `partial` and not `present`. The preset picker and the Gradient Editor are gone, so there are no multi-stop gradients, no per-stop opacity or position, no midpoints, and no gradient styles. The two stops are two colour inputs in the bar rather than a picker, and they are the tool's only gradient state - there is no Foreground-to-Background preset and nothing to reset to. The load-bearing gap is the on-canvas handles: the tool area accepts the overlay context and never draws to it, and from/to are written only by the drag, so once the fill is committed its geometry cannot be changed at all without painting a second gradient over it. Photoshop's live-preview gradient, added in 24.5, is not a refinement of that - it is the difference between a fill and an editable object. Nothing is bound to Shift, so a drag is never constrained to a square angle. The two preset keys are bound nowhere in the app at all: `,` and `.` are on no keyboard handler, and `[` and `]` are registered but as the shared tip-size nudge, which is gated to the tools that carry a tip-size field and the Gradient is not one of them, so both are dead while this tool is active. The only `Delete` bindings belong to the two lasso tool areas, so no key removes a gradient stop. The bar's four controls are not the ones Photoshop sequences, so a user arriving from Photoshop finds neither the Order nor the Method. The verdict is `partial` and not `placeholder` because the fill does reach the document as a real raster with a real history entry; what it commits is not what Photoshop's tool commits, which is a narrower gradient with no editable object left behind.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/gradient-tool.html',
      'https://www.teachucomp.com/how-to-use-the-gradient-tool-in-photoshop-instructions/',
      'https://www.teachucomp.com/how-to-edit-a-gradient-adjustment-in-photoshop-instructions/',
      'https://taylorhieber.co/how-to-use-the-improved-gradient-interpolations-in-adobe-photoshop/',
      'https://www.adobe.com/learn/photoshop/web/blend-two-images-gradient',
      'https://community.adobe.com/announcements-710/photoshop-24-5-is-now-available-1154445',
      'https://www.photoshopessentials.com/photo-effects/fade-an-image-to-color-in-photoshop-faster-with-live-gradients/',
      'https://www.photoshopessentials.com/photo-effects/add-a-vignette-to-a-photo-with-photoshops-live-gradients/',
      'https://cheat-sheet.org/en/post/photoshop-keyboard-shortcuts/',
      'https://luminousworks.substack.com/p/grokking-gradients',
      'https://glensmith.co.uk/photoshop/gradient-tool',
      'https://digital-photography-school.com/photoshop-gradient-tool/',
    ],
  },
};
