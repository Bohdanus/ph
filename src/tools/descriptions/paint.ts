import type { ToolDescription } from './types.ts';

export const paintDescriptions: Record<
  | 'brush'
  | 'pencil'
  | 'color-replacement'
  | 'eraser'
  | 'magic-eraser'
  | 'paint-bucket'
  | 'clone-stamp'
  | 'red-eye'
  | 'spot-healing'
  | 'healing-brush',
  ToolDescription
> = {
  brush: {
    photoshopName: 'Brush Tool',
    summary:
      'Paints the foreground color onto the layer in strokes: Opacity caps a single stroke, Flow builds it up, and the tip is stamped at Spacing intervals.',
    purpose:
      "The Brush is Photoshop's general painting tool. Click and drag to lay down a stroke of the foreground color on the active layer. The options bar carries the tip, the blend Mode, Opacity, Flow, Airbrush and stroke Smoothing; the Brush panel behind it carries the tip's Spacing, shape dynamics, scattering and texture. Opacity is a per-stroke ceiling — a stroke never exceeds the set level however many times the pointer crosses the same pixels, and a new stroke re-applies it. Flow is the per-dab build-up inside that ceiling, so one slow pass with low Flow is lighter than the same pass at 100%, and a low Flow with a low Spacing builds up faster where dabs overlap.",
    options: [
      {
        control: 'Tool Preset Picker',
        detail:
          'A dropdown at the far left of the options bar, beside the tool icon, that saves and recalls a whole options-bar state for the active tool. Adobe\'s own current documentation places it explicitly: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar", with a Create New Tool Preset icon on it. It is also the only per-tool reset on the bar, offering Reset Tool and Reset All Tools — which is what makes it the escape hatch from per-tool stickiness.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          "The tip thumbnail and the chevron beside it, and the leftmost of the bar's own controls once the Tool Preset Picker is set aside. Clicking it opens a popout from which the tip's Size and Hardness can be changed temporarily, plus an Angle/Roundness drag widget, a settings gear, a New Preset button and a grid of tip thumbnails. Size is the tip diameter in pixels, 1 to 5000. Current Photoshop carries no top-bar Size and no top-bar Hardness for this tool: both live in this popout and in the Brush Settings panel, and the popout is where a temporary change is made. The settings-snapshot picker this app renders in the same position is not standing in for the Tool Preset Picker.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:137',
      },
      {
        control: 'Toggle the Brush Settings panel',
        detail:
          "The button immediately right of the Brush Preset Picker, third from the left of the bar's own controls. Opens the Brush Settings panel, where Brush Tip Shape, Shape Dynamics, Scattering, Texture, Dual Brush, Color Dynamics, Transfer, Brush Pose, Noise, Wet Edges, Airbrush, Smoothing and Protect Texture live.",
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the stroke composites with. The app offers sixteen canvas compositing operations: Normal, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color and Luminosity. Photoshop additionally offers Behind for the Brush and Clear for the painting tools, but those values are not present in this bar. Default Normal. Adobe’s blending-mode page lists 11 modes for 32-bit images; its 32-bpc HDR support page lists 15 for 32-bpc HDR images. Since 32-bpc HDR is a 32-bit scope, the lists overlap, and Adobe does not reconcile their different counts. The blending-mode page says availability varies by tool and image mode.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:131',
      },
      {
        control: 'Opacity',
        detail:
          "A label with a numeric field, 0 to 100 percent. Default 100. A hard ceiling for one stroke, not a per-dab rate. The app seeds its Brush at 100 percent, matching Photoshop's 100.",
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:123',
      },
      {
        control: 'Always Use Pressure for Opacity',
        detail:
          "A toggle that forces stylus pressure to drive opacity regardless of the numeric field and of the tip's own Transfer settings. Off by default.",
        status: 'missing',
      },
      {
        control: 'Flow',
        detail:
          'A label with a numeric field, 0 to 100 percent. Default 100. The per-dab build-up rate inside the Opacity ceiling.',
        status: 'missing',
      },
      {
        control: 'Airbrush',
        detail:
          'A toggle that keeps stamping while the pointer is stationary, so a stroke that stops still darkens up to Opacity. With it on, the number keys drive Flow and Shift with them drives Opacity, the reverse of the normal binding.',
        status: 'missing',
      },
      {
        control: 'Smoothing',
        detail:
          "A numeric field, 0 to 100 percent, beside a gear. Default 10. The amount of stroke smoothing. Of the controls on this bar, three carry across to the Pencil and the Eraser's bars: Opacity, Smoothing and Symmetry. The gear beside it opens Smoothing Options.",
        status: 'partial',
        appRef: 'src/util/draw.ts:96',
      },
      {
        control: 'Smoothing Options',
        detail:
          'The gear beside Smoothing. Four independent checkboxes — Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End and Adjust for Zoom — with defaults Stroke Catch-up on, Adjust for Zoom on, and the other two off. Checking Pulled String Mode greys out the two catch-up modes.',
        status: 'missing',
      },
      {
        control: 'Brush Angle',
        detail:
          'A numeric field of degrees beside a small tip widget, placed after Smoothing and before Symmetry. It sets the exact tip angle for the stroke and is the precise counterpart to the Angle widget inside the Brush Preset picker popout. It does nothing on a round tip.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail:
          "A toggle that forces stylus pressure to drive tip size regardless of the tip's Shape Dynamics. On by default for the Hard Round class of presets and off for most others.",
        status: 'missing',
      },
      {
        control: 'Symmetry',
        detail:
          'A butterfly button. Offers Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial (2 to 12 segments) and Mandala (3 to 10 segments), so every dab is mirrored live. Present for the Brush, the Pencil and the Eraser only.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Temporarily switches to the Eyedropper for the duration of the press, so a color can be sampled from the canvas without leaving the Brush. NOT IMPLEMENTED in this app — no Alt handling in DrawToolArea for paint tools.',
      },
      {
        keys: 'Shift',
        action:
          'Constrains the stroke to a straight line: click once, then Shift-click a second point and the stroke is drawn between the two. NOT IMPLEMENTED for Brush/Pencil/Color Replacement in this app — only Eraser implements Shift straight-line constraint.',
      },
    ],
    shortcuts: [
      { keys: 'B', action: 'Selects the Brush Tool.' },
      {
        keys: 'Shift+B',
        action:
          'Photoshop cycles Brush, Pencil, Color Replacement and Mixer Brush. THIS APP cycles its three implemented group members (Brush, Pencil and Color Replacement); Mixer Brush is absent.',
      },
      {
        keys: '0–9',
        action:
          'In current Photoshop, bare number keys 0–9 set Brush Opacity: 0 = 100%, 1 = 10%, and two quick digits set an exact percentage. This app binds only 0 and 1.',
      },
      {
        keys: 'Shift+0–9',
        action:
          'Shift+number sets Flow and two quick digits set an exact percentage; this app does not implement numeric Flow shortcuts. The 2019 generic reference notes that with Airbrush enabled bare numbers set Flow and Shift+number sets Opacity.',
      },
      { keys: '[', action: 'Decreases the tip size.' },
      { keys: ']', action: 'Increases the tip size.' },
      { keys: '0', action: 'Sets Opacity to 100 percent while the Brush is active.' },
      { keys: '1', action: 'Sets Opacity to 10 percent while the Brush is active.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:276',
      'src/tools/brush.ts:70',
      'src/components/ToolbarsRight/Paint/Paint.tsx:43',
      'src/components/Main/DrawToolArea.tsx:143',
      'src/tools/brush.ts:109',
      'src/contexts/layer-utils.ts:230',
      'src/tools/settings.ts:140',
      'src/components/Common/AppKeyboardShortcuts.tsx:88',
      'src/components/Common/AppKeyboardShortcuts.tsx:101',
    ],
    appNotes:
      "A real painting tool, and the closest of the seven: a drag paints the foreground colour, one mouse-up is one history state, and Opacity behaves as Photoshop's per-stroke ceiling because the stroke is a single alpha-weighted pass over the whole path, though the bar seeds it at 100 percent, matching Photoshop's 100. The divergences are structural. There is no Flow and therefore no within-stroke build-up; there is no tip, so no Hardness, Spacing, angle, roundness, shape dynamics, scattering or texture, and so no Brush Angle; there is no Airbrush, no stylus pressure, no symmetry and no Brush Settings panel. Mode offers sixteen canvas compositing operations rather than Photoshop's 29 for this tool, and it is applied to the layer the stroke creates rather than to the stroke's own pixels. The Size the app renders directly on the bar is the app's own addition — current Photoshop carries no top-bar Size or Hardness here, both living in the Brush Preset picker popout and the Brush Settings panel — and it is capped at 500 px, not the 5000 the picker offers, because a stroke is rasterized into a canvas padded by the full tip width and committed as its own layer. Smoothing is real but a different algorithm: it pulls each sampled interior point toward the midpoint of its neighbours, whereas Photoshop's is a trailing anchor over the raw input stream, so the app has no catch-up and no pulled-string slack. The largest divergence is not in the bar at all — a brush stroke is committed by creating a NEW layer rather than by painting the active one. One caveat on the bindings above, and it is narrower than an earlier version of this record claimed: `B` selects the tool, and the four shortcut rows that follow it ARE implemented. `AppKeyboardShortcuts.tsx` keeps a per-tool `tipSizeField` table and a per-tool `opacityField` table, the brush appears in both, and `[`, `]`, `0` and `1` are registered against them — so `[` and `]` step the tip size by one pixel and `0` and `1` set Opacity to 100% and 10%. The Alt and Shift modifiers above are Photoshop's own and the app binds neither: `AppKeyboardShortcuts.tsx` is the complete global table, it registers no Alt override and no Shift constraint for any paint tool, and `altKey` in a pointer handler is read only by the shape, the magnetic lasso, the elliptical selection and the clone stamp.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html',
      'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf',
      'https://asktimgrey.com/2023/09/01/flow-versus-opacity-for-brushes',
      'https://photoshopcafe.com/use-flow-opacity-photoshop-brushes',
      'https://community.wacom.com/en-us/guide-to-photoshop-brushes-pt-1/',
      'https://flylib.com/books/en/4.462.1.114/1/',
      'https://asktimgrey.com/2017/03/21/pencil-brush-shape/',
      'https://web.archive.org/web/20201111235536/https:/helpx.adobe.com/photoshop/using/whats-new/2018.html',
      'https://helpx.adobe.com/photoshop/using/paint-symmetry.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/features-that-support-32-bpc-hdr-images.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants',
      'https://helpx.adobe.com/ca/photoshop/desktop/repair-retouch/clean-restore-images/healing-brush-tool.html',
      'https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
      'https://www.glensmith.co.uk/photoshop/brush',
      'https://www.practicalphotoshop.com/downloads/Practical-Photoshop-2022-Level1-sample-chapters.pdf',
      'http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf',
      'https://community.adobe.com/questions-712/changing-brush-size-shortcuts-ctrl-alt-second-click-and-drag-1167556',
    ],
  },
  pencil: {
    photoshopName: 'Pencil Tool',
    summary:
      "Paints hard-edged, non-antialiased foreground lines, with an Auto Erase option that paints background over foreground at the stroke's start.",
    purpose:
      "The Pencil is a Brush whose tip is always hard-edged, so its strokes never blend into the pixels underneath and never take a soft falloff however far the tip's hardness is reduced. It is the tool for pixel-level work, icons and hard-edged graphics, and it shares the Brush's slot in the Tools panel. Its one genuinely own control is Auto Erase, which is decided once when the drag begins: if the cursor is over the foreground color at that moment the stroke paints background color, and if it is over anything else the stroke paints foreground color. Crossing the other color mid-stroke does not switch modes.",
    options: [
      {
        control: 'Tool Preset Picker',
        detail:
          'A dropdown at the far left of the options bar, beside the tool icon, that saves and recalls a whole options-bar state for the active tool, with a Create New Tool Preset icon on it and the Reset Tool / Reset All Tools items on its menu. Adobe\'s own current documentation places it explicitly: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar".',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          "The tip thumbnail and its chevron, and the leftmost of the bar's own controls once the Tool Preset Picker is set aside. Clicking it opens a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. Size is the tip diameter in pixels, 1 to 5000. The Pencil offers hard-edged tips only, so its Hardness is fixed. Current Photoshop carries no top-bar Size and no top-bar Hardness for this tool, for the same reason as on the Brush. The settings-snapshot picker this app renders in the same position is not standing in for the Tool Preset Picker.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:137',
      },
      {
        control: 'Toggle the Brush Settings panel',
        detail: 'The button immediately right of the Brush Preset Picker, opening the Brush Settings panel.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the stroke composites with. The app offers sixteen canvas compositing operations: Normal, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color and Luminosity. Photoshop additionally offers Clear for the Pencil, but that value is not present in this bar; Behind is Brush-only. Default Normal. Adobe’s blending-mode page lists 11 modes for 32-bit images; its 32-bpc HDR support page lists 15 for 32-bpc HDR images. Since 32-bpc HDR is a 32-bit scope, the lists overlap, and Adobe does not reconcile their different counts. The blending-mode page says availability varies by tool and image mode.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:131',
      },
      {
        control: 'Opacity',
        detail:
          "A label with a numeric field, 0 to 100 percent. Default 100. A hard ceiling for one stroke. The app seeds its Pencil at 100 percent, matching Photoshop's 100.",
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:123',
      },
      {
        control: 'Always Use Pressure for Opacity',
        detail:
          "A toggle that forces stylus pressure to drive opacity regardless of the numeric field and of the tip's own Transfer settings. Off by default.",
        status: 'missing',
      },
      {
        control: 'Auto Erase',
        detail:
          'A checkbox, unique to the Pencil. Off by default. When on, a drag that begins over the foreground color erases to the background color, and a drag that begins over anything else paints the foreground color — decided at mouse-down, not per sample.',
        status: 'missing',
      },
      {
        control: 'Smoothing',
        detail:
          'A numeric field, 0 to 100 percent, beside a gear. Default 10. One of only four tools that carry it, with the Brush, the Mixer Brush and the Eraser.',
        status: 'partial',
        appRef: 'src/util/draw.ts:96',
      },
      {
        control: 'Smoothing Options',
        detail:
          'The gear beside Smoothing: Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End and Adjust for Zoom.',
        status: 'missing',
      },
      {
        control: 'Brush Angle',
        detail:
          'A numeric field of degrees beside a small tip widget, placed after Smoothing and before Auto Erase. It sets the exact tip angle for the stroke and is the precise counterpart to the Angle widget inside the Brush Preset picker popout. It does nothing on a round tip.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail:
          "A toggle that forces stylus pressure to drive tip size regardless of the tip's Shape Dynamics. On by default for the Hard Round class of presets and off for most others.",
        status: 'missing',
      },
      {
        control: 'Symmetry',
        detail:
          'A butterfly button offering Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial and Mandala. Present for the Brush, the Pencil and the Eraser only.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Temporarily switches to the Eyedropper for the duration of the press. NOT IMPLEMENTED in this app — no Alt handling in DrawToolArea for paint tools.',
      },
      {
        keys: 'Shift',
        action:
          'Click once, then Shift-click a second point and the stroke is drawn between the two as a straight line. NOT IMPLEMENTED for Brush/Pencil/Color Replacement in this app — only Eraser implements Shift straight-line constraint.',
      },
    ],
    shortcuts: [
      {
        keys: 'B',
        action:
          'Photoshop selects Brush and Shift+B cycles Brush, Pencil, Color Replacement and Mixer Brush. THIS APP binds B to Brush; Shift+B cycles Brush, Pencil and Color Replacement, with Mixer Brush absent.',
      },
      {
        keys: 'Shift+B',
        action:
          'Cycles the Brush group. THIS APP cycles Brush, Pencil and Color Replacement; Photoshop also includes Mixer Brush.',
      },
      {
        keys: 'N',
        action:
          'Selects the Pencil Tool. NOT BOUND in this app — reached by cycling the Brush tile with Shift+B, where Photoshop binds it to N.',
      },
      {
        keys: '0–9',
        action:
          'In current Photoshop, bare number keys 0–9 set Pencil Opacity: 0 = 100%, 1 = 10%, and two quick digits set an exact percentage. This app binds only 0 and 1.',
      },
      {
        keys: 'Shift+0–9',
        action:
          'Shift+number sets Flow and two quick digits set an exact percentage; this app does not implement numeric Flow shortcuts. The current Photoshop guide limits Airbrush mode to the Brush, so that exception does not apply to Pencil.',
      },
      {
        keys: '[',
        action:
          'Decreases the brush size to the next smaller preset diameter. On the Brush, Pencil, Eraser, Color Replacement Tool, Smudge, Dodge, Burn and Clone Stamp.',
      },
      {
        keys: ']',
        action:
          'Increases the brush size to the next larger preset diameter. On the Brush, Pencil, Eraser, Color Replacement Tool, Smudge, Dodge, Burn and Clone Stamp.',
      },
      {
        keys: '0',
        action:
          'Sets the brush Opacity to 100 percent. On the Brush, Pencil, Eraser, Color Replacement Tool and Clone Stamp.',
      },
      {
        keys: '1',
        action:
          'Sets the brush Opacity to 10 percent. On the Brush, Pencil, Eraser, Color Replacement Tool and Clone Stamp.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:297',
      'src/components/ToolbarsRight/Paint/Paint.tsx:43',
      'src/components/Main/DrawToolArea.tsx:143',
      'src/tools/settings.ts:157',
      'src/components/Common/AppKeyboardShortcuts.tsx:88',
      'src/components/Common/AppKeyboardShortcuts.tsx:101',
    ],
    appNotes:
      "The app renders the Pencil through the same bar factory as the Brush, with its own three synthetic presets, and its stroke is one round-capped pass of the same painter. That reproduces the hard edge, so the two agree on the one property that distinguishes them, but it is a hard edge by construction rather than by a hard tip: a round cap is aliased because the canvas rasterizes it that way, and there is no tip model that could be made soft. The Pencil's one own feature, Auto Erase, is absent entirely — there is no background color in the app's tool state, so the checkbox has nothing to decide between, and no component renders it. Mode offers sixteen canvas operations and is applied to the layer the stroke creates, not to the stroke's pixels. The Size the app renders directly on the bar is the app's own addition — current Photoshop carries no top-bar Size or Hardness here — and it is capped at 500 px rather than the 5000 the picker offers, and the shared bar seeds Opacity at 100 percent, matching Photoshop's 100. The `Alt` and `Shift` modifiers above are Photoshop's own and the app binds neither: `AppKeyboardShortcuts.tsx` is the complete global table, it registers no Alt override and no Shift constraint for any paint tool, and `altKey` in a pointer handler is read only by the shape, the magnetic lasso, the elliptical selection and the clone stamp. The `[`, `]`, `0` and `1` shortcut rows, by contrast, ARE implemented: the global table's `tipSizeField` and `opacityField` maps both list the pencil. The Pencil has no keyboard shortcut of its own here for the tool-select row: it is reached by cycling the Brush tile with Shift+B, where Photoshop binds it to N. As with the Brush, each stroke creates a new layer rather than painting the active one.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html',
      'https://helpx.adobe.com/content/dam/help/en/pdf/photoshop_reference.pdf',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/auto-erase-with-the-pencil-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/features-that-support-32-bpc-hdr-images.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants',
      'https://helpx.adobe.com/ca/photoshop/desktop/repair-retouch/clean-restore-images/healing-brush-tool.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=337',
      'https://www.oreilly.com/library/view/photoshop-elements-8/9780596809188/ch12s04.html',
      'https://www.dummies.com/article/the-new-partial-sketch-photoshop-elements-feature-259266',
      'https://asktimgrey.com/2025/08/08/pencil-versus-brush/',
      'https://asktimgrey.com/2017/03/21/pencil-brush-shape/',
      'https://flylib.com/books/en/4.462.1.114/1/',
      'https://www.glensmith.co.uk/photoshop/pencil',
      'https://helpx.adobe.com/photoshop/using/paint-symmetry.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
    ],
  },
  'color-replacement': {
    photoshopName: 'Color Replacement Tool',
    summary:
      'Recolors the pixels it paints over with the foreground color while keeping their luminosity and texture, rather than covering them.',
    purpose:
      "The Color Replacement Tool substitutes one color for another in a stroke, keeping the luminosity and the texture of what was underneath — Adobe describes its default options bar as maintaining a color's luminosity and saturation while replacing its hue. It works by painting through a Hue/Saturation/Color/Luminosity blend mode rather than compositing on top, so the foreground color should be left in Color mode. Sampling decides which color is the target — resampled continuously under the cursor, locked to the first click, or taken from the background swatch — and Limits decides how far the replacement spreads from the cursor. It is not a selection tool: there are no marching ants, and what separates it from the Paint Bucket is the trigger rather than the reach. The click that chooses the colour is the only sampling gesture, and with Limits set to Contiguous the replacement still floods the whole connected matching region from that one click, exactly as the bucket fills; Discontiguous is what confines it to the pixels under the brush.",
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          "The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. Size is the tip diameter in pixels, 1 to 5000, and it sets how much of the target colour the stroke reaches in Discontiguous mode; under Contiguous it seeds the flood rather than bounding it. This tool has no top-bar Size of its own — the popout is where Adobe puts it, which is why there is no Size row here. THIS APP DIVERGES: ColorReplacement.tsx renders a Size slider (1-200) directly on the bar, contradicting Adobe's design.",
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode that decides which component of the pixel is transferred. Hue, Saturation, Color and Luminosity are the ones that make the tool a replacement rather than a paint; Adobe says to keep it set to Color, and the default options bar does. THIS APP DIVERGES: ColorReplacement.tsx renders NO Mode control. The tool substitutes luminance directly via replaceColorPreservingLuminance rather than using canvas composite modes.',
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail: 'The strength of the replacement, 0 to 100 percent. Default 100.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:162',
      },
      {
        control: 'Sampling',
        detail:
          'Three small icons. Continuous resamples the color under the crosshair as you drag; Once locks the color of the first click for the whole stroke; Background Swatch replaces only areas containing the current background color. Adobe does not state which is the default; a third-party walkthrough of the current tool says Continuous. THIS APP DIVERGES: ColorReplacement.tsx renders a Sampling dropdown with "current-layer" | "all-layers" (disabled) — wrong semantics entirely. Photoshop\'s Continuous/Once/Background Swatch are not represented.',
        status: 'inert',
        appRef: 'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:94',
      },
      {
        control: 'Limits',
        detail:
          'A dropdown. Contiguous replaces colors contiguous with the pixel under the pointer; Discontiguous replaces the sampled color wherever it occurs under the pointer; Find Edges replaces connected areas containing the sampled color while preserving the sharpness of shape. Adobe does not state which is the default; two third-party walkthroughs of the current tool say Contiguous. THIS APP DIVERGES: ColorReplacement.tsx LIMITS_OPTIONS has "contiguous" | "discontinuous" — second entry is spelled "Discontinuous" where Adobe writes "Discontiguous". Find Edges missing.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:105',
      },
      {
        control: 'Tolerance',
        detail:
          "A percentage slider: a lower percentage replaces colors more similar to the sampled color, while a higher percentage widens the range. Adobe's archived 2015 reference does not state numeric bounds, a default, or the matching algorithm. A CS3/CS4 manual transcript on third-party mirrors says 0–255, but that range is not corroborated by Adobe and is unresolved. Third-party tutorials commonly cite 30% as the default; Adobe does not establish it.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:121',
      },
      {
        control: 'Anti-aliased',
        detail:
          'A checkbox giving the deposited color anti-aliased edges. On by default. THIS APP DIVERGES: Anti-aliased is NOT a control. Instead, a Smoothness slider (0-50, COLOR_REPLACEMENT_SMOOTHNESS_MAX) is rendered. colorReplacement.ts documents: "Adobe\'s Smoothness (Anti-aliased on older builds) runs 0-50, not 0-100."',
        status: 'missing',
      },
      {
        control: 'Brush Angle',
        detail:
          'A numeric field of degrees beside a small tip widget, placed after Anti-alias. It sets the exact tip angle for the stroke and is the precise counterpart to the Angle widget inside the Brush Preset picker popout. It does nothing on a round tip.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail:
          "A toggle that forces stylus pressure to drive tip size regardless of the tip's Shape Dynamics. Off by default for most presets.",
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'B',
        action:
          'Photoshop selects Brush with B and Shift+B cycles Brush, Pencil, Color Replacement and Mixer Brush. THIS APP binds B to Brush; Shift+B cycles its three implemented members, with Mixer Brush absent.',
      },
      {
        keys: 'Shift+B',
        action:
          'Cycles the Brush group. THIS APP cycles Brush, Pencil and Color Replacement; Photoshop also includes Mixer Brush.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:138',
      'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:71',
      'src/components/Main/ColorReplacementToolArea.tsx:141',
      'src/tools/colorReplacement.ts:182',
      'src/tools/colorReplacement.ts:313',
      'src/tools/toolProcessors.ts:310',
      'src/tools/settings.ts:174',
      'src/components/Common/AppKeyboardShortcuts.tsx:796',
      'src/components/Common/AppKeyboardShortcuts.tsx:804',
    ],
    appNotes:
      "A real substitution, and nothing like the spray can in black the previous version of this record described. The gesture is two steps in one area: a click with no sample yet is an eyedropper that reads the active layer's own pixels and stores the colour to replace (`ColorReplacementToolArea.tsx:108-116`), and every press after that opens a drag. The replacement colour is read off the live store at pointer-up (`ColorReplacementToolArea.tsx:141`) rather than mirrored into the args by a bar, so changing the foreground while the tool stays selected takes effect on the next stroke — which is why the options bar renders the foreground as a readout and writes no colour at all. What the commit writes is the substitution the tool is named for: `replaceColorPreservingLuminance` (`colorReplacement.ts:182`) applies a single luminance OFFSET, `out = replacement + (L - L_replacement)`, so each replaced pixel keeps its own shading and only its hue and chroma move. It edits the ACTIVE layer in place through `updateLayerByTool` (`ColorReplacementToolArea.tsx:166`) and never creates one, and Opacity is the strength of the substitution rather than a canvas `globalAlpha`, so a 50 percent replacement is a half-tint of the same shading rather than a half-transparent wash of a solid. Four of the controls are genuinely live and the region arithmetic behind them is real: Tolerance is a squared three-channel RGB distance, and Limits decides reach rather than membership, with Contiguous flooding out from every matching pixel the stroke touched, one call per region (`colorReplacement.ts:376-398`), and Discontiguous replacing only what is under the brush. Five things diverge. `Limits` offers two of Adobe's three entries, so Find Edges is unreachable, and the second is spelled `Discontinuous` where Adobe writes `Discontiguous` (`ColorReplacement.tsx:22`). `Tolerance` is 0-100 on this tool's own scale, converted before it reaches the shared fill code, against Adobe's documented 0-255. `Sampling` is rendered with wrong semantics (\"current-layer\" | \"all-layers\" instead of Continuous/Once/Background Swatch). `Mode` is absent entirely — the tool substitutes luminance directly rather than using canvas composite modes. `Smoothness` replaces Anti-aliased with a 0-50 slider. Size slider (1-200) on bar contradicts Adobe's popout placement. No Mode control means the tool always operates as a Color-mode replacement in spirit but with no user control. No Airbrush, no Brush Angle, no pressure, no Tool Preset Picker, no Brush Preset Picker popout. The two-gesture interaction (click to sample, drag to replace) is implemented and matches the documented behavior. Contiguous flood fill per region uses four-connected queue. Luminance-preserving substitution formula is correct.",
    sources: [
      'https://www.photoshopessentials.com/photo-editing/photoshop-color-replacement-tool-tutorial',
      'https://helpx.adobe.com/archive/en/photoshop/cc/2015/photoshop_reference.pdf',
      'https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/215',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=209',
      'https://www.glensmith.co.uk/photoshop/color-replace',
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://www.photoshopessentials.com/photo-editing/color-replacement-tool/',
      'https://www.creativebloq.com/how-to/photoshop-colour-change',
      'https://design.tutsplus.com/tutorials/how-to-use-the-color-replacement-tool-in-photoshop--cms-39825',
      'https://flylib.com/books/en/4.462.1.114/1/',
    ],
  },
  eraser: {
    photoshopName: 'Eraser Tool',
    summary:
      'Removes pixels to transparency along a stroke, in Brush, Pencil or Block mode, with per-stroke Opacity, per-dab Flow and Erase to History.',
    purpose:
      'The Eraser removes pixels under a dragged tip, writing transparency on a layer and the background color on a Background layer or one whose transparency is locked. Its Mode chooses the tip: Brush is a soft round tip with adjustable hardness, Pencil is hard-edged, and Block is a fixed-size square with no opacity control at all. Opacity is a per-stroke ceiling as on the Brush, while Flow is the per-dab rate that builds erasure up within that ceiling. Erase to History turns the same drag into a restore, painting the area back to whichever state or snapshot is set in the History panel.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. Block mode uses a square and no preset. Unlike the Brush, the Pencil and the Clone Stamp, the Eraser also keeps Size and Hardness on the bar itself, so the two are not in competition here.',
        status: 'missing',
      },
      {
        control: 'Toggle the Brush Settings panel',
        detail: 'The button immediately right of the Brush Preset Picker, opening the Brush Settings panel.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'A dropdown of Brush, Pencil and Block. Brush erases with adjustable softness and opacity; Pencil erases with hard edges and is fixed at 100 percent hardness; Block erases in a fixed-size square shape with no opacity control.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:38',
      },
      {
        control: 'Size',
        detail:
          "The tip diameter in pixels. Adobe's current page names the control on the bar but gives no range, and a third-party Elements walkthrough gives 1 to 2500; neither figure could be confirmed against an Adobe page for this tool.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:42',
      },
      {
        control: 'Hardness',
        detail:
          'A slider, 0 to 100 percent, in the Brush and Pencil modes. Pencil mode is fixed at 100. Block mode has no hardness.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:46',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, 0 to 100 percent. Default 100. 100 erases pixels completely, lower erases partially. Not available in Block mode, and Adobe removes the control there rather than greying it.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:57',
      },
      {
        control: 'Always Use Pressure for Opacity',
        detail:
          'A toggle that forces stylus pressure to drive the erase strength regardless of the numeric field. Off by default.',
        status: 'missing',
      },
      {
        control: 'Flow',
        detail:
          'Controls how quickly erasure builds across dabs beneath the Opacity ceiling; Photoshop offers it in Brush and Pencil modes. Adobe documents the default but the numeric lower bound was not verified in this audit. THIS APP implements Flow for Brush and Pencil: its slider uses 1–100%, defaults to 100%, and the processor accumulates per-dab coverage up to Opacity. Block mode omits Flow, as Photoshop does.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:151',
      },
      {
        control: 'Airbrush',
        detail:
          'A toggle that keeps erasing while the pointer is stationary, so a stopped stroke keeps cutting toward Opacity. Brush mode only.',
        status: 'missing',
      },
      {
        control: 'Smoothing',
        detail:
          'A numeric field, 0 to 100 percent, beside a gear. Default 10. One of only four tools that carry it, with the Brush, the Mixer Brush and the Pencil.',
        status: 'missing',
      },
      {
        control: 'Smoothing Options',
        detail:
          'The gear beside Smoothing: Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End and Adjust for Zoom.',
        status: 'missing',
      },
      {
        control: 'Brush Angle',
        detail:
          'A numeric field of degrees beside a small tip widget, placed after Smoothing and before Erase to History. It sets the exact tip angle for the erase and is the precise counterpart to the Angle widget inside the Brush Preset picker popout.',
        status: 'missing',
      },
      {
        control: 'Erase to History',
        detail:
          'A checkbox. With a state or snapshot set in the History panel, a drag paints the area back to that state instead of erasing it. Holding Alt while dragging turns this mode on temporarily.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail: "A toggle that forces stylus pressure to drive tip size regardless of the tip's Shape Dynamics.",
        status: 'missing',
      },
      {
        control: 'Symmetry',
        detail:
          'A butterfly button offering Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial and Mandala. Present for the Brush, the Pencil and the Eraser only.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'While dragging, temporarily switches the stroke to Erase to History, restoring the area to the state or snapshot set in the History panel. NOT IMPLEMENTED in this app.',
      },
      {
        keys: 'Shift',
        action:
          'Click once, then Shift-click a second point and the erase is drawn between the two as a straight line. IMPLEMENTED in EraserToolArea.tsx:184-190 — the ONE paint tool where Shift straight-line constraint works.',
      },
    ],
    shortcuts: [
      { keys: 'E', action: 'Selects the Eraser Tool.' },
      {
        keys: 'Shift+E',
        action:
          'Photoshop cycles Eraser, Magic Eraser and Background Eraser. THIS APP cycles Eraser and Magic Eraser; Background Eraser is absent.',
      },
      {
        keys: '[',
        action:
          'Decreases the brush size to the next smaller preset diameter. On the Brush, Pencil, Eraser, Color Replacement Tool, Smudge, Dodge, Burn and Clone Stamp.',
      },
      {
        keys: ']',
        action:
          'Increases the brush size to the next larger preset diameter. On the Brush, Pencil, Eraser, Color Replacement Tool, Smudge, Dodge, Burn and Clone Stamp.',
      },
      {
        keys: '0',
        action:
          'Sets the brush Opacity to 100 percent. On the Brush, Pencil, Eraser, Color Replacement Tool and Clone Stamp.',
      },
      {
        keys: '1',
        action:
          'Sets the brush Opacity to 10 percent. On the Brush, Pencil, Eraser, Color Replacement Tool and Clone Stamp.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:143',
      'src/tools/eraser.ts:26',
      'src/tools/eraser.ts:85',
      'src/tools/eraser.ts:215',
      'src/components/Main/EraserToolArea.tsx:211',
      'src/components/ToolbarsRight/Eraser/Eraser.tsx:38',
      'src/tools/settings.ts:192',
      'src/components/Common/AppKeyboardShortcuts.tsx:88',
      'src/components/Common/AppKeyboardShortcuts.tsx:101',
      'src/components/Common/AppKeyboardShortcuts.tsx:910',
      'src/components/Common/AppKeyboardShortcuts.tsx:918',
    ],
    appNotes: [
      'The Eraser edits the active layer in place by subtracting alpha; one pointer-up produces one history action. Brush uses a soft stamped tip, Pencil is hard-edged, and Block stamps a square. Size is capped at 500 px; Opacity is the stroke-strength ceiling and is correctly absent in Block mode.',
      'Flow is live in Brush and Pencil modes, and absent in Block mode. New actions persist `flow` and use `eraseWithFlow`, which accumulates per-dab coverage up to Opacity using lazily allocated coverage tiles; actions without `flow` retain their legacy renderer. The app slider is 1–100% with default 100%. Adobe documents Flow for Brush/Pencil, but this audit did not verify its numeric lower bound or whether Photoshop uses the same deposit algorithm; the app minimum and renderer should not be presented as Photoshop specifications.',
      'The bar also has app-only Spacing in Brush mode. Sample All Layers, pressure controls, Airbrush, Smoothing, Brush Angle, Erase to History and Symmetry are absent. Alt-drag to Erase to History is not implemented. Shift-click straight-line constraint is implemented.',
    ].join(' '),
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
      'https://www.mediacollege.com/adobe/photoshop/tool/eraser.html',
      'https://www.underwaterphotography.com/photoshop/photoshop/1_12_3_1.html',
      'https://www.glensmith.co.uk/photoshop/eraser',
      'https://www.dummies.com/article/technology/software/adobe-products/photoshop/how-to-erase-image-areas-with-eraser-tools-in-photoshop-elements-9-190185/',
      'https://helpx.adobe.com/photoshop/using/paint-symmetry.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
      'https://flylib.com/books/en/4.462.1.114/1/',
      'https://flylib.com/books/en/2.547.1.71/1/',
    ],
  },
  'magic-eraser': {
    photoshopName: 'Magic Eraser Tool',
    summary:
      'Erases every pixel similar to the one you click, to transparency, in a single click, bounded by Tolerance, Anti-alias and Contiguous.',
    purpose:
      'The Magic Eraser is the Paint Bucket run in reverse: one click erases every pixel whose color falls within Tolerance of the pixel clicked, rather than a dragged tip erasing a stroke. It works like the Magic Wand without the preview, which is its whole cost — there is no marching ants, so the region it will remove is visible only in the History panel afterwards. Tolerance sets how far a color may differ and still count, Contiguous limits the erase to the region connected to the click rather than every match in the layer, Anti-alias smooths the boundary, and Opacity sets how completely the matched pixels are cleared. On a layer whose transparency is locked the matched pixels change to the background color instead of becoming transparent; on a Background layer Photoshop converts it to a normal layer first and then clears the matched pixels to transparency.',
    options: [
      {
        control: 'Tolerance',
        detail:
          'A slider, 0 to 255. A low tolerance erases only pixels within a very narrow range of the clicked pixel; a high tolerance erases within a broader range. Adobe does not document a default; a widely-cited third-party value is 32.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:34',
      },
      {
        control: 'Anti-alias',
        detail: 'A checkbox that smooths the edges of the erased area. On by default.',
        status: 'inert',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:80',
      },
      {
        control: 'Contiguous',
        detail:
          'A checkbox. On (the default) erases only pixels contiguous to the one clicked; off erases every similar pixel in the layer.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:38',
      },
      {
        control: 'Sample All Layers',
        detail:
          'A checkbox. On samples the erased colors from the merged data of all visible layers rather than from the active layer alone.',
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, 0 to 100 percent. Default 100. 100 erases the selected pixels completely; lower erases partially, leaving some of the color visible.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:44',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'Shift+E',
        action:
          "Cycles the Eraser group. Adobe's current help page prints the bare letter E beside the tool, but Adobe's documented family gesture is Shift+E. The app implements this cycle between Eraser and Magic Eraser (`selectEraserTool` in `AppKeyboardShortcuts.tsx`).",
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:144',
      'src/tools/fill.ts:163',
      'src/util/floodFill.ts:76',
      'src/components/Main/FillToolArea.tsx:91',
      'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:24',
      'src/tools/settings.ts:206',
      'src/components/Common/AppKeyboardShortcuts.tsx:918',
    ],
    appNotes:
      "A working flood-based eraser: one click, one atomic commit, a hard 0-255 tolerance, 4-connected Contiguous as a real 4-neighbor scan, and an Opacity that scales the alpha removed per pixel so a partial erase is a partial erase. The 0-255 numeric scale and default 32 are widely reported for Photoshop but are not established by Adobe's current page; the scale is therefore an app fact, not a verified Photoshop match. It shares its args type with the Paint Bucket and both run the same mask code. Anti-alias renders with the app's legacy `Anti-aliased` spelling and Photoshop's checked state, but the input is disabled and the flood fill produces a hard-threshold boolean mask, so there is no coverage to smooth. Sample All Layers is absent, and the tool reads only the active layer's own raster. There is no preview. Unlike the previously incorrect note, the app does bind Shift+E: its eraser-group shortcut cycles between Eraser and Magic Eraser (`selectEraserTool` in `AppKeyboardShortcuts.tsx`). Its bar is the shared fill bar, built by `createFillToolbar` and rendered in `MagicEraser.tsx`.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/magic-eraser-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/change-similar-pixels-with-the-magic-eraser-tool.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
      'https://www.glensmith.co.uk/photoshop/magic-eraser',
      'https://www.ephotozine.com/article/introduction-to-photoshop-s-magic-eraser-tool-18410',
      'https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Magic_eraser.html',
      'https://www.teachucomp.com/the-magic-eraser-tool-in-photoshop-elements-instructions/',
      'https://community.adobe.com/questions-712/why-does-the-magic-eraser-tool-delete-everything-1055165',
    ],
  },
  'paint-bucket': {
    photoshopName: 'Paint Bucket Tool',
    summary:
      'Fills the contiguous area of similar color you click with the foreground color or a pattern, in one click, at a chosen Mode and Opacity.',
    purpose:
      "The Paint Bucket fills the whole connected region of similar color around the click in a single click. Tolerance decides how far a pixel's color may differ from the clicked pixel and still be filled, Contiguous limits the fill to the region connected to the click rather than every match in the layer, Anti-alias smooths the boundary, and Fill chooses the foreground color or a pattern. Mode and Opacity composite the fill, so a fill is a real layer edit rather than a paste. It shares a Tools-panel slot with the Gradient tool. Unlike the Magic Eraser it fills rather than clears; and unlike the Color Replacement tool it is committed by the single click that starts it, with no drag gesture to continue or extend the region.",
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Fill',
        detail:
          'A dropdown choosing Foreground or Pattern; choosing Pattern enables a second dropdown from which a pattern is picked. Default Foreground.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/MagicEraser/PaintBucket.tsx:51',
      },
      {
        control: 'Mode',
        detail:
          "The blend mode for the fill. Photoshop offers the layer blend modes plus Clear for Paint Bucket; Behind is Brush-only. The app renders no Mode control for Paint Bucket. Default Normal. Adobe's blending-mode page lists 11 modes for 32-bit images; its 32-bpc HDR support page lists 15 for 32-bpc HDR images. Since 32-bpc HDR is a 32-bit scope, the lists overlap, and Adobe does not reconcile their different counts. The blending-mode page says availability varies by tool and image mode. The HDR page marks Paint Bucket unsupported for 32-bpc HDR, so Clear availability for that tool does not apply in that mode; the blending-mode page separately lists Clear for Paint Bucket.",
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, 0 to 100 percent. Adobe states that lower values create more transparent fills. Default 100.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:44',
      },
      {
        control: 'Tolerance',
        detail:
          'A slider, 0 to 255. Lower values such as 10 to 20 fill only similar colors; values of 100 or more fill a broader range. Adobe does not document a default; a widely-cited third-party value is 32.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:34',
      },
      {
        control: 'Anti-alias',
        detail: 'A checkbox that smooths the edges of the filled area. On by default.',
        status: 'inert',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:80',
      },
      {
        control: 'Contiguous',
        detail:
          'A checkbox. On (the default) fills only pixels contiguous to the click; off fills all similar pixels in the image.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:38',
      },
      {
        control: 'All Layers',
        detail:
          'A checkbox. On fills based on the merged color data of all visible layers rather than the active layer alone, which is what lets the bucket fill an empty layer from the artwork beneath it.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [
      { keys: 'G', action: 'Selects the Paint Bucket Tool; with the Gradient Tool active, Shift+G cycles back to it.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:145',
      'src/tools/fill.ts:129',
      'src/tools/fill.ts:151',
      'src/components/Main/FillToolArea.tsx:154',
      'src/components/Main/FillToolArea.tsx:160',
      'src/components/ToolbarsRight/MagicEraser/PaintBucket.tsx:35',
      'src/tools/settings.ts:215',
      'src/components/Common/AppKeyboardShortcuts.tsx:870',
      'src/components/Common/AppKeyboardShortcuts.tsx:878',
    ],
    appNotes:
      'The Paint Bucket shares its flood-fill implementation with the Magic Eraser and both run the same mask code. Tolerance 0-255, Contiguous 4-connected, Opacity scales alpha added. Fill dropdown (Foreground/Pattern) present but Pattern fills use a hardcoded checkerboard. Mode missing (default Normal). Anti-alias inert (disabled checkbox, flood fill produces hard threshold). All Layers missing. No Sample All Layers equivalent for bucket. G shortcut selects Paint Bucket; Shift+G cycles to Gradient. Tool shares slot with Gradient in Photoshop; this app has them on separate tiles.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/paint-bucket-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/fill-selections-with-color-or-pattern.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/features-that-support-32-bpc-hdr-images.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
      'https://www.glensmith.co.uk/photoshop/paint-bucket',
    ],
  },
  'clone-stamp': {
    photoshopName: 'Clone Stamp Tool',
    summary:
      'Stamps a sampled source onto the destination: Alt/Option-click to set the source point, then drag to paint the sampled pixels into the active layer.',
    purpose:
      'The Clone Stamp copies pixels from a source location and paints them at the destination. Aligned keeps the sampled offset continuous across successive strokes; with Aligned off, each stroke starts again from the Alt/Option-clicked source. Opacity caps the stroke, while Flow controls per-dab build-up beneath that ceiling. THIS APP implements both controls separately. Sample chooses which layers the source is read from (missing here). Mode is the blend mode for the stamped pixels (missing). Airbrush keeps stamping while stationary (missing). Ignore Adjustment Layers skips adjustment layers when sampling (missing). Clone Source panel manages multiple sources (missing).',
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. Size is the tip diameter in pixels, 1 to 5000.',
        status: 'missing',
      },
      {
        control: 'Toggle the Brush Settings panel',
        detail: 'The button immediately right of the Brush Preset Picker, opening the Brush Settings panel.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode for the stamped pixels. Photoshop offers the full layer blend mode list. This app renders no Mode control for Clone Stamp. Default Normal. Adobe’s blending-mode page lists 11 modes for 32-bit images; its 32-bpc HDR support page lists 15 for 32-bpc HDR images. Since 32-bpc HDR is a 32-bit scope, the lists overlap, and Adobe does not reconcile their different counts. The blending-mode page says availability varies by tool and image mode.',
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail: 'A label with a numeric field, 0 to 100 percent. Default 100. The strength of each stamped copy.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:170',
      },
      {
        control: 'Always Use Pressure for Opacity',
        detail:
          "A toggle that forces stylus pressure to drive opacity regardless of the numeric field and of the tip's own Transfer settings. Off by default.",
        status: 'missing',
      },
      {
        control: 'Flow',
        detail:
          "A per-dab build-up rate beneath the Opacity ceiling. Adobe's current Clone Stamp page does not publish numeric bounds. THIS APP IMPLEMENTS FLOW separately from Opacity: the bar exposes a 1–100% slider, defaults to 100%, persists `flow`, and the processor accumulates per-pixel coverage across dabs up to the Opacity ceiling.",
        status: 'present',
        appRef: 'src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:187',
      },
      {
        control: 'Aligned',
        detail:
          'Checkbox controlling how the source point advances between strokes. Photoshop’s current guide distinguishes the most recent sampling point (on) from restarting at the original point (off), but does not state the default. The app defaults off; when on, it advances the source by each committed stroke displacement.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:201',
      },
      {
        control: 'Airbrush',
        detail:
          'A toggle that keeps stamping while the pointer is stationary, so a stopped stroke keeps painting toward Opacity. Off by default.',
        status: 'missing',
      },
      {
        control: 'Sample',
        detail:
          'A dropdown: Current Layer, Current & Below, All Layers. Default Current Layer. This app renders no Sample control. Only samples the active layer (sourceData copied from active layer bitmap).',
        status: 'missing',
      },
      {
        control: 'Ignore Adjustment Layers',
        detail: 'A checkbox that excludes adjustment layers when Sample All Layers is on. Off by default.',
        status: 'missing',
      },
      {
        control: 'Toggle Clone Source panel',
        detail:
          'A button opening the Clone Source panel to manage up to five source points with offsets, rotation, scale and flip.',
        status: 'missing',
      },
      {
        control: 'Smoothing',
        detail:
          'A numeric field, 0 to 100 percent, beside a gear. Default 10. One of only four tools that carry it, with the Brush, the Mixer Brush and the Pencil.',
        status: 'missing',
      },
      {
        control: 'Smoothing Options',
        detail:
          'The gear beside Smoothing: Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End and Adjust for Zoom.',
        status: 'missing',
      },
      {
        control: 'Brush Angle',
        detail: 'A numeric field of degrees beside a small tip widget. Sets the exact tip angle for the stroke.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail:
          "A toggle that forces stylus pressure to drive tip size regardless of the tip's Shape Dynamics. Off by default for most presets.",
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Sets the clone source point. IMPLEMENTED in CloneStampToolArea — Alt/Option-click stores source point for subsequent strokes.',
      },
      {
        keys: 'Shift',
        action:
          'Click once, then Shift-click a second point and the clone is drawn between the two as a straight line. NOT IMPLEMENTED.',
      },
    ],
    shortcuts: [
      { keys: 'S', action: 'Selects the Clone Stamp Tool.' },
      {
        keys: '[',
        action:
          'Decreases the brush size to the next smaller preset diameter. On the Brush, Pencil, Eraser, Color Replacement Tool, Smudge, Dodge, Burn and Clone Stamp.',
      },
      {
        keys: ']',
        action:
          'Increases the brush size to the next larger preset diameter. On the Brush, Pencil, Eraser, Color Replacement Tool, Smudge, Dodge, Burn and Clone Stamp.',
      },
      {
        keys: '0',
        action:
          'Sets the brush Opacity to 100 percent. On the Brush, Pencil, Eraser, Color Replacement Tool and Clone Stamp.',
      },
      {
        keys: '1',
        action:
          'Sets the brush Opacity to 10 percent. On the Brush, Pencil, Eraser, Color Replacement Tool and Clone Stamp.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:146',
      'src/tools/cloneStamp.ts:345',
      'src/tools/cloneStamp.ts:198',
      'src/components/Main/CloneStampToolArea.tsx:316',
      'src/components/Main/CloneStampToolArea.tsx:401',
      'src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:76',
      'src/tools/settings.ts:228',
      'src/components/Common/AppKeyboardShortcuts.tsx:88',
      'src/components/Common/AppKeyboardShortcuts.tsx:101',
      'src/components/Common/AppKeyboardShortcuts.tsx:925',
    ],
    appNotes:
      'The app requires an Alt/Option-clicked source and a writable active raster layer; no source refuses the gesture, and bedrock or locked layers cannot be painted. A stroke previews on pointer move and commits one raster history action on release, respecting the active selection. Aligned advances the sampled source by each committed stroke displacement. With Aligned off, each new stroke returns to the original Alt/Option source. New actions persist per-stroke `samplingOffset` for deterministic history replay; legacy actions without that field retain their original offset calculation. Opacity controls the maximum source-over coverage, while the separate 1–100% Flow slider accumulates per-dab coverage up to Opacity; historical actions without Flow retain their original renderer. Size is limited to the app slider range (1–500 px), not Photoshop’s larger maximum. Sample is not exposed and reads the active layer only. Mode, Airbrush, Ignore Adjustment Layers, Clone Source panel, Brush Preset Picker, pressure controls, Smoothing and Brush Angle are absent. The app exposes Hardness and an Aligned checkbox. `S`, `[`, `]`, `0` and `1` are bound to the Clone Stamp.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/clone-stamp-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/clone-parts-of-an-image.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/hdr-and-channel-manipulation/features-that-support-32-bpc-hdr-images.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
      'https://www.glensmith.co.uk/photoshop/clone-stamp',
    ],
  },
  'red-eye': {
    photoshopName: 'Red Eye Tool',
    summary:
      'Clicks a red pupil and corrects it to a natural color using a bounded connected-component algorithm on red pixels, with Pupil Size and Darken Amount controls.',
    purpose:
      'The Red Eye Tool corrects the red-eye effect from flash photography. Click on a red pupil and the tool finds connected red pixels within a radius and darkens them. Pupil Size sets the search radius, Darken Amount sets how much to darken. Photoshop uses a proprietary detector; this app uses a bounded connected red-pixel correction.',
    options: [
      {
        control: 'Pupil Size',
        detail:
          'A slider, 0 to 100 percent. Maps to radius proportional to image dimensions, seeded at 50. Implementation: radius = Math.max(2, Math.round(Math.min(width, height) * (0.005 + (size/100) * 0.025))).',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/RedEye/RedEye.tsx:34',
      },
      {
        control: 'Darken Amount',
        detail: 'A slider, 0 to 100 percent, seeded at 50. Sets how much to darken the corrected pixels.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/RedEye/RedEye.tsx:44',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'J',
        action:
          'Reaches the Red Eye Tool through the healing slot it shares with Spot Healing, Healing Brush, Patch and Content-Aware Move. NOT BOUND in this app — J selects Healing Brush directly, Red Eye is in flyout.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:147',
      'src/tools/redEye.ts:39',
      'src/components/Main/RedEyeToolArea.tsx:71',
      'src/components/ToolbarsRight/RedEye/RedEye.tsx:24',
      'src/tools/settings.ts:241',
    ],
    appNotes:
      "Red Eye uses bounded connected red-pixel correction (not Photoshop's proprietary detector). Pupil Size and Darken Amount controls present with 0-100 ranges. MAX_PIXELS limit of 50,000 prevents runaway corrections. One click, one commit, edits active layer in place. No Alt/Shift modifiers. J shortcut not bound for Red Eye specifically — healing family reached via Healing Brush tile.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/red-eye-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/remove-red-eye.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
    ],
  },
  'spot-healing': {
    photoshopName: 'Spot Healing Brush Tool',
    summary:
      'Drags a stroke that automatically samples surrounding pixels to repair the area, with Type (Proximity Match / Content-Aware / Create Texture) and Diffusion.',
    purpose:
      'The Spot Healing Brush is the Healing Brush without the Alt-click: it infers the source from the neighborhood of each stroke segment. Type decides the algorithm: Proximity Match samples a ring around the stroke; Content-Aware synthesizes new pixels; Create Texture makes a pattern from the area. Diffusion controls how far the sample pool extends. This app implements Proximity Match only — a deterministic outward-ring sample with luminance correction. Content-Aware and Create Texture are deferred (proprietary synthesis).',
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. Size is the tip diameter in pixels, 1 to 5000.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode for the healed pixels. Photoshop offers Normal, Replace, Multiply, Screen, Darken, Lighten, Color, Luminosity. This app renders no Mode control. Default Normal.',
        status: 'missing',
      },
      {
        control: 'Type',
        detail:
          'A dropdown: Proximity Match, Content-Aware, Create Texture. Default Proximity Match. THIS APP DIVERGES: Only Proximity Match implemented. Content-Aware and Create Texture deferred.',
        status: 'missing',
      },
      {
        control: 'Sample',
        detail:
          'A dropdown: Current Layer, Current & Below, All Layers. Default Current Layer. This app renders no Sample control. Only samples active layer.',
        status: 'missing',
      },
      {
        control: 'Diffusion',
        detail:
          'A slider, 1 to 7. Default 4. Controls how far the sample pool extends from the stroke. THIS APP DIVERGES: No Diffusion control. Implementation uses fixed outward ring sampling.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail:
          "A toggle that forces stylus pressure to drive tip size regardless of the tip's Shape Dynamics. Off by default for most presets.",
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'NOT a modifier for Spot Healing — it has no Alt-click sampling. Photoshop documents no Alt gesture for this tool.',
      },
    ],
    shortcuts: [
      {
        keys: 'J',
        action:
          'Photoshop selects the healing-tool family; Shift+J cycles it. THIS APP binds J directly to Healing Brush and does not bind Shift+J.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:137',
      'src/tools/spotHealing.ts:39',
      'src/components/Main/SpotHealingToolArea.tsx:60',
      'src/components/ToolbarsRight/SpotHealing/SpotHealing.tsx:24',
      'src/tools/settings.ts:250',
    ],
    appNotes:
      'Spot Healing uses deterministic Proximity Match approximation sampling outward ring with luminance correction. Edits active layer only. Size, Hardness, Opacity present. Type/Mode/Sample/Diffusion missing. No Alt modifier. J shortcut selects healing tile.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/spot-healing-brush-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/remove-unwanted-objects.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
    ],
  },
  'healing-brush': {
    photoshopName: 'Healing Brush Tool',
    summary:
      'Alt/Option-click to set a source, then drag to paint the sampled texture with luminance correction, like the Patch tool but stroke-based.',
    purpose:
      "The Healing Brush is the stroke-based Patch tool: Alt-click sets a source point, then dragging paints the sampled texture with luminance correction so the repair blends into the destination's brightness. Aligned keeps the sampled offset continuous across the stroke or resets it per stroke. Mode is the blend mode for the healed pixels. Sample chooses which layers the source is read from. Diffusion controls how far the sample pool extends. This app uses luminance correction like Patch tool. Alt/Option-click sets source point.",
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. Size is the tip diameter in pixels, 1 to 5000.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode for the healed pixels. Photoshop offers Normal, Replace, Multiply, Screen, Darken, Lighten, Color, Luminosity. This app renders no Mode control. Default Normal.',
        status: 'missing',
      },
      {
        control: 'Source',
        detail: 'A radio group: Sampled (Alt-click sets source) or Pattern. Default Sampled. Pattern deferred.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/HealingBrush/HealingBrush.tsx:71',
      },
      {
        control: 'Aligned',
        detail:
          'A checkbox. In Photoshop, Aligned preserves the source-to-destination offset across strokes; with it off, each new stroke begins from the original Alt/Option-clicked source. THIS APP DIVERGES: its Aligned mode anchors each stroke at the first destination point but resets to the original source on the next stroke; with Aligned off, it anchors at the stroke end, so the sampled point slides along the path during that stroke.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/HealingBrush/HealingBrush.tsx:79',
      },
      {
        control: 'Sample',
        detail:
          'A dropdown: Current Layer, Current & Below, All Layers. Default Current Layer. This app renders no Sample control. Only samples active layer.',
        status: 'missing',
      },
      {
        control: 'Diffusion',
        detail:
          'A slider, 1 to 7. Default 4. Controls how far the sample pool extends. This app renders no Diffusion control. Implementation uses fixed outward ring.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail:
          "A toggle that forces stylus pressure to drive tip size regardless of the tip's Shape Dynamics. Off by default for most presets.",
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Sets the healing source point. IMPLEMENTED in HealingBrushToolArea — Alt/Option-click stores source point for subsequent strokes.',
      },
      {
        keys: 'Shift',
        action:
          'Click once, then Shift-click a second point and the heal is drawn between the two as a straight line. NOT IMPLEMENTED.',
      },
    ],
    shortcuts: [
      {
        keys: 'J',
        action:
          'Selects Healing Brush. Photoshop uses Shift+J to cycle the healing-tool family; THIS APP does not bind Shift+J.',
      },
      { keys: '[', action: 'Decreases the brush size to the next smaller preset diameter.' },
      { keys: ']', action: 'Increases the brush size to the next larger preset diameter.' },
      { keys: '0', action: 'Sets the brush Opacity to 100 percent.' },
      { keys: '1', action: 'Sets the brush Opacity to 10 percent.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:136',
      'src/tools/healingBrush.ts:22',
      'src/components/Main/HealingBrushToolArea.tsx:71',
      'src/components/ToolbarsRight/HealingBrush/HealingBrush.tsx:24',
      'src/tools/settings.ts:239',
      'src/components/Common/AppKeyboardShortcuts.tsx:88',
      'src/components/Common/AppKeyboardShortcuts.tsx:101',
      'src/components/Common/AppKeyboardShortcuts.tsx:579',
    ],
    appNotes:
      'Healing Brush uses an Alt/Option-clicked source, copies texture with luminance correction and edits the active layer. Size, Hardness, Opacity and Aligned are present; Sample and Diffusion controls are absent, and Pattern source is unavailable. Its Aligned state reanchors to the original Alt source on each stroke instead of advancing across strokes; with Aligned off the source offset is anchored to the stroke end and moves during the drag. J selects Healing Brush directly.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/healing-brush-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/repair-a-selected-area-with-the-patch-tool.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
    ],
  },
};

// These final appNotes supersede obsolete literal notes in the descriptors above: Adobe does
// not publish the Color Replacement tolerance bounds, and the app's local range is not a PS spec.
paintDescriptions['color-replacement'].appNotes = [
  'A click samples the active layer color to replace; later drags use the live foreground color and commit the substitution to the active layer. The implementation preserves luminance with an additive offset, has no live preview, and returns no history operation when nothing matches.',
  'Photoshop describes Tolerance qualitatively as a percentage: lower values select more similar colors and higher values widen the range. Adobe does not state numeric bounds, a default, or the matching algorithm. Third-party CS3/CS4 manual transcripts report 0-255 and third-party tutorials commonly cite 30%; neither numeric claim is established by Adobe. The app uses a 0-100 slider and squared RGB-distance threshold; exact Photoshop parity is unverified.',
  'Limits offers Contiguous and misspelled Discontinuous but omits Find Edges. Sampling is a disabled dropdown with Current Layer/All Layers rather than Photoshop Continuous/Once/Background Swatch. Mode and Anti-aliased controls are absent; the app adds Smoothness and a 1-200 px Size slider on the bar, unlike the Photoshop Brush Preset picker placement. Opacity is live. The app has no tip pressure, Brush Angle, or Tool Preset Picker.',
].join(' ');

paintDescriptions.brush.appNotes = `${paintDescriptions.brush.appNotes ?? ''} Adobe documents numeric Opacity/Flow bindings, but this app does not implement digits \`2\`–\`9\`, two-digit exact Opacity, or numeric Flow shortcuts; only \`0\` and \`1\` set Brush Opacity.`;
paintDescriptions.pencil.appNotes = `${paintDescriptions.pencil.appNotes ?? ''} Adobe documents numeric Opacity bindings, but this app does not implement digits \`2\`–\`9\`, two-digit exact Opacity; only \`0\` and \`1\` set Pencil Opacity.`;
