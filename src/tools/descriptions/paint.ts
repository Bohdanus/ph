import type { ToolDescription } from './types.ts';

export const paintDescriptions: Record<
  'brush' | 'pencil' | 'color-replacement' | 'eraser' | 'magic-eraser' | 'paint-bucket' | 'clone-stamp',
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
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and the chevron beside it. Clicking it opens a popout from which the tip’s Size and Hardness can be changed temporarily, plus an Angle/Roundness drag widget, a settings gear, a New Preset button and a grid of tip thumbnails. There is no separate top-bar Hardness control in current Photoshop; Hardness lives here and in the Brush Settings panel. Photoshop has no Tool Preset Picker on this bar any more — that dropdown was folded into the Brush Settings and Presets interfaces — so the settings-snapshot picker this app renders in the same position is its own addition rather than a stand-in for a control Photoshop still shows.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:123',
      },
      {
        control: 'Size',
        detail: 'The tip diameter in pixels, 1 to 5000.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:105',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the stroke composites with, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:117',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. A hard ceiling for one stroke, not a per-dab rate.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:109',
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
        control: 'Always Use Pressure for Opacity',
        detail:
          'A toggle that forces stylus pressure to drive opacity regardless of the numeric field and of the tip’s own Transfer settings.',
        status: 'missing',
      },
      {
        control: 'Always Use Pressure for Size',
        detail:
          'A toggle that forces stylus pressure to drive tip size regardless of the tip’s Shape Dynamics. On by default for the Hard Round class of presets and off for most others.',
        status: 'missing',
      },
      {
        control: 'Smoothing',
        detail:
          'A numeric field, 0 to 100 percent, beside a gear. Default 10. The amount of stroke smoothing, and the only control on the bar the Pencil and the Eraser share with the Brush. The gear beside it opens Smoothing Options.',
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
        control: 'Symmetry',
        detail:
          'A butterfly button. Offers Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial (2 to 12 segments) and Mandala (3 to 10 segments), so every dab is mirrored live. Present for the Brush, the Pencil and the Eraser only.',
        status: 'missing',
      },
      {
        control: 'Toggle the Brush Settings panel',
        detail:
          'The button at the far right of the bar. Opens the Brush Settings panel, where Brush Tip Shape, Shape Dynamics, Scattering, Texture, Dual Brush, Color Dynamics, Transfer, Brush Pose, Noise, Wet Edges, Airbrush, Smoothing and Protect Texture live.',
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
      'src/tools/toolProcessors.ts:255',
      'src/components/ToolbarsRight/Paint/Paint.tsx:136',
      'src/components/Main/DrawToolArea.tsx:143',
      'src/tools/brush.ts:101',
      'src/contexts/layer-utils.ts:146',
      'src/tools/settings.ts:125',
      'src/components/Common/AppKeyboardShortcuts.tsx:240',
    ],
    appNotes:
      'A real painting tool, and the closest of the seven: a drag paints the foreground colour, one mouse-up is one history state, and Opacity behaves as Photoshop’s per-stroke ceiling because the stroke is a single alpha-weighted pass over the whole path. The divergences are structural. There is no Flow and therefore no within-stroke build-up; there is no tip, so no Hardness, Spacing, angle, roundness, shape dynamics, scattering or texture; there is no Airbrush, no stylus pressure, no symmetry and no Brush Settings panel. Mode offers sixteen canvas compositing operations rather than Photoshop’s thirty-plus, and it is applied to the layer the stroke creates rather than to the stroke’s own pixels. Size is capped at 500 px, not 5000, because a stroke is rasterized into a canvas padded by the full tip width and committed as its own layer. Smoothing is real but a different algorithm: it pulls each sampled interior point toward the midpoint of its neighbours, whereas Photoshop’s is a trailing anchor over the raw input stream, so the app has no catch-up and no pulled-string slack. The largest divergence is not in the bar at all — a brush stroke is committed by creating a NEW layer rather than by painting the active one.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://community.wacom.com/en-us/guide-to-photoshop-brushes-pt-1/',
      'https://flylib.com/books/en/4.462.1.114/1/',
      'https://asktimgrey.com/2017/03/21/pencil-brush-shape/',
      'https://web.archive.org/web/20201111235536/https:/helpx.adobe.com/photoshop/using/whats-new/2018.html',
      'https://helpx.adobe.com/photoshop/using/paint-symmetry.html',
      'https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/',
      'https://clippingpathca.com/photoshop-tool-presets/',
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
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. The Pencil offers hard-edged tips only, so its Hardness is fixed. Photoshop has no Tool Preset Picker on this bar any more — that dropdown was folded into the Brush Settings and Presets interfaces — so the settings-snapshot picker this app renders in the same position is its own addition.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:123',
      },
      {
        control: 'Size',
        detail: 'The tip diameter in pixels, 1 to 5000.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:105',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the stroke composites with, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:117',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. A hard ceiling for one stroke.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Paint/Paint.tsx:109',
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
        control: 'Symmetry',
        detail:
          'A butterfly button offering Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial and Mandala. Present for the Brush, the Pencil and the Eraser only.',
        status: 'missing',
      },
      {
        control: 'Toggle the Brush Settings panel',
        detail: 'The button at the far right of the bar, opening the Brush Settings panel.',
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
        action: 'Constrains the stroke to a straight line from the last stroke point.',
      },
    ],
    shortcuts: [{ keys: 'N', action: 'Selects the Pencil Tool.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:263',
      'src/components/ToolbarsRight/Paint/Paint.tsx:136',
      'src/components/Main/DrawToolArea.tsx:143',
      'src/tools/settings.ts:142',
      'src/components/Common/AppKeyboardShortcuts.tsx:18',
    ],
    appNotes:
      'The app renders the Pencil through the same bar factory as the Brush, with its own three synthetic presets, and its stroke is one round-capped pass of the same painter. That reproduces the hard edge, so the two agree on the one property that distinguishes them, but it is a hard edge by construction rather than by a hard tip: a round cap is aliased because the canvas rasterizes it that way, and there is no tip model that could be made soft. The Pencil’s one own feature, Auto Erase, is absent entirely — there is no background color in the app’s tool state, so the checkbox has nothing to decide between, and no component renders it. Mode offers sixteen canvas operations and is applied to the layer the stroke creates, not to the stroke’s pixels; Size is capped at 500 px rather than 5000. The Pencil has no keyboard shortcut of its own here: it is reached by cycling the Brush tile with Shift+B, where Photoshop binds it to N. As with the Brush, each stroke creates a new layer rather than painting the active one.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/auto-erase-with-the-pencil-tool.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=337',
      'https://www.oreilly.com/library/view/photoshop-elements-8/9780596809188/ch12s04.html',
      'https://www.dummies.com/article/the-new-partial-sketch-photoshop-elements-feature-259266',
      'https://asktimgrey.com/2025/08/08/pencil-versus-brush/',
      'https://asktimgrey.com/2017/03/21/pencil-brush-shape/',
      'https://flylib.com/books/en/4.462.1.114/1/',
      'https://helpx.adobe.com/photoshop/using/paint-symmetry.html',
    ],
  },
  'color-replacement': {
    photoshopName: 'Color Replacement Tool',
    summary:
      'Recolors the pixels it paints over with the foreground color while keeping their luminosity and texture, rather than covering them.',
    purpose:
      'The Color Replacement Tool substitutes one color for another in a stroke, keeping the luminosity and the texture of what was underneath — Adobe describes its default options bar as maintaining a color’s luminosity and saturation while replacing its hue. It works by painting through a Hue/Saturation/Color/Luminosity blend mode rather than compositing on top, so the foreground color should be left in Color mode. Sampling decides which color is the target — resampled continuously under the cursor, locked to the first click, or taken from the background swatch — and Limits decides how far the replacement spreads from the cursor. It is not a selection tool: there are no marching ants, and unlike the Paint Bucket it replaces color as you drag rather than flooding a whole connected region in one click.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail: 'The leftmost button on the bar, applying a whole saved options-bar state in one action.',
        status: 'missing',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips.',
        status: 'missing',
      },
      {
        control: 'Size',
        detail: 'The tip diameter in pixels, 1 to 5000.',
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
        status: 'missing',
      },
      {
        control: 'Sampling',
        detail:
          'Three small icons. Continuous (default) resamples the color under the crosshair as you drag; Once locks the color of the first click for the whole stroke; Background Swatch replaces only areas containing the current background color.',
        status: 'missing',
      },
      {
        control: 'Limits',
        detail:
          'A dropdown. Contiguous (default) replaces colors contiguous with the pixel under the pointer; Discontiguous replaces the sampled color wherever it occurs under the pointer; Find Edges replaces connected areas containing the sampled color while preserving the sharpness of shape.',
        status: 'missing',
      },
      {
        control: 'Tolerance',
        detail:
          'A slider, 0 to 255, entered as a percentage. A low value replaces only colors very similar to the pixel clicked; a higher value widens the range. Adobe does not document a default; a widely-cited third-party value is 30 percent.',
        status: 'missing',
      },
      {
        control: 'Anti-aliased',
        detail: 'A checkbox giving the deposited color anti-aliased edges. On by default.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolsMap.ts:116',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13',
      'src/tools/toolProcessors.ts:276',
      'src/tools/settings.ts:159',
      'src/tools/draw.ts:71',
      'src/components/Common/AppKeyboardShortcuts.tsx:18',
    ],
    appNotes:
      'The tool is listed, selectable, and given a processor, but its options bar is a PlaceholderTool: six disabled chips naming Brush Preset Picker, Blend Mode, Sampling, Limits, Tolerance and Anti-alias render where the real controls belong, and none of them reads or writes anything. Nothing in the tool’s state corresponds to any of them — there is no tolerance, no sampling mode, no limits mode and no anti-alias flag, and the app has no background color for Background Swatch to name. What the tool actually paints is a spray-can stroke of the foreground color with `source-over` compositing, which is the opposite of the tool’s contract: it covers texture and luminosity instead of preserving them, and it replaces nothing. Its blend Mode control is absent, and the `blendMode` field its args do carry seeds to Normal and is read only for a layer a paint tool creates, so the Color blend mode that makes this tool a replacement is unreachable. It also has no keyboard shortcut: the app reaches it only by cycling the Brush tile with Shift+B, where Photoshop binds it separately.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/215',
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
        control: 'Mode',
        detail:
          'A dropdown of Brush, Pencil and Block. Brush erases with adjustable softness and opacity; Pencil erases with hard edges; Block erases in a fixed-size square shape with no opacity control.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:56',
      },
      {
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus a settings gear and a grid of tips. Block mode uses a square and no preset.',
        status: 'missing',
      },
      {
        control: 'Size',
        detail: 'The tip diameter in pixels, 1 to 1000.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:36',
      },
      {
        control: 'Hardness',
        detail:
          'A slider, 0 to 100 percent, in the Brush and Pencil modes. Pencil mode is fixed at 100. Block mode has no hardness.',
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail:
          'A label with a numeric field, 0 to 100 percent. Default 100. 100 erases pixels completely, lower erases partially. Not available in Block mode, and Adobe removes the control there rather than greying it.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:43',
      },
      {
        control: 'Flow',
        detail:
          'A label with a numeric field, 0 to 100 percent. Default 100. How quickly the erasure is applied, so repeated passes over one area build up to the Opacity ceiling.',
        status: 'inert',
        appRef: 'src/components/ToolbarsRight/Eraser/Eraser.tsx:100',
      },
      {
        control: 'Airbrush',
        detail:
          'A toggle that keeps erasing while the pointer is stationary, so a stopped stroke keeps cutting toward Opacity. Brush mode only.',
        status: 'missing',
      },
      {
        control: 'Erase to History',
        detail:
          'A checkbox. With a state or snapshot set in the History panel, a drag paints the area back to that state instead of erasing it. Holding Alt while dragging turns this mode on temporarily.',
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
    ],
    shortcuts: [{ keys: 'E', action: 'Selects the Eraser Tool.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:121',
      'src/tools/eraser.ts:39',
      'src/tools/eraser.ts:79',
      'src/components/Main/EraserToolArea.tsx:169',
      'src/components/ToolbarsRight/Eraser/Eraser.tsx:47',
      'src/tools/settings.ts:176',
      'src/components/Common/AppKeyboardShortcuts.tsx:355',
    ],
    appNotes:
      'The Eraser edits the active layer in place by subtracting alpha, which is the right model, and it produces exactly one history state per stroke because the commit is the pointer-up. Its Mode list is Photoshop-shaped but not Photoshop-capable: the `brush` option is rendered with Adobe’s real label and is `disabled` on the DOM node, because a soft tip needs a stamped-dab engine and this renderer issues one `stroke()` per stroke, which has no falloff — so a Brush eraser would silently render as Pencil. Hardness is absent for the same reason, and the app’s Pencil and Block modes are the hard edge and the square. Size is capped at 500 px rather than 1000. Opacity is present and works as Photoshop’s per-stroke ceiling, and the control is correctly withheld in Block mode. Flow is the notable finding: the bar renders Photoshop’s real `Flow` label at Photoshop’s 1–100 range and a hardcoded 100 percent value, but the input carries `disabled` and writes nothing, because Flow is a per-dab alpha ramp and a single `stroke()` cannot honour one. Airbrush and Erase to History are absent, and so is the Alt-drag temporary Erase to History gesture.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335',
      'https://www.mediacollege.com/adobe/photoshop/tool/eraser.html',
      'https://www.underwaterphotography.com/photoshop/photoshop/1_12_3_1.html',
      'https://www.glensmith.co.uk/photoshop/eraser',
      'https://helpx.adobe.com/photoshop/using/paint-symmetry.html',
      'https://flylib.com/books/en/4.462.1.114/1/',
    ],
  },
  'magic-eraser': {
    photoshopName: 'Magic Eraser Tool',
    summary:
      'Erases every pixel similar to the one you click, to transparency, in a single click, bounded by Tolerance, Anti-alias and Contiguous.',
    purpose:
      'The Magic Eraser is the Paint Bucket run in reverse: one click erases every pixel whose color falls within Tolerance of the pixel clicked, rather than a dragged tip erasing a stroke. It works like the Magic Wand without the preview, which is its whole cost — there is no marching ants, so the region it will remove is visible only in the History panel afterwards. Tolerance sets how far a color may differ and still count, Contiguous limits the erase to the region connected to the click rather than every match in the layer, Anti-alias smooths the boundary, and Opacity sets how completely the matched pixels are cleared. On a Background layer, or one with transparency locked, the matched pixels change to the background color instead of becoming transparent.',
    options: [
      {
        control: 'Tolerance',
        detail:
          'A slider, 0 to 255. A low tolerance erases only pixels within a very narrow range of the clicked pixel; a high tolerance erases within a broader range. Default 32.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:34',
      },
      {
        control: 'Anti-aliased',
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
    shortcuts: [],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:122',
      'src/tools/fill.ts:163',
      'src/util/floodFill.ts:76',
      'src/components/Main/FillToolArea.tsx:91',
      'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:48',
      'src/tools/settings.ts:184',
    ],
    appNotes:
      'A working flood-based eraser: one click, one atomic commit, a hard 0–255 tolerance on Adobe’s scale rather than the Magic Wand’s 0–100, a default of 32 that matches Adobe’s seeded value, 4-connected Contiguous as a real 4-neighbor scan, and an Opacity that scales the alpha removed per pixel so a partial erase is a partial erase. It shares its args type with the Paint Bucket and both run the same mask code, which is why Contiguous and Tolerance are genuinely wired for both. Anti-aliased is the finding: it renders with Photoshop’s real label and Photoshop’s real checked state, but the input carries `disabled` and the flood fill’s test is a hard threshold producing a boolean mask, so there is no coverage to anti-alias. Sample All Layers is absent, and the tool is structurally active-layer-only — `FillToolArea` reads the active layer’s own raster and refuses the Bedrock layer outright, so there is no merged data to sample. As in Photoshop there is no preview of the region about to be removed, and the tool has no keyboard shortcut of its own: the app’s fill shortcut group contains the Paint Bucket and the Gradient only.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/magic-eraser-tool.html',
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
      'The Paint Bucket fills the whole connected region of similar color around the click in a single click. Tolerance decides how far a pixel’s color may differ from the clicked pixel and still be filled, Contiguous limits the fill to the region connected to the click rather than every match in the layer, Anti-alias smooths the boundary, and Fill chooses the foreground color or a pattern. Mode and Opacity composite the fill, so a fill is a real layer edit rather than a paste. It shares a Tools-panel slot with the Gradient tool. Unlike the Magic Eraser it fills rather than clears, and unlike the Color Replacement tool it floods a whole region from one click instead of recoloring as you drag.',
    options: [
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
          'The blend mode for the fill, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.',
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
          'A slider, 0 to 255. Lower values such as 10 to 20 fill only similar colors; values of 100 or more fill a broader range. Default 32.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:34',
      },
      {
        control: 'Anti-aliased',
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
      'src/tools/toolsMap.ts:123',
      'src/tools/fill.ts:129',
      'src/tools/fill.ts:151',
      'src/components/Main/FillToolArea.tsx:157',
      'src/components/ToolbarsRight/MagicEraser/PaintBucket.tsx:35',
      'src/tools/settings.ts:193',
      'src/components/Common/AppKeyboardShortcuts.tsx:314',
    ],
    appNotes:
      'One click, one atomic commit on the active layer, with the foreground color read off the live store at the moment of the click rather than mirrored into the args, and the fill composited as a real source-over so a 50 percent fill over transparent pixels is half coverage of clean red rather than half-black — that is the one place where this implementation is more correct than a naive lerp. Tolerance, Contiguous and Opacity are genuinely wired and share the fill code with the Magic Eraser. Three controls diverge. Pattern renders `disabled` under the real `Fill` label: there is no pattern registry, no tile and no processor branch that could read one, so it is present in the DOM and inert rather than absent. Anti-aliased is the shared fill bar’s `disabled` checkbox, inert for the same hard-threshold reason as the Magic Eraser’s. Mode is absent outright and cannot be added cheaply: the tool’s args type declares no blend mode, and the fill is applied to the active layer’s pixels rather than to a new layer, so a blend mode would be a per-pixel composite against a destination the processor does not address. All Layers is absent, and the tool reads only the active layer’s raster. As in Photoshop the commit is the click, with no drag gesture and no multi-region sequence.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html',
      'https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=359',
      'https://www.underwaterphotography.com/photoshop/photoshop/1_12_8_0.html',
      'https://www.mediacollege.com/adobe/photoshop/tool/paint-bucket.html',
      'https://www.glensmith.co.uk/photoshop/paint-bucket',
      'https://www.photoshopbuzz.com/how-to-use-paint-bucket-tool/',
      'https://shotkit.com/paint-bucket-photoshop/',
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
        control: 'Brush Preset Picker',
        detail:
          'The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus a settings gear and a grid of tips. Current Photoshop has no separate top-bar Size or Hardness for this tool — both live here and in the Brush Settings panel — so in this app the two sliders it renders directly on the bar are the app’s own addition. There is no Tool Preset Picker on the bar at all; that dropdown was folded into the Brush Settings and Presets interfaces.',
        status: 'missing',
      },
      {
        control: 'Mode',
        detail:
          'The blend mode the copied pixels composite with, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.',
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
    shortcuts: [{ keys: 'S', action: 'Selects the Clone Stamp Tool.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolsMap.ts:95',
      'src/components/Main/CloneStampToolArea.tsx:343',
      'src/components/Main/CloneStampToolArea.tsx:210',
      'src/tools/cloneStamp.ts:89',
      'src/tools/cloneStamp.ts:210',
      'src/contexts/useLayer.ts:557',
      'src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:118',
      'src/tools/settings.ts:250',
      'src/components/Common/AppKeyboardShortcuts.tsx:362',
    ],
    appNotes:
      'The most nearly complete of the seven, and the only one whose Alt gesture is implemented. Alt-click sets the source at pointer-down and paints nothing; the source and the stroke are both rebased into the active layer’s frame, which is safe precisely because the processor only ever uses their difference. With no source set the gesture is refused outright — not-allowed cursor, no stroke, no history entry — rather than accepted and committed as a no-op that would make undo appear to do nothing. The copy is a genuine copy: a soft-edged tip and a straight-alpha source-over per texel, carrying the source texel’s own alpha so a clone out of a transparent region leaves the destination transparent rather than painting it opaque black, with every read indexed into an immutable copy of the raster and every write into the buffer, so no dab can sample a texel a previous dab laid down. That read-back is taken once per stroke and not per dab for a second reason worth naming: the live preview re-runs the processor on every pointer move but always against the store’s own pre-stroke raster, never the previous frame’s preview, and the commit re-runs it once more over the whole path before publishing. Aligned is the one control that is wired and still diverges, and the divergence is worth stating precisely because the checkbox is real and the arithmetic beneath it is not Adobe’s. Adobe fixes the offset at the displacement of the first stroke after the Alt-click and holds it for every later stroke; the app recomputes the offset from the current gesture’s own first point on every invocation, so the offset is constant within a stroke — which matches — and re-anchors at the start of each new one, which is exactly the drift the mode exists to remove. Unaligned is not the other half of Adobe’s pair either: Adobe keeps the sampling point fixed at the Alt-click and moves only the destination, while the app measures from the gesture’s current end, so the read point slides backwards as the drag progresses. Both arms are one subtraction, so this is a missing anchor rather than a wrong formula, and the fix is a stored offset on the args rather than new pixel code. Size, Hardness and Opacity are all wired and the tip is borrowed from the shared brush engine, so a soft Clone edge is the same soft edge the other paint tools stamp. Seven of the eleven controls are absent because the args type declares no field for any of them: Mode, Flow, both pressure toggles, Sample, Ignore Adjustment Layers and the Clone Source panel. Ignore Adjustment Layers has nothing to ignore in this app even in principle — a layer source is blank, an image, a tool or an affine transform, and Levels, Color, Transform and Blur are destructive operations on a raster rather than layers sitting above a clone target. Mode is the one that would change visible behavior: the tool is a raster commit on the active layer, so a blend mode is a composite against the layer beneath and the one primitive here takes no mode. Size is capped at 500 px rather than 5000. The layer gate refuses the Bedrock layer but does not check the layer’s lock flag, so a layer the UI presents as locked will still accept a cloned stroke — and that lock round-trips to PSD as composite and position protection, which means a layer can be protected in a saved file and freely overwritten in the editor.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/heal-clone/retouch-images-with-the-clone-stamp-tool.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/clone-stamp-tool.html',
      'https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/209',
      'https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=211',
      'https://www.properproof.com/digital/Photoshop/photoshop_cs3s_clone_tool_adds_ignore_adjustment_layers_option.html',
      'https://www.underwaterphotoshop.com/power-of-the-clone/',
      'https://jkost.com/blog/2021/12/10-tips-for-the-clone-stamp-and-healing-brush-tools-in-photoshop.html',
      'https://photoshopcafe.com/cs3/CS3.htm',
      'https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Clone_stamp_tool.html',
      'https://www.webpages.uidaho.edu/larc246/toolBarPages/cloneStamp.htm',
      'https://www.glensmith.co.uk/photoshop/clone-stamp',
      'https://www.psdvault.com/basics/photoshop-clone-stamp-tool/',
      'https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/',
      'https://graphicdesign.stackexchange.com/questions/21866/why-does-the-clone-stamp-tool-seem-to-be-misaligned',
    ],
  },
};
