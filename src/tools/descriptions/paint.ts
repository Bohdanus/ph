import type { ToolDescription } from './types.ts';

export const paintDescriptions: Record<
  'brush' | 'pencil' | 'color-replacement' | 'eraser' | 'magic-eraser' | 'paint-bucket' | 'clone-stamp' | 'red-eye',
  ToolDescription
> = {
  brush: {
    photoshopName: 'Brush Tool',
    summary:
      'Paints the foreground color onto the layer in strokes: Opacity caps a single stroke, Flow builds it up, and the tip is stamped at Spacing intervals.',
    purpose:
      'The Brush is Photoshop’s general painting tool. Click and drag to lay down a stroke of the foreground color on the active layer. The options bar carries the tip, the blend Mode, Opacity, Flow, Airbrush and stroke Smoothing; the Brush panel behind it carries the tip’s Spacing, shape dynamics, scattering and texture. Opacity is a per-stroke ceiling — a stroke never exceeds the set level however many times the pointer crosses the same pixels, and a new stroke re-applies it. Flow is the per-dab build-up inside that ceiling, so one slow pass with low Flow is lighter than the same pass at 100%, and a low Flow with a low Spacing builds up faster where dabs overlap.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail:
          'A dropdown at the far left of the options bar, beside the tool icon, that saves and recalls a whole options-bar state for the active tool. Adobe’s own current documentation places it explicitly: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar", with a Create New Tool Preset icon on it. It is also the only per-tool reset on the bar, offering Reset Tool and Reset All Tools — which is what makes it the escape hatch from per-tool stickiness.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          "The tip thumbnail and the chevron beside it, and the leftmost of the bar's own controls once the Tool Preset Picker is set aside. Clicking it opens a popout from which the tip’s Size and Hardness can be changed temporarily, plus an Angle/Roundness drag widget, a settings gear, a New Preset button and a grid of tip thumbnails. Size is the tip diameter in pixels, 1 to 5000. Current Photoshop carries no top-bar Size and no top-bar Hardness for this tool: both live in this popout and in the Brush Settings panel, and the popout is where a temporary change is made. The settings-snapshot picker this app renders in the same position is not standing in for the Tool Preset Picker.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:137',
      },
      {
        control: 'Toggle the Brush Settings panel',
        detail:
          'The button immediately right of the Brush Preset Picker, third from the left of the bar’s own controls. Opens the Brush Settings panel, where Brush Tip Shape, Shape Dynamics, Scattering, Texture, Dual Brush, Color Dynamics, Transfer, Brush Pose, Noise, Wet Edges, Airbrush, Smoothing and Protect Texture live.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the stroke composites with. The app offers sixteen canvas compositing operations: Normal, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color and Luminosity. Photoshop additionally offers Behind for the Brush and Clear for the painting tools, but those values are not present in this bar. Default Normal.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:131',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. A hard ceiling for one stroke, not a per-dab rate. The app seeds its Brush at 90 percent, not Photoshop’s 100.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:123',
      },
      {
        control: 'Always Use Pressure for Opacity',
        detail:
          'A toggle that forces stylus pressure to drive opacity regardless of the numeric field and of the tip’s own Transfer settings. Off by default.',
        status: 'missing',
      },
      {
        control: 'Flow',
        detail:
          'A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. The per-dab build-up rate inside the Opacity ceiling.',
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
          'A numeric field, 0 to 100 percent, beside a gear. Default 10. The amount of stroke smoothing. Of the controls on this bar, three carry across to the Pencil and the Eraser’s bars: Opacity, Smoothing and Symmetry. The gear beside it opens Smoothing Options.',
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
          'A toggle that forces stylus pressure to drive tip size regardless of the tip’s Shape Dynamics. On by default for the Hard Round class of presets and off for most others.',
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
          'Temporarily switches to the Eyedropper for the duration of the press, so a color can be sampled from the canvas without leaving the Brush.',
      },
      {
        keys: 'Shift',
        action:
          'Constrains the stroke to a straight line: click once, then Shift-click a second point and the stroke is drawn between the two.',
      },
    ],
    shortcuts: [
      { keys: 'B', action: 'Selects the Brush Tool.' },
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
      'src/components/Common/AppKeyboardShortcuts.tsx:538',
    ],
    appNotes:
      'A real painting tool, and the closest of the seven: a drag paints the foreground colour, one mouse-up is one history state, and Opacity behaves as Photoshop’s per-stroke ceiling because the stroke is a single alpha-weighted pass over the whole path, though the bar seeds it at 90 percent where Photoshop’s is 100. The divergences are structural. There is no Flow and therefore no within-stroke build-up; there is no tip, so no Hardness, Spacing, angle, roundness, shape dynamics, scattering or texture, and so no Brush Angle; there is no Airbrush, no stylus pressure, no symmetry and no Brush Settings panel. Mode offers sixteen canvas compositing operations rather than Photoshop’s 29 for this tool, and it is applied to the layer the stroke creates rather than to the stroke’s own pixels. The Size the app renders directly on the bar is the app’s own addition — current Photoshop carries no top-bar Size or Hardness here, both living in the Brush Preset picker popout and the Brush Settings panel — and it is capped at 500 px, not the 5000 the picker offers, because a stroke is rasterized into a canvas padded by the full tip width and committed as its own layer. Smoothing is real but a different algorithm: it pulls each sampled interior point toward the midpoint of its neighbours, whereas Photoshop’s is a trailing anchor over the raw input stream, so the app has no catch-up and no pulled-string slack. The largest divergence is not in the bar at all — a brush stroke is committed by creating a NEW layer rather than by painting the active one. One caveat on the bindings above, and it is narrower than an earlier version of this record claimed: `B` selects the tool, and the four shortcut rows that follow it ARE implemented. `AppKeyboardShortcuts.tsx` keeps a per-tool `tipSizeField` table and a per-tool `opacityField` table, the brush appears in both, and `[`, `]`, `0` and `1` are registered against them — so `[` and `]` step the tip size by one pixel and `0` and `1` set Opacity to 100 and 10 percent, which is exactly what those four rows describe. What the app binds none of is the two MODIFIER rows: no Alt eyedropper swap and no Shift straight-line constraint on a stroke, because `DrawToolArea.tsx` reads no modifier at all and `AppKeyboardShortcuts.tsx` registers no Alt-bearing keybinding for any paint tool.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://asktimgrey.com/2023/09/01/flow-versus-opacity-for-brushes',
      'https://photoshopcafe.com/use-flow-opacity-photoshop-brushes',
      'https://community.wacom.com/en-us/guide-to-photoshop-brushes-pt-1/',
      'https://flylib.com/books/en/4.462.1.114/1/',
      'https://asktimgrey.com/2017/03/21/pencil-brush-shape/',
      'https://web.archive.org/web/20201111235536/https:/helpx.adobe.com/photoshop/using/whats-new/2018.html',
      'https://helpx.adobe.com/photoshop/using/paint-symmetry.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
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
      'Paints hard-edged, non-antialiased foreground lines, with an Auto Erase option that paints background over foreground at the stroke’s start.',
    purpose:
      'The Pencil is a Brush whose tip is always hard-edged, so its strokes never blend into the pixels underneath and never take a soft falloff however far the tip’s hardness is reduced. It is the tool for pixel-level work, icons and hard-edged graphics, and it shares the Brush’s slot in the Tools panel. Its one genuinely own control is Auto Erase, which is decided once when the drag begins: if the cursor is over the foreground color at that moment the stroke paints background color, and if it is over anything else the stroke paints foreground color. Crossing the other color mid-stroke does not switch modes.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail:
          'A dropdown at the far left of the options bar, beside the tool icon, that saves and recalls a whole options-bar state for the active tool, with a Create New Tool Preset icon on it and the Reset Tool / Reset All Tools items on its menu. Adobe’s own current documentation places it explicitly: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar".',
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
          'The blend mode the stroke composites with. The app offers sixteen canvas compositing operations: Normal, Darken, Multiply, Color Burn, Lighten, Screen, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color and Luminosity. Photoshop additionally offers Clear for the Pencil, but that value is not present in this bar; Behind is Brush-only. Default Normal.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:131',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. A hard ceiling for one stroke. The app seeds its Pencil at 90 percent, not Photoshop’s 100.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:123',
      },
      {
        control: 'Always Use Pressure for Opacity',
        detail:
          'A toggle that forces stylus pressure to drive opacity regardless of the numeric field and of the tip’s own Transfer settings. Off by default.',
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
          'A toggle that forces stylus pressure to drive tip size regardless of the tip’s Shape Dynamics. On by default for the Hard Round class of presets and off for most others.',
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
        action: 'Temporarily switches to the Eyedropper for the duration of the press.',
      },
      {
        keys: 'Shift',
        action:
          'Click once, then Shift-click a second point and the stroke is drawn between the two as a straight line.',
      },
    ],
    shortcuts: [
      {
        keys: 'B',
        action:
          'Selects the Brush Tool. Holding Shift while pressing it cycles the shared slot — Brush, Pencil, Color Replacement Tool, Mixer Brush Tool.',
      },
      { keys: 'N', action: 'Selects the Pencil Tool.' },
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
      'src/components/Common/AppKeyboardShortcuts.tsx:538',
    ],
    appNotes:
      'The app renders the Pencil through the same bar factory as the Brush, with its own three synthetic presets, and its stroke is one round-capped pass of the same painter. That reproduces the hard edge, so the two agree on the one property that distinguishes them, but it is a hard edge by construction rather than by a hard tip: a round cap is aliased because the canvas rasterizes it that way, and there is no tip model that could be made soft. The Pencil’s one own feature, Auto Erase, is absent entirely — there is no background color in the app’s tool state, so the checkbox has nothing to decide between, and no component renders it. Mode offers sixteen canvas operations and is applied to the layer the stroke creates, not to the stroke’s pixels. The Size the app renders directly on the bar is the app’s own addition — current Photoshop carries no top-bar Size or Hardness here — and it is capped at 500 px rather than the 5000 the picker offers, and the shared bar seeds Opacity at 90 percent where Photoshop’s is 100. The `Alt` and `Shift` modifiers above are Photoshop’s own and the app binds neither: `AppKeyboardShortcuts.tsx` is the complete global table, it registers no Alt override and no Shift constraint for any paint tool, and `altKey` in a pointer handler is read only by the shape, the magnetic lasso, the elliptical selection and the clone stamp. The `[`, `]`, `0` and `1` shortcut rows, by contrast, ARE implemented: the global table’s `tipSizeField` and `opacityField` maps both list the pencil. The Pencil has no keyboard shortcut of its own here for the tool-select row: it is reached by cycling the Brush tile with Shift+B, where Photoshop binds it to N. As with the Brush, each stroke creates a new layer rather than painting the active one.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/auto-erase-with-the-pencil-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
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
      'The Color Replacement Tool substitutes one color for another in a stroke, keeping the luminosity and the texture of what was underneath — Adobe describes its default options bar as maintaining a color’s luminosity and saturation while replacing its hue. It works by painting through a Hue/Saturation/Color/Luminosity blend mode rather than compositing on top, so the foreground color should be left in Color mode. Sampling decides which color is the target — resampled continuously under the cursor, locked to the first click, or taken from the background swatch — and Limits decides how far the replacement spreads from the cursor. It is not a selection tool: there are no marching ants, and what separates it from the Paint Bucket is the trigger rather than the reach. The click that chooses the colour is the only sampling gesture, and with Limits set to Contiguous the replacement still floods the whole connected matching region from that one click, exactly as the bucket fills; Discontiguous is what confines it to the pixels under the brush.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. Size is the tip diameter in pixels, 1 to 5000, and it sets how much of the target colour the stroke reaches in Discontiguous mode; under Contiguous it seeds the flood rather than bounding it. This tool has no top-bar Size of its own — the popout is where Adobe puts it, which is why there is no Size row here.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode that decides which component of the pixel is transferred. Hue, Saturation, Color and Luminosity are the ones that make the tool a replacement rather than a paint; Adobe says to keep it set to Color, and the default options bar does.',
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
          'Three small icons. Continuous resamples the color under the crosshair as you drag; Once locks the color of the first click for the whole stroke; Background Swatch replaces only areas containing the current background color. Adobe does not state which is the default; a third-party walkthrough of the current tool says Continuous.',
        status: 'inert',
        appRef: 'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:94',
      },
      {
        control: 'Limits',
        detail:
          'A dropdown. Contiguous replaces colors contiguous with the pixel under the pointer; Discontiguous replaces the sampled color wherever it occurs under the pointer; Find Edges replaces connected areas containing the sampled color while preserving the sharpness of shape. Adobe does not state which is the default; two third-party walkthroughs of the current tool say Contiguous.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:105',
      },
      {
        control: 'Tolerance',
        detail:
          'A slider, 0 to 255, entered as a percentage. A low value replaces only colors very similar to the pixel clicked; a higher value widens the range. Adobe does not document a default; a widely-cited third-party value is 30 percent.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx:121',
      },
      {
        control: 'Anti-aliased',
        detail: 'A checkbox giving the deposited color anti-aliased edges. On by default.',
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
          'A toggle that forces stylus pressure to drive tip size regardless of the tip’s Shape Dynamics. Off by default for most presets.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'B',
        action:
          'Reaches the Color Replacement Tool through the slot it shares with the Brush, the Pencil and the Mixer Brush. It is the tile’s default letter that selects, and Shift+B cycles between them.',
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
      'src/components/Common/AppKeyboardShortcuts.tsx:368',
    ],
    appNotes:
      'A real substitution, and nothing like the spray can in black the previous version of this record described. The gesture is two steps in one area: a click with no sample yet is an eyedropper that reads the active layer’s own pixels and stores the colour to replace (`ColorReplacementToolArea.tsx:108-116`), and every press after that opens a drag. The replacement colour is read off the live store at pointer-up (`ColorReplacementToolArea.tsx:141`) rather than mirrored into the args by a bar, so changing the foreground while the tool stays selected takes effect on the next stroke — which is why the options bar renders the foreground as a readout and writes no colour at all. What the commit writes is the substitution the tool is named for: `replaceColorPreservingLuminance` (`colorReplacement.ts:182`) applies a single luminance OFFSET, `out = replacement + (L − L_replacement)`, so each replaced pixel keeps its own shading and only its hue and chroma move. It edits the ACTIVE layer in place through `updateLayerByTool` (`ColorReplacementToolArea.tsx:166`) and never creates one, and Opacity is the strength of the substitution rather than a canvas `globalAlpha`, so a 50 percent replacement is a half-tint of the same shading rather than a half-transparent wash of a solid. Four of the controls are genuinely live and the region arithmetic behind them is real: Tolerance is a squared three-channel RGB distance, and Limits decides reach rather than membership, with Contiguous flooding out from every matching pixel the stroke touched, one call per region (`colorReplacement.ts:376-398`), and Discontiguous replacing only what is under the brush. Five things diverge. `Limits` offers two of Adobe’s three entries, so Find Edges is unreachable, and the second is spelled `Discontinuous` where Adobe writes `Discontiguous` (`ColorReplacement.tsx:22`). `Tolerance` is 0-100 on this tool’s own scale, converted before it reaches the shared fill code, against Adobe’s documented 0-255. `Sampling` is a real `disabled` select whose options are `Current Layer` and `All Layers` — neither of Adobe’s Continuous / Once / Background Swatch, and the app has no background color for Background Swatch to name — so the one control that decides which colour is the target cannot reach the tool at all. `Mode` and the Brush Preset Picker are absent, so the Color blend mode Adobe calls the reason this tool is a replacement is unreachable and there is no tip, and the top-bar Size slider the app renders in that position has no Photoshop counterpart on this bar at all — Adobe’s own manual opens the tool with “Choose a brush tip in the options bar” and never lists a Size — so it is capped at 200 px (`ColorReplacement.tsx:148`) rather than the 5000 the picker offers, and it is the app’s addition recorded here rather than in `options[]`. The bar also carries one control Photoshop does not have: `Smoothness` (`ColorReplacement.tsx:130-144`), a 0-50 feathering of the boundary the user can see, which is recorded here rather than in `options[]` because `types.ts` reserves that array for Photoshop’s own controls. Photoshop repaints the replaced pixels live as the stroke moves; the app draws no preview at all, for the reason its own tool area states — an honest overlay needs the full-layer plan recomputed on every pointer move. Its tool-select key is the one above, and the app agrees with it: the tool sits in the Brush group, so `B` reaches the slot and `Shift+B` cycles to it — the same binding the app already had. `AppKeyboardShortcuts.tsx` also lists it in the `tipSizeField` table, so `[` and `]` resize its tip and the `0` and `1` opacity rows apply here as they do on the Brush.',
    sources: [
      'https://www.photoshopessentials.com/photo-editing/photoshop-color-replacement-tool-tutorial',
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
          'The tip diameter in pixels. Adobe’s current page names the control on the bar but gives no range, and a third-party Elements walkthrough gives 1 to 2500; neither figure could be confirmed against an Adobe page for this tool.',
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
          'A label with a numeric field, 0 to 100 percent. Default 100. How quickly the erasure is applied, so repeated passes over one area build up to the Opacity ceiling. Adobe states the range and the default but not the minimum.',
        status: 'inert',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:146',
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
        detail: 'A toggle that forces stylus pressure to drive tip size regardless of the tip’s Shape Dynamics.',
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
          'While dragging, temporarily switches the stroke to Erase to History, restoring the area to the state or snapshot set in the History panel.',
      },
      {
        keys: 'Shift',
        action:
          'Click once, then Shift-click a second point and the erase is drawn between the two as a straight line.',
      },
    ],
    shortcuts: [
      { keys: 'E', action: 'Selects the Eraser Tool.' },
      {
        keys: 'Shift+E',
        action: 'Cycles the slot shared with the Magic Eraser and the Background Eraser.',
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
      'src/components/Common/AppKeyboardShortcuts.tsx:483',
    ],
    appNotes:
      'The Eraser edits the active layer in place by subtracting alpha, which is the right model, and it produces exactly one history state per stroke because the commit is the pointer-up. A previous version of this record said the Mode list was Photoshop-shaped but not Photoshop-capable, because the `brush` option was rendered with Adobe’s real label and `disabled` on the DOM node and Hardness was absent for the same reason. Both halves of that are no longer true: `Eraser.tsx` offers Brush, Pencil and Block with none of them disabled, Brush mode reaches the shared stamped-dab tip engine through `eraseWithTip` (`eraser.ts:215`), and Hardness renders as a live slider in Brush mode wired through `handleHardnessChange`. Mode is therefore `present` and Hardness `partial` rather than `missing` — partial because the bar withholds it in Pencil mode, where Adobe’s page still lists Hardness among the four controls adjustable there and where the app’s Pencil mode is hard-edged by construction. Two app-only controls are on the bar and are recorded here rather than in `options[]`: a `Spacing` slider in Brush mode, wired to the tip engine’s spacing, which Adobe puts in the Brush Settings panel rather than on this bar, and the mode-gated rendering of Hardness itself. Size is capped at 500 px. Opacity is present and works as Photoshop’s per-stroke ceiling, and the control is correctly withheld in Block mode. Flow remains the notable finding: the bar renders Photoshop’s real `Flow` label over a 1–100 range and a hardcoded 100 percent value, and Adobe documents neither bound, but the input carries `disabled` and writes nothing, because Flow is a per-dab alpha ramp and one stamped pass cannot honour one. Airbrush, Smoothing and the two pressure toggles, Brush Angle, Erase to History and Symmetry are absent, and so is the Alt-drag temporary Erase to History gesture. The Shift straight-line constraint, by contrast, is implemented and is the one modifier row on this bar the app honours: `EraserToolArea.tsx` anchors the stroke on a plain click and draws from that anchor on a Shift-click, the two-click gesture Adobe describes. Because Brush and Pencil modes stamp through the tip engine, the tip spacing is 1 and each dab removes `alpha * (1 - weight)` where the weight is the hardness falloff — so this is a real erase, not the hard edge an earlier version of this record described.',
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
          'Cycles the slot shared with the Eraser and the Background Eraser. Adobe’s own help page prints the bare letter E beside the tool, but the tool does not have E to itself \u2014 the Eraser does.',
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
    ],
    appNotes:
      'A working flood-based eraser: one click, one atomic commit, a hard 0–255 tolerance on Adobe’s scale rather than the Magic Wand’s 0–100, a default of 32 that matches the value third parties report as Adobe’s own, 4-connected Contiguous as a real 4-neighbor scan, and an Opacity that scales the alpha removed per pixel so a partial erase is a partial erase. It shares its args type with the Paint Bucket and both run the same mask code, which is why Contiguous and Tolerance are genuinely wired for both. Anti-alias is the finding: it renders with the app’s own legacy `Anti-aliased` spelling, which current Adobe pages have dropped in favour of `Anti-alias`, and with Photoshop’s real checked state, but the input carries `disabled` and the flood fill’s test is a hard threshold producing a boolean mask, so there is no coverage to anti-alias. Sample All Layers is absent, and the tool is structurally active-layer-only — `FillToolArea` reads the active layer’s own raster and refuses the Bedrock layer outright, so there is no merged data to sample. As in Photoshop there is no preview of the region about to be removed, and the app does not bind `Shift+E`: the eraser family shares one plain `E` registration with no Shift twin (`AppKeyboardShortcuts.tsx:483`), so the tool is selected only by cycling with Shift+B from the eraser slot rather than the cycle Photoshop uses. Its bar is the shared fill bar, built by `createFillToolbar` and rendered at `MagicEraser.tsx:24`.',
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
      'The Paint Bucket fills the whole connected region of similar color around the click in a single click. Tolerance decides how far a pixel’s color may differ from the clicked pixel and still be filled, Contiguous limits the fill to the region connected to the click rather than every match in the layer, Anti-alias smooths the boundary, and Fill chooses the foreground color or a pattern. Mode and Opacity composite the fill, so a fill is a real layer edit rather than a paste. It shares a Tools-panel slot with the Gradient tool. Unlike the Magic Eraser it fills rather than clears; and unlike the Color Replacement tool it is committed by the single click that starts it, with no drag gesture to continue or extend the region.',
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
          "The blend mode for the fill, offering the 27 layer blend modes — Dissolve among them — plus Clear, the one extra this tool gets. Behind is the Brush's alone, so it is not offered here. Default Normal.",
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
      'src/components/Common/AppKeyboardShortcuts.tsx:335',
    ],
    appNotes:
      'One click, one atomic commit on the active layer, with the foreground color read off the live store at the moment of the click rather than mirrored into the args, and the fill composited as a real source-over so a 50 percent fill over transparent pixels is half coverage of clean red rather than half-black — that is the one place where this implementation is more correct than a naive lerp. Tolerance, Contiguous and Opacity are genuinely wired and share the fill code with the Magic Eraser. Four of the fill controls diverge. Pattern renders `disabled` under the real `Fill` label: there is no pattern registry, no tile and no processor branch that could read one, so it is present in the DOM and inert rather than absent. Anti-alias is the shared fill bar’s `disabled` checkbox, which carries the app’s own legacy `Anti-aliased` spelling and is inert for the same hard-threshold reason as the Magic Eraser’s. Mode is absent outright and cannot be added cheaply: the tool’s args type declares no blend mode, and the fill is applied to the active layer’s pixels rather than to a new layer, so a blend mode would be a per-pixel composite against a destination the processor does not address. All Layers is absent, and the tool reads only the active layer’s raster. As in Photoshop the commit is the click, with no drag gesture and no multi-region sequence.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=359',
      'https://www.underwaterphotography.com/photoshop/photoshop/1_12_8_0.html',
      'https://www.mediacollege.com/adobe/photoshop/tool/paint-bucket.html',
      'https://www.glensmith.co.uk/photoshop/paint-bucket',
      'https://www.photoshopbuzz.com/how-to-use-paint-bucket-tool/',
      'https://shotkit.com/paint-bucket-photoshop/',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
    ],
  },
  'clone-stamp': {
    photoshopName: 'Clone Stamp Tool',
    summary:
      'Copies pixels from an Alt-clicked source point and paints them under the cursor, in Aligned or Independent mode, with a soft or hard tip.',
    purpose:
      'The Clone Stamp copies pixels from one part of an image and paints them into another. Alt-click (Option-click on macOS) sets the source point; release the modifier and drag to lay the copy down. Aligned, which is the default, fixes the offset at the displacement of the first stroke after the Alt-click and holds it for every later stroke, so a pattern continues across a series of strokes; with it off, every stroke restarts from the original sampling point, which is what makes repeatedly stamping one patch of clean skin work. Sample chooses whether the source is read from the active layer alone, from the active layer and those below it, or from all visible layers, and Ignore Adjustment Layers keeps adjustment layers out of a merged sample. The tool is a copy rather than a paint, so it carries the source’s own color and alpha and needs no foreground color at all. A stroke that overlaps the area it is copying from can read back what it has just laid down, which is why the documented technique when the source is close to the target is to clone a little, release, and start again.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail:
          'A dropdown at the far left of the options bar, beside the tool icon, that applies a whole saved options-bar state, with a Create New Tool Preset icon on it. Adobe’s own current documentation places it explicitly: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar."',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus a settings gear and a grid of tips. Current Photoshop has no separate top-bar Size or Hardness for this tool — both live here and in the Brush Settings panel — so in this app the two sliders it renders directly on the bar are the app’s own addition.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the copied pixels composite with, offering the 27 layer blend modes, Dissolve among them, and neither of the two extras the painting tools add: Behind is the Brush’s alone and Clear goes to the shape tools, the Paint Bucket, the Brush, the Pencil, the Fill command and the Stroke command, so the Clone Stamp gets neither. Default Normal.',
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail: 'A label with a numeric field, 0 to 100 percent. Default 100. The strength of each stamped copy.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:110',
      },
      {
        control: 'Flow',
        detail:
          'A label with a numeric field, 0 to 100 percent. Default 100. The per-dab build-up rate, identical in meaning to the Brush tool’s, so repeated passes over one area build the copy up toward Opacity.',
        status: 'missing',
      },
      {
        control: 'Airbrush',
        detail:
          'A toggle that keeps cloning while the pointer is stationary, so a stopped stroke keeps building toward Opacity.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Opacity',
        detail: 'A toggle forcing stylus pressure to drive the opacity of each stamped copy.',
        status: 'missing',
      },
      {
        control: 'Aligned',
        detail:
          'A checkbox, on by default. On, the source and destination stay locked together and the offset is the displacement of the first stroke after the Alt-click, held until the next Alt-click. Off, every stroke restarts from the original sampling point, so the sampling position is fixed and only the destination moves.',
        status: 'partial',
        appRef: 'src/tools/cloneStamp.ts:89',
      },
      {
        control: 'Sample',
        detail:
          'A dropdown. Current Layer samples only the active layer; Current & Below samples the active layer and the visible layers beneath it; All Layers samples from all visible layers. Default Current Layer.',
        status: 'missing',
      },
      {
        control: 'Ignore Adjustment Layers',
        detail:
          'An icon immediately to the right of the Sample menu, off by default. On, it samples from all visible layers except adjustment layers, so a retouch is not baked with the color of whatever adjustment happens to sit above it.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail: 'A toggle forcing stylus pressure to drive the tip size.',
        status: 'missing',
      },
      {
        control: 'Brush Angle',
        detail:
          'A numeric field of degrees beside a small tip widget, placed after Flow. It sets the exact tip angle for the stroke and is the precise counterpart to the Angle widget inside the Brush Preset picker popout.',
        status: 'missing',
      },
      {
        control: 'Toggle the Clone Source panel',
        detail:
          'The button at the far right of the bar. Opens the Clone Source panel, which holds up to five sampling sources, each with its own flip, rotate, scale and opacity, plus a Show Overlay checkbox that draws the sampled source live under the brush.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Click, at pointer-down, to set the clone source point. The decision is made at pointer-down, so a drag that began as a plain press keeps cloning even if the modifier is released mid-stroke, and a press that began with the modifier down never starts a stroke.',
      },
    ],
    shortcuts: [
      {
        keys: 'S',
        action:
          'Selects the Clone Stamp Tool. Holding Shift while pressing it cycles the slot shared with the Pattern Stamp Tool.',
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
      'src/tools/toolsMap.ts:111',
      'src/components/Main/CloneStampToolArea.tsx:343',
      'src/components/Main/CloneStampToolArea.tsx:352',
      'src/components/Main/CloneStampToolArea.tsx:210',
      'src/tools/cloneStamp.ts:89',
      'src/tools/cloneStamp.ts:210',
      'src/contexts/useLayer.ts:334',
      'src/contexts/useLayer.ts:589',
      'src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:71',
      'src/tools/settings.ts:286',
      'src/components/Common/AppKeyboardShortcuts.tsx:383',
    ],
    appNotes:
      'The most nearly complete of the seven, and the only one whose Alt gesture is implemented. Alt-click sets the source at pointer-down and paints nothing; the source and the stroke are both rebased into the active layer’s frame, which is safe precisely because the processor only ever uses their difference. With no source set the gesture is refused outright — not-allowed cursor, no stroke, no history entry — rather than accepted and committed as a no-op that would make undo appear to do nothing. The copy is a genuine copy: a soft-edged tip and a straight-alpha source-over per texel, carrying the source texel’s own alpha so a clone out of a transparent region leaves the destination transparent rather than painting it opaque black, with every read indexed into an immutable copy of the raster and every write into the buffer, so no dab can sample a texel a previous dab laid down. That read-back is taken once per stroke and not per dab for a second reason worth naming: the live preview re-runs the processor on every pointer move but always against the store’s own pre-stroke raster, never the previous frame’s preview, and the commit re-runs it once more over the whole path before publishing. Aligned is the one control that is wired and still diverges, and the divergence is worth stating precisely because the checkbox is real and the arithmetic beneath it is not Adobe’s. Adobe fixes the offset at the displacement of the first stroke after the Alt-click and holds it for every later stroke; the app recomputes the offset from the current gesture’s own first point on every invocation, so the offset is constant within a stroke — which matches — and re-anchors at the start of each new one, which is exactly the drift the mode exists to remove. Unaligned is not the other half of Adobe’s pair either: Adobe keeps the sampling point fixed at the Alt-click and moves only the destination, while the app measures from the gesture’s current end, so the read point slides backwards as the drag progresses. Both arms are one subtraction, so this is a missing anchor rather than a wrong formula, and the fix is a stored offset on the args rather than new pixel code. Size, Hardness and Opacity are all wired and the tip is borrowed from the shared brush engine, so a soft Clone edge is the same soft edge the other paint tools stamp. Ten of the thirteen controls are absent because the args type declares no field for any of them: Tool Preset Picker, Brush Preset Picker, Mode, Flow, Airbrush, both pressure toggles, Sample, Ignore Adjustment Layers, Brush Angle and the Clone Source panel. Ignore Adjustment Layers has nothing to ignore in this app even in principle — a layer source is blank, an image, a tool or an affine transform, and Levels, Color, Transform and Blur are destructive operations on a raster rather than layers sitting above a clone target. Mode is the one that would change visible behavior: the tool is a raster commit on the active layer, so a blend mode is a composite against the layer beneath and the one primitive here takes no mode. Size is capped at 500 px rather than 5000. The layer gate refuses the Bedrock layer and requires a source, and a previous version of this record added that it did not check the layer’s lock flag, so a locked layer would still accept a cloned stroke. That is no longer true, and the guard is central rather than local: `updateLayerByTool` returns early on an `isLayerLocked` layer (`useLayer.ts:334`) and so does `tempUpdateLayer` (`useLayer.ts:535`), which is the path the live preview and the source write both go through, so neither can reach a locked layer. What remains true is the narrower, verified fact: `layer.locked` is only ever set true by importing a PSD, and no panel in this app renders a lock control or a lock icon, so there is no in-app route to setting one.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/heal-clone/retouch-images-with-the-clone-stamp-tool.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/clone-stamp-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/blending-mode-descriptions.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants',
      'https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/209',
      'https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=211',
      'https://www.properproof.com/digital/Photoshop/photoshop_cs3s_clone_tool_adds_ignore_adjustment_layers_option.html',
      'https://www.underwaterphotoshop.com/power-of-the-clone/',
      'https://jkost.com/blog/2021/12/10-tips-for-the-clone-stamp-and-healing-brush-tools-in-photoshop.html',
      'https://photoshopcafe.com/cs3/CS3.htm',
      'https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Clone_stamp_tool.html',
      'https://www.webpages.uidaho.edu/larc246/toolBarPages/cloneStamp.htm',
      'https://www.glensmith.co.uk/photoshop/clone-stamp',
      'https://enviragallery.com/guide-to-the-clone-tool-in-photoshop/',
      'https://phlearn.com/tutorial/photoshop-basics-the-clone-stamp-tool/',
      'https://www.psdvault.com/basics/photoshop-clone-stamp-tool/',
      'https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/',
      'https://graphicdesign.stackexchange.com/questions/21866/why-does-the-clone-stamp-tool-seem-to-be-misaligned',
    ],
  },
  'red-eye': {
    photoshopName: 'Red Eye Tool',
    summary: 'Reduces the red flash reflection in an eye with adjustable pupil size and darkening.',
    purpose:
      'The Red Eye tool corrects the red appearance caused when flash reflects from the retina. Click the red pupil on the active layer; Pupil Size limits the local region examined, and Darken Amount controls how strongly the red pixels are darkened. Adobe’s current help page explains the cause and prevention of red eye but does not describe the tool’s detection algorithm, slider ranges, defaults, or shortcut. The app therefore uses a bounded connected red-pixel correction as an explicit approximation, not as a claim to Photoshop’s undocumented detector.',
    options: [
      {
        control: 'Pupil Size',
        detail:
          'Sets the bounded local region examined around the click. The inventory identifies this as a Photoshop control; its exact range and default are not specified by the current Adobe help page. This app maps 0–100 to a radius proportional to the image dimensions and seeds it at 50.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/RedEye/RedEye.tsx:21',
      },
      {
        control: 'Darken Amount',
        detail:
          'Controls how strongly pixels in the detected red region are darkened after the red cast is neutralized. The current Adobe help page does not specify a range or default. This app exposes a 0–100 percent slider seeded at 50.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/RedEye/RedEye.tsx:25',
      },
    ],
    modifiers: [],
    shortcuts: [],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/redEye.ts:38',
      'src/components/Main/RedEyeToolArea.tsx:19',
      'src/tools/toolProcessors.ts:314',
      'src/tools/toolsMap.ts:115',
    ],
    appNotes:
      'The app corrects a connected region of red-dominant pixels on the active layer and records the edit as a replayable raster operation. It does not implement Photoshop’s proprietary eye/pupil detector, and this bounded threshold-based correction can miss low-red eyes or include connected red detail. The current Adobe HelpX page establishes the flash-reflection cause and prevention advice, not the tool interaction or numerical controls; the exact shortcut, ranges, defaults and detection method remain unverified. The app deliberately does not claim Photoshop fidelity for those details.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/remove-red-eye-in-flash-photos.html',
    ],
  },
};
