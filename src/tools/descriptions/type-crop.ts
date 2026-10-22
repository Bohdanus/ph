import type { ToolDescription } from './types.ts';

export const typeCropDescriptions: Record<'text' | 'crop', ToolDescription> = {
  text: {
    photoshopName: 'Horizontal Type Tool',
    summary:
      'Sets a typed string into the document as a raster text layer, with font, size, leading, tracking and caps controls.',
    purpose:
      "Photoshop's Type tools create live, vector-based type: glyph outlines re-rendered from the font, so a type layer stays resolution-independent and editable until you deliberately rasterize it. Clicking places point type, whose lines are independent and never wrap; dragging a bounding box places paragraph type, whose lines wrap and reflow as you resize the box. Type can also flow along an open or closed work path, or fill the inside of a closed shape. Paragraph settings — alignment, justification, indents and hyphenation — apply to paragraph type only, because with point type each line is its own paragraph. The anti-aliasing pull-down — None, Sharp, Crisp, Strong and Smooth, Sharp by default — is no longer on the type options bar. The five presets themselves are unchanged and are reached from the Character panel, the layer's properties and the Type menu instead; Adobe's own help still lists the type options bar among the four places characters can be formatted, without naming anti-aliasing there. When the pull-down came off the bar is community-reported only — an Adobe Community report of August 2025 puts it at Photoshop 26.10 — and is not asserted here.",
    options: [
      {
        control: 'Tool Preset picker',
        detail:
          'The drop-down at the upper-left of the bar, beside the tool icon, that recalls a saved configuration of the whole bar. Adobe: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar." A type preset can carry the font, the size, the colour and the anti-aliasing choice together.',
        status: 'missing',
      },
      {
        control: 'Text Orientation',
        detail:
          'The button in the bar that switches new type between horizontal and vertical; Adobe names it exactly — "Select a type tool, and click the Text Orientation button in the options bar." Layer > Type > Horizontal/Vertical and Change Text Orientation in the Character panel menu do the same to an existing layer, and the change flips the whole layer regardless of what is selected.',
        status: 'missing',
      },
      {
        control: 'Font family',
        detail:
          'A combo box showing every font available to Photoshop in a WYSIWYG list, each entry rendered in its own face so the list previews the fonts.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:293',
      },
      {
        control: 'Font Style',
        detail:
          "A combo box over the styles the chosen family actually has — Regular, Italic, Bold, Bold Italic and family-specific variants — whose values are the family's own PostScript names. Faux Bold and Faux Italic are separate boolean settings in the Character panel, off by default, synthesized when the family lacks a real weight or slant.",
        status: 'missing',
      },
      {
        control: 'Size',
        detail:
          'The type size, entered in points by default and accepting a unit suffix. `TypeUnits` is `MILLIMETERS / PIXELS / POINTS`.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:316',
      },
      {
        control: 'Text color',
        detail:
          'A color swatch that opens the Color Picker and sets the type fill, also reachable by Alt+Backspace for the foreground color and Ctrl+Backspace for the background color. Selecting characters rather than the layer limits the change to those characters.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:398',
      },
      {
        control: 'Align Text Left / Center Text / Align Text Right',
        detail:
          'A row of three buttons that set paragraph alignment, defaulting to Align Text Left. Justify Last Left, Justify Last Centered, Justify Last Right and Justify All live in the Paragraph panel.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:410',
      },
      {
        control: 'Toggle the type on a path',
        detail:
          'A T on a baseline that appears once a work path is selected, moving the type layer onto that path so its characters follow the path as a baseline.',
        status: 'missing',
      },
      {
        control: 'Create Work Path',
        detail:
          "Turns the type layer's glyph outlines into a work path in the Paths panel, from which the text can be selected, filled, stroked, or used as a container for more type.",
        status: 'missing',
      },
      {
        control: 'Warp Text',
        detail:
          'A T over a curved line that opens the Warp Text dialog: a Style list (None, Arc, Arc Lower, Arc Upper, Arch, Bulge, Chevron, Flag, Fish, Future, Inflate, Slant, Spiral, Styles, Twist and Wave), a Horizontal/Vertical orientation, and Bend plus Horizontal Distortion and Vertical Distortion sliders. Choosing None in the dialog unwraps the layer, and warped text stays editable as type.',
        status: 'missing',
      },
      {
        control: 'Toggle the Character and Paragraph panels',
        detail:
          'The last of the bar’s settings controls, which brings the Character and Paragraph panels to the front of the panel group so the settings that are not on the bar can be reached. It is not the last button on the bar: the Cancel and Commit pair sits to its right, and that pair is the part of the bar that appears only in edit mode.',
        status: 'missing',
      },
      {
        control: 'Commit / Cancel',
        detail:
          'The check mark and the cancel cross, which appear only while a type layer is in edit mode — Adobe\'s own test for edit mode is that they are there: "look in the options bar — if you see the Commit button and the Cancel button, the type tool is in edit mode." Commit also fires on the numeric keypad\'s Enter and on Ctrl+Enter (Windows) or Command+Return (Mac OS). Esc commits by default, and the Use Esc key to commit text preference that flips it to cancel moved from Edit > Preferences > Type to Settings > Type in 23.0.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:521',
      },
    ],
    modifiers: [],
    shortcuts: [
      { keys: 'T', action: 'Select the Type tool.' },
      {
        keys: 'Shift+T',
        action:
          'Re-selects the same tool rather than cycling a flyout. Adobe groups four tools on `T` — Horizontal Type, Vertical Type, Horizontal Type Mask and Vertical Type Mask — and this tile holds one entry, so two of the four are unreachable and the other two are one keypress away on a different tile that does not exist.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/text.ts:14',
      'src/tools/text.ts:23',
      'src/tools/text.ts:34',
      'src/tools/text.ts:75',
      'src/tools/text.ts:179',
      'src/tools/text.ts:207',
      'src/tools/text.ts:248',
      'src/tools/text.ts:310',
      'src/tools/text.ts:441',
      'src/tools/text.ts:485',
      'src/tools/text.ts:508',
      'src/tools/text.ts:590',
      'src/tools/text.ts:617',
      'src/tools/toolProcessors.ts:171',
      'src/components/ToolbarsRight/Text/Text.tsx:92',
      'src/components/ToolbarsRight/Text/Text.tsx:154',
      'src/components/ToolbarsRight/Text/Text.tsx:199',
      'src/components/ToolbarsRight/Text/Text.tsx:274',
      'src/components/ToolbarsRight/Text/Text.tsx:296',
      'src/components/Main/TextToolArea.tsx:24',
      'src/components/Main/TextToolArea.tsx:37',
      'src/contexts/useLayer.ts:447',
      'src/contexts/layer-renderer.ts:54',
      'src/contexts/layer-renderer.ts:62',
      'src/contexts/materialization.ts:136',
      'src/util/rect.ts:116',
      'src/util/settings.ts:31',
      'src/tools/settings.ts:85',
      'src/tools/text.ts:1077',
      'toolbar-mapping.ts:127',
    ],
    appNotes:
      "The app's type layer is baked pixels, not live type. renderText paints the string into a 2D context with fillText, and the text creator hands back a single OffscreenCanvas, so what reaches the Layers panel is a bitmap. On the runtime path the layer renderer re-runs a tool's creator only for the six shape tools and text is not among them, so the visible canvas, undo replay and the PSD writer all draw `layer.bitmap` and enlarging a text layer rescales those pixels where a Photoshop type layer re-renders at the new size. The durable path is the exception and the runtime claim is not the whole truth: the durable materializer re-runs the text creator from the retained args, so the characters survive in one of the two engines and are re-derivable there. There are now two kinds of type layer, `kind: 'point' | 'paragraph'`, and the gesture that placed the draft picks one: a press whose pointer travelled no more than 3 CSS px on either axis places point type, anything further places paragraph type. Adobe distinguishes the two by intent — click the canvas and start typing for point text, drag out a box and type inside it for paragraph text — and documents no threshold, no minimum box size and nothing about which way a box grows, so all three are this app's own, as is measuring the travel on both axes rather than one. The threshold is applied by the Text tool, and NOT by `useRect`, which has no movement check of its own because it is also the crop's, the move's and every selection tool's. It is measured on the POINTER's travel in client px, which is the unit the threshold is defined in: the rect `useRect` hands back is document px, already divided by the contain fit, so reading the threshold off its extent put it in the wrong units — 3 document px is 2.92 screen px on an 800x600 document and 0.58 on a 4000x3000 one. `useRect` additionally exposes which element the press hit, so a press inside an existing draft or on one of its handles is a move or a resize and cannot change what kind of box the draft is; before that, any press on a draft larger than the threshold silently reclassified it, because a box holding text is always wider than 3px. A paragraph box has real authority over its text: its width is the width the user dragged, clamped to the document before anything is measured, the lines wrap inside that width greedily at spaces, and only the height is derived from the content — `calculateNewRect` grows a paragraph box downward and never grows or re-places its width, while a point box still grows to the widest line and is still re-placed by the alignment arm. Breaking happens at spaces only, and a word too wide for the box overflows rather than being broken or hyphenated, which is this app's reconstruction of Adobe's off-by-default hyphenation and not a documented behaviour. A newline is a hard break in both kinds. The draft overlay draws Adobe's overflow indicator while the text outgrows the box — \"a small box or circle containing a plus symbol (+) appears in place of a handle in the corner of the boundary\" — and its 8 px size, its bottom-right corner and its colour are this app's; it is box chrome rather than ink, so the creator never draws it and a committed layer carries no icon. `kind` is deliberately kept out of the persisted settings, so a remembered paragraph cannot wrap the next draft inside the last layer's box before the user has dragged anything, and a settings record written before the field existed resolves to point type — the only thing this app could draw before this revision. Text is still typed into a textarea in the right-hand panel rather than onto the canvas, so there is no caret, no insertion point, no text selection and no per-character formatting; the draft is committed by Apply or implicitly by switching tools, and the commit creates a raster layer. The colour row is the one this file used to get backwards. There IS a colour control — a native colour input, `Text.tsx`'s `#text-color`, that writes through to the args and from there into renderText — and it is the tool's own setting: the bar no longer mirrors the global foreground swatch into the args on every render, which is what the earlier text claimed. What the app still lacks is Photoshop's Color Picker rather than the platform's, the Alt+Backspace and Ctrl+Backspace foreground/background bindings (the keyboard table registers two `alt: true` bindings, for the sponge tool's two mode steps, so the binding mechanism is not the obstacle — the type tool has no alt-bearing action to bind), per-character scoping, and Photoshop's default of seeding the type colour from the foreground swatch — the app's seed is a fixed black. Font size is now a number field over Adobe's `CharacterStyle.size` range of 0.01-1296, clamped on entry rather than only marked invalid, and it accepts NO unit suffix at all — the value goes straight into `Number()` and into a px shorthand, where Adobe's six-unit field is not reproduced. The unit is CSS px rather than points because the canvas carries no document resolution, so a point has no denominator here. Its `step` is `any`: a `min` of 0.01 carrying an integer step would put the landable values on a 0.01, 1.01, 2.01 grid, which leaves the seeded 64 off-grid on first paint and Adobe's own 1296 unreachable by the spinner. The font list is still fourteen hard-coded families rather than the system enumeration, and there is no Font Style combo box at all — the Bold and Italic buttons are booleans, not a list of the family's own styles, so a family-specific weight like Semibold or Condensed is unreachable and the two toggles cannot express a faux style the way Photoshop synthesizes one for a family that lacks a weight. Leading is still a unitless multiplier of the font size rather than an absolute baseline-to-baseline distance, but its default is now 1.2, which is Adobe's auto-leading figure — `JustificationProperties.autoLeadingAmount` defaults to 120, the percentage of type size used for auto leading — so the number matches Photoshop's default and the semantics behind it do not. Tracking arrived as a slider over -1000..1000 in 1/1000 em, applied as `ctx.letterSpacing` where the platform has it and as a hand-placed per-grapheme advance where it does not, and that fallback drops kerning and ligatures across the cluster boundaries it measures. All Caps and Small Caps arrived through `ctx.fontVariantCaps`, assigned after `ctx.font` because assigning the font resets it, and the small-caps value synthesises where the family has no real small caps, which is Adobe's own documented rule. Underline and Strikethrough arrived as two more booleans drawn in the type colour, which is the whole of what Adobe documents about them: its `Underline` enum is `NONE / LEFTINVERTICAL / RIGHTINVERTICAL` with no style, weight, offset or colour of its own, and the Underline Options dialog is InDesign's. Two figures in that pair are this app's own and not Adobe's: the rule sits 0.1em below the baseline, which no Adobe page states, and its thickness is `max(1, round(fontSize / 16))`, which Adobe does not document at all. Rendering moved to `textBaseline = 'alphabetic'` with the baseline placed from the measured `fontBoundingBoxAscent`, because `'top'` is a font-dependent offset that matches no exposed metric. Font size is the unit that diverges, not the range. T is the only type key, and only while the textarea does not hold focus — the canvas tool area focuses it as soon as the tool is selected, and a shortcut that does not opt into inputs is refused while a field is focused, so a T pressed mid-edit types a letter rather than reselecting the tool. The type tile holds a single entry, so Shift+T re-selects the same tool instead of cycling a flyout — and that one entry stands in for a four-tool group.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/creating-type.html',
      'https://helpx.adobe.com/photoshop/desktop/text-typography/get-started-with-text/setup-paragraph-formatting.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/add-text-to-image.html',
      'https://helpx.adobe.com/photoshop/using/editing-text.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html',
      'https://helpx.adobe.com/photoshop/using/formatting-characters.html',
      'https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html',
      'https://helpx.adobe.com/photoshop/using/line-character-spacing.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
      'https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html',
      'https://edex.adobe.com/teaching-resources/photoshop-type-mask-tool',
      'https://helpx.adobe.com/photoshop/using/layers.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle',
      'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/objects/options/justificationproperties/',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants',
      'https://www.adobe.com/learn/photoshop/web/rasterize-type-shape-layer',
      'https://www.adobe.com/products/photoshop/rasterize.html',
      'https://www.adobe.com/products/photoshop/how-to-use.html',
      'https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044',
      'https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html',
      'http://www.underwaterphotography.com/photoshop/photoshop/1_16_3_4.html',
      'http://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Character_palette.html',
      'https://www.dummies.com/article/technology/software/adobe-products/photoshop/text-options-for-photoshop-cc-163691',
    ],
  },
  crop: {
    photoshopName: 'Crop Tool',
    summary:
      'Frames a new boundary for the photo; nothing is committed until you confirm, and Esc restores the old framing.',
    purpose:
      'A crop sets a new boundary for the document. Selecting the Crop tool shows a crop box you can drag out and resize by its handles; dragging just outside a corner rotates the image inside the box, which is Adobe\'s own sentence — "Place the pointer a little outside the corner handles and drag to rotate the image. A grid displays inside the crop box and the image rotates behind it" — while dragging inside the box moves the image and leaves the box where it is. Adobe\'s newer crop page says the opposite on both counts ("hover outside a corner to rotate the crop box … To move the crop box, drag it from inside"), and the two Adobe pages cannot both describe the shipping tool; the behaviour asserted here is the one two Adobe pages and the third-party literature agree on. Nothing is committed until you confirm with Enter (Windows), Return (Mac OS), the Done button or a double-click inside the box, and Esc cancels and restores the framing you had before. Photoshop treats the crop as non-destructive until that commit, and it is only irreversible once the commit happens with Delete Cropped Pixels on. This describes Photoshop 2024-2026, where Straight Crop is the tool\'s default mode and Perspective Crop is a separate tool in the same flyout rather than a mode of this one.',
    options: [
      {
        control: 'Tool Preset picker',
        detail:
          'The drop-down at the upper-left of the bar, beside the tool icon, that recalls a saved configuration of the whole bar. Adobe: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar." A crop preset can carry a ratio, or a width, height and resolution.',
        status: 'missing',
      },
      {
        control: 'Aspect ratio menu',
        detail:
          'Holding Ratio, W x H x Resolution, Original Ratio, 1 : 1 (Square), 4 : 5 (8 : 10), 5 : 7, 2 : 3 (4 : 6), 16 : 9 and Front Image, plus New Crop Preset… to save the current values and Delete Crop Preset to remove a saved one. Adobe names the first entry Ratio, not "Free", and defines it as cropping freely without a fixed ratio; Adobe\'s own reference is explicit about what unconstrained actually means — "Clicking the Clear button clears the values in the Width and Height fields in the option bar. If displayed, the value in the Resolution field is also cleared."',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:71',
      },
      {
        control: 'Swap Width and Height values',
        detail:
          'The double-arrow button beside the Width and Height fields, which swaps them and so changes the crop orientation without changing its size. Adobe\'s own reference: "Clicking the double-arrow icon changes the crop orientation by swapping the Width and Height values. This replaces the Rotate Crop Box button." The older `Rotate Crop Box` button it replaced is gone, and the `X` key does the same swap.',
        status: 'missing',
      },
      {
        control: 'Clear',
        detail:
          'The button beside the Width and Height fields that removes the constraints applied to the current crop preset, which is how the tool is returned to unconstrained — Adobe’s own answer to its "how do I crop freely" question: "press ‘clear’ to remove any constraints applied to your crop preset", and Adobe’s reference adds the mechanism, that it clears the values in the Width, Height and Resolution fields. The app has a button labelled Clear in the same panel, but it drops the draft crop rect rather than clearing a preset’s constraints.',
        status: 'missing',
      },
      {
        control: 'Overlay',
        detail:
          'Chooses the composition guide drawn inside the crop box. Rule of Thirds is the default; the full set is Rule of Thirds, Grid, Diagonal, Triangle, Golden Ratio and Golden Spiral, O cycles through them and Shift+O flips the orientation of the asymmetric ones.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:94',
      },
      {
        control: 'Straighten',
        detail:
          'A control-bar button that arms the Straighten tool, so that the reference line you drag across the photo rotates the image inside the box to match it. Adobe names it as the alternative to dragging outside a corner: "Click Straighten in the control bar and then using the Straighten tool, draw a reference line to straighten the photo." Straighten is the only crop-variant control on the current bar: no Adobe page and no third party gives the crop a Curve, a Default or a Content-Aware control, Content-Aware being a value inside the Fill dropdown rather than a bar item, and the adjustable corner form being the separate Perspective Crop tool.',
        status: 'missing',
      },
      {
        control: 'Grid',
        detail:
          'Draws a uniform grid of a chosen number of divisions inside the crop box, for aligning to a subject rather than to a composition rule.',
        status: 'missing',
      },
      {
        control: 'Settings (gear) menu',
        detail:
          'The gear that opens the crop’s own settings fly-out: "Click the Settings (gear) menu to specify additional crop options." It is a container rather than a setting of its own, and the five rows below — Delete Cropped Pixels, Use Classic Mode, Auto Center Preview, Show Cropped Area and Enable Crop Shield — are what lives inside it.',
        status: 'missing',
      },
      {
        control: 'Delete Cropped Pixels',
        detail:
          'Decides whether pixels outside the crop boundary are permanently removed or retained as hidden layer data. Adobe says the option permanently removes outside areas, but allows editing when turned off; its current non-destructive editing guidance documents recovery with Image > Reveal All or by dragging the Crop tool beyond the image edge. Adobe says the unchecked option is unavailable for documents containing only a Background layer. The on-by-default state, Background-layer demotion, and file growth remain third-party observations.',
        status: 'missing',
      },
      {
        control: 'Use Classic Mode',
        detail:
          'Adobe’s whole sentence for it: "Enable this option if you want to use the Crop tool like it was in previous versions of Photoshop (CS5 and earlier)." What that legacy behavior is — the crop box moving while the image stays put, against the modern mode where the image moves behind a stationary box — is a third-party description, not Adobe text, and so is the Creative Cloud 2019 boundary an earlier version of this row asserted; the CS5 boundary is Adobe’s.',
        status: 'missing',
      },
      {
        control: 'Auto Center Preview',
        detail:
          'Keeps the crop box centered in the document while the crop area is being adjusted, which is what makes the image shift rather than the box.',
        status: 'missing',
      },
      {
        control: 'Show Cropped Area',
        detail:
          "Displays the area outside the pending crop boundary as a shaded preview, which is Adobe's own wording. The overlay is visual; it does not mean the pixels are deleted. Whether outside pixels are retained or permanently removed depends on Delete Cropped Pixels. Enable Crop Shield shades the same boundary with a customizable color and opacity.",
        status: 'partial',
        appRef: 'src/hooks/useRect.ts:635',
      },
      {
        control: 'Enable Crop Shield',
        detail:
          'Applies a customizable color and opacity overlay outside the pending crop boundary. It is a visual shield, not pixel deletion: Delete Cropped Pixels controls whether those pixels are retained or removed. Adobe documents the color and opacity controls; no automatic lightening is asserted because it was not verified in a primary source.',
        status: 'partial',
        appRef: 'src/hooks/useRect.ts:635',
      },
      {
        control: 'Fill',
        detail:
          'Chooses how Photoshop fills newly exposed pixels when a crop extends beyond the image. Adobe names Content-Aware Fill and says it can expand the canvas beyond the original image size; its full dropdown value list is not published. Content-Aware Fill and Generative Expand synthesize new pixels rather than reveal retained layer data. This app has no Fill control: applying a frame-only crop reveals existing off-frame layer pixels and leaves only areas with no source pixels transparent.',
        status: 'missing',
      },
      {
        control: 'Done / Cancel',
        detail:
          'The pair on the options bar, above the canvas rather than below the crop box. Done commits the crop, which is also Enter (Windows) or Return (Mac OS) and a double-click inside the box; Cancel discards it, which is also Esc.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:79',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          "Two different things, both Adobe's. Dragging a fresh box with it held constrains that box to a square; dragging a corner handle with it held constrains the proportions the box already has.",
      },
      {
        keys: 'Alt',
        action: 'Draws the crop box outward from its center, so the opposite edge moves as well.',
      },
      { keys: 'Alt+Shift', action: 'Constrains the proportions and draws from the center at the same time.' },
      {
        keys: 'Ctrl / ⌘',
        action:
          "Two more of Adobe's: held on its own it invokes the Straighten tool without visiting the bar, and held during a drag it temporarily disables snapping to the crop box edge.",
      },
      {
        keys: 'Shift while rotating',
        action: 'Restricts the rotation to 15-degree increments.',
      },
      {
        keys: 'Ctrl while rotating',
        action: 'Prevents the crop box from shrinking as it rotates.',
      },
    ],
    shortcuts: [
      { keys: 'C', action: 'Select the Crop tool.' },
      {
        keys: 'Shift+C',
        action:
          'Re-selects the same tool rather than cycling a flyout. Adobe groups four tools on `C` — Perspective Crop, Slice and Slice Select beside the Straight Crop this record describes — and this tile holds one entry, so the other three are unreachable.',
      },
      { keys: 'Enter / Return', action: 'Commits the pending crop, the same as the Done button.' },
      { keys: 'Esc', action: 'Cancels the pending crop and restores the previous framing.' },
      { keys: 'X', action: 'Switches the crop box orientation between portrait and landscape. Unbound in the app.' },
      {
        keys: 'O',
        action:
          'Cycles the six crop overlay options while the Crop tool is active; the tool-scoped handler takes precedence over the global tonal-tool binding.',
      },
      {
        keys: 'Shift+O',
        action:
          'Flips the orientation of the Triangle and Golden Spiral overlays while the Crop tool is active; other overlays ignore this key.',
      },
      { keys: 'Backspace / Delete', action: 'Resets the crop box. Unbound in the app for this tool.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/crop.ts:48',
      'src/tools/toolProcessors.ts:190',
      'src/components/ToolbarsRight/Crop/Crop.tsx:1',
      'src/components/Main/CropToolArea.tsx:80',
      'src/components/Main/CropToolArea.tsx:113',
      'src/components/Main/CropToolArea.tsx:154',
      'src/components/Main/CropToolArea.tsx:241',
      'src/hooks/useRect.ts:635',
      'src/util/rect.ts:134',
      'src/contexts/useLayer.ts:1445',
      'src/contexts/document-frame.ts:52',
      'src/contexts/layer-renderer.ts:212',
      'src/contexts/layer-utils.ts:17',
      'src/contexts/history-replay.ts:101',
      'src/contexts/history-adapter.ts:1004',
      'src/contexts/presentation-evaluator.ts:304',
      'src/tools/settings.ts:101',
      'e2e/crop-history.spec.ts:1108',
      'e2e/crop-history.spec.ts:1155',
    ],
    appNotes:
      "The app's crop edits the document frame rather than a tool layer, and it is not a raster commit at all. The crop's processor is declared with `commit: 'document-operation'`, and that commit kind is refused by every layer path — painting on it, replaying it into a layer and converting it to a durable layer all bail out — so the raster trim in src/tools/crop.ts is declared and unreachable: what actually commits is applyDocumentCrop, which takes the rect unclamped, converts it into the next documentFrame and dispatches a COMMIT_DOCUMENT_EDIT carrying a SET_DOCUMENT_FRAME_ACTION history entry with the previous frame. The frame changes at once — smaller or larger, depending on the rect — and everything outside the new frame stops rendering, while layer positions and sources are untouched, so the discarded pixels are still held in the layer bitmaps and undo puts the frame back. That is Photoshop's Delete Cropped Pixels OFF case — the canvas shrinks, the pixels are kept — not the ON case, which permanently removes them. What the app genuinely lacks is the setting itself, which it can neither offer nor invert, and the Image > Reveal All menu item, which does not exist anywhere in the app. The rect may be dragged past the image edge, and the commit follows it there: applyDocumentCrop normalises the rect with sortRoundRect, which sorts and rounds each edge once without the clamp trimRect applies, so a rect reaching past an edge commits a larger documentFrame and a rect reaching before the origin anchors the frame negatively. The commit dispatches no fill of any kind and touches no layer, so the band the growth adds is covered by no layer and stays transparent whatever the bottom layer is — that is OVR-1 in docs/OVERRIDES.md, recorded by hand, and it is the decision for Photoshop's Background-layer case rather than an omission of the fill. Nothing else in the stack caps a frame: the one limit is in applyDocumentCrop itself, which refuses anything past the 4096px per side or the 16777216px area — that is, anything outside a 4096 x 4096 box, with the per-side arm subsuming the area arm because 4096 x 4096 IS the area ceiling. The reason is not the largest canvas a browser can allocate; it is iOS Safari's ceiling and its failure mode. Safari's maximum canvas AREA is 16777216 and it fails there SILENTLY: getContext('2d') still hands back a context and every draw becomes a no-op, so an over-area document renders blank with no exception to catch, and this app ships mobile surfaces. 2^24 is also the lowest of the ceilings the browsers it targets impose, which is what makes it the one value that is correct everywhere at once. The per-side figure is derived from that area ceiling rather than from any browser constant, because an area ceiling bounds how many PIXELS a surface holds and says nothing about its longest edge, and a crop rect can be dragged arbitrarily far past an edge at low zoom. Photoshop's two synthesising values, Content-Aware Fill and Generative Expand, are absent from the app for reasons that are not about the crop, and the crop's bar renders no Fill control at all. Dragging inside the crop box translates the rect rather than picking up the layer under the pointer, because CropToolArea never passes one and so the branch that would move the image never runs; whether that is a divergence is not settled, because Adobe's current crop page says an inside drag moves the box. The pending rect is not written through to the persisted settings — the crop arm of the settings saver omits the rect and the pre-ratio rect before persisting — so the aspect ratio survives a tool switch and the draft does not, and switching away from the Crop tool and back discards the draft. That is closer to Photoshop's cancel-on-Escape than to its commit-on-switch. On modifiers, the fresh-drag half of the Shift, Alt and Alt+Shift rows above is implemented: CropToolArea passes `constrainToSquare` and `fromCentre`, the same pair RectangularSelectionToolArea passes, `sampleFreshDragModifiers` reads `shiftKey` and `altKey` per pointer event rather than once at press time, and `adjustFreshPoint` takes the square on the RADIUS per axis before mirroring the drag, so Alt+Shift is a square centred on the press point rather than one that has drifted off it. Shift outranks the bar's Ratio while it is held, and a fresh drag with neither key still obeys that Ratio. Command and Control are deliberately NOT the aspect modifier on a fresh drag: `getEdgeAtPoint` captures a box's own ratio only for a press that landed ON that box, so neither key reaches the geometry of a new box at all, which is Adobe's arrangement — Command is the crop's Straighten and edge-snap key and constrains no marquee's proportions. Two residues are left. The capture on a HANDLE resize still honours Control and Command as well as Shift, where Adobe gives them no proportion lock; it is the hook's one shared answer to that row and the Move tool, the text tool and the marquees all read it. And Alt on a handle RESIZE does not resize from the centre, so the Alt row is implemented for a new box and not for an existing one. The Ctrl, Shift-rotate and Ctrl-rotate rows remain aspirational. Enter and Esc are the exception to that pattern: CropToolArea installs its own window keydown listener rather than a table entry, so Enter commits and Esc cancels for real, and neither is reachable from the shared keyboard table. X is unbound. O and Shift+O are scoped to CropToolArea while this tool is active: O cycles the six overlay choices, and Shift+O flips Triangle and Golden Spiral orientation; outside Crop, the global tonal-tool bindings remain unchanged. The crop tile holds a single entry, so Shift+C re-selects the Crop tool rather than cycling a flyout, and Perspective Crop, Slice and Slice Select are not in the tool registry at all.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html',
      'https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/resize-adjust-resolution/crop-tool-effects-on-image-dimensions.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/apply-content-aware-fill-while-cropping-images.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/boost-workflows-with-the-contextual-task-bar.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/crop-tool.html',
      'https://helpx.adobe.com/photoshop/using/crop-straighten-photos.html',
      'https://help.adobe.com/archive/en/photoshop/cs6/photoshop_reference.pdf',
      'https://helpx.adobe.com/photoshop-elements/using/cropping.html',
      'https://helpx.adobe.com/in/photoshop/using/new-shortcuts-cs6.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/content-aware-crop-fill.html',
      'https://www.adobe.com/products/photoshop/crop-image.html',
      'https://www.adobe.com/products/photoshop/generative-fill.html',
      'https://shotkit.com/extend-background-photoshop-generative-fill',
      'https://www.photoshopessentials.com/basics/photoshop-crop-tool-tips-and-tricks',
      'https://creativepro.com/essential-tips-for-cropping-images-photoshop',
      'https://design.tutsplus.com/tutorials/10-things-you-should-know-about-the-crop-tool--psd-34592',
    ],
  },
};

// This concise publication summary supersedes the older appNotes literal above; detailed Adobe
// provenance and unresolved claims live in type-crop.notes.md.
typeCropDescriptions.crop.appNotes = [
  'The app commits crop as a SET_DOCUMENT_FRAME_ACTION, changing documentFrame rather than trimming layer bitmaps.',
  'At angle zero, layer source coordinates are unchanged: after a frame crop, re-entering Crop seeds the current bounds, extending them previews retained off-frame layer pixels, and Apply reveals those pixels without resampling.',
  'The live preview clears the current frame to avoid double-compositing translucent layers and budgets at most 4,194,304 backing pixels per frame-sized surface; very large previews may be lower resolution.',
  'Rotated crops apply a layer transform. Because overhang geometry is axis-aligned, retained-pixel preview and letterbox guides are suppressed at nonzero rotation; rotated recrops reveal retained content on commit.',
  'OVR-1 applies only to newly exposed areas with no retained source pixels; it does not block recovery. Adobe documents Delete Cropped Pixels off, Reveal All/drag recovery, a Background-only limitation, and separate Content-Aware and Generative synthesis features.',
  'The app still lacks the Delete Cropped Pixels toggle, Image > Reveal All, Fill, and Generative Expand. Retention across save/reopen or flattened export is unverified.',
].join(' ');
