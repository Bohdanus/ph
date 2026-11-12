import type { ToolDescription } from './types.ts';

export const typeCropDescriptions: Record<'text' | 'crop', ToolDescription> = {
  text: {
    photoshopName: 'Horizontal Type Tool',
    summary:
      'Creates raster text layers; a 3 CSS px drag threshold distinguishes point from paragraph type. Unlike Photoshop, text is not live vector type.',
    purpose:
      "Photoshop's Type tools create live, vector-based type: glyph outlines re-rendered from the font, so a type layer stays resolution-independent and editable until deliberately rasterized. Clicking places point type (independent lines, no wrap); dragging a bounding box places paragraph type (lines wrap and reflow on resize). Type can also flow along an open or closed work path, or fill the inside of a closed shape. Paragraph settings — alignment, justification, indents and hyphenation — apply to paragraph type only. The anti-aliasing pull-down (None, Sharp, Crisp, Strong, Smooth; Sharp by default) was on the type options bar until Photoshop 26.10 (community-reported); it is now reached from the Character panel, the layer's properties, and the Type menu. This app has no live type: each committed text presentation is rasterized via `fillText` into a layer-sized OffscreenCanvas. The durable engine re-runs the creator from retained args so characters survive there; the runtime renderer uses `layer.bitmap` so scaling resamples pixels.",
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
          'A combo box showing every font available to Photoshop in a WYSIWYG list, each entry rendered in its own face so the list previews the fonts. The app renders a native `<select>` with system fonts; no WYSIWYG preview.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:307',
      },
      {
        control: 'Font Style',
        detail:
          "A combo box over the styles the chosen family actually has — Regular, Italic, Bold, Bold Italic and family-specific variants — whose values are the family's own PostScript names. Faux Bold and Faux Italic are separate boolean settings in the Character panel, off by default, synthesized when the family lacks a real weight or slant. The app has no Font Style control; it relies on the font family select alone.",
        status: 'missing',
      },
      {
        control: 'Size',
        detail:
          'The type size, entered in points by default and accepting a unit suffix. `TypeUnits` is `MILLIMETERS / PIXELS / POINTS`. The app renders a number input with a unit suffix selector (px/pt/mm).',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:330',
      },
      {
        control: 'Text color',
        detail:
          'A color swatch that opens the Color Picker and sets the type fill, also reachable by Alt+Backspace for the foreground color and Ctrl+Backspace for the background color. Selecting characters rather than the layer limits the change to those characters. The app renders a color input for the whole layer; no per-character color.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:426',
      },
      {
        control: 'Align Text Left / Center Text / Align Text Right',
        detail:
          'A row of three buttons that set paragraph alignment, defaulting to Align Text Left. Justify Last Left, Justify Last Centered, Justify Last Right and Justify All live in the Paragraph panel. The app renders all three alignment buttons; they apply to the whole layer (paragraph type only).',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:438',
      },
      {
        control: 'Toggle the type on a path',
        detail:
          'A T on a baseline that appears once a work path is selected, moving the type layer onto that path so its characters follow the path as a baseline. The app has no work paths and no path type.',
        status: 'missing',
      },
      {
        control: 'Create Work Path',
        detail:
          "Turns the type layer's glyph outlines into a work path in the Paths panel, from which the text can be selected, filled, stroked, or used as a container for more type. The app has no work paths.",
        status: 'missing',
      },
      {
        control: 'Warp Text',
        detail:
          'A T over a curved line that opens the Warp Text dialog: a Style list (None, Arc, Arc Lower, Arc Upper, Arch, Bulge, Chevron, Flag, Fish, Future, Inflate, Slant, Spiral, Styles, Twist and Wave), a Horizontal/Vertical orientation, and Bend plus Horizontal Distortion and Vertical Distortion sliders. Choosing None in the dialog unwraps the layer, and warped text stays editable as type. The app has no warp text.',
        status: 'missing',
      },
      {
        control: 'Toggle the Character and Paragraph panels',
        detail:
          "The last of the bar's settings controls, which brings the Character and Paragraph panels to the front of the panel group so the settings that are not on the bar can be reached. It is not the last button on the bar: the Cancel and Commit pair sits to its right, and that pair is the part of the bar that appears only in edit mode.",
        status: 'missing',
      },
      {
        control: 'Commit / Cancel',
        detail:
          'The check mark and the cancel cross, which appear only while a type layer is in edit mode — Adobe\'s own test for edit mode is that they are there: "look in the options bar — if you see the Commit button and the Cancel button, the type tool is in edit mode." Commit also fires on the numeric keypad\'s Enter and on Ctrl+Enter (Windows) or Command+Return (Mac OS). Esc commits by default, and the Use Esc key to commit text preference that flips it to cancel moved from Edit > Preferences > Type to Settings > Type in 23.0. The app renders Commit/Cancel buttons in edit mode; Escape commits (not cancels) by default; Enter on keypad commits; no preference to flip Escape behavior.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:554',
      },
      {
        control: 'Leading',
        detail:
          'The distance between baselines, in points. Auto leading is 120% of the type size. The app renders a leading input (number with unit).',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:350',
      },
      {
        control: 'Tracking',
        detail: 'The space between all characters in the selection, in 1/1000 em. The app renders a tracking input.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:362',
      },
      {
        control: 'All Caps',
        detail: 'A checkbox that renders all characters as capitals. The app renders this checkbox.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:378',
      },
      {
        control: 'Small Caps',
        detail:
          'A checkbox that renders lowercase letters as smaller capitals. The app renders this checkbox and previews Small Caps in the draft via a canvas overlay (`publishSmallCapsTextDraftPreview`).',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:384',
      },
      {
        control: 'Superscript / Subscript',
        detail: 'Checkboxes for superscript and subscript. The app does not render these.',
        status: 'missing',
      },
      {
        control: 'Underline / Strikethrough',
        detail:
          'Checkboxes for underline and strikethrough. The app renders both as toggle buttons in the Text options bar.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:517',
      },
      {
        control: 'Anti-aliasing',
        detail:
          'A dropdown: None, Sharp, Crisp, Strong, Smooth (Sharp default). Adobe moved this off the bar in 26.10 (community report). The app does not render it; text is rendered with the canvas default anti-aliasing.',
        status: 'missing',
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
      'src/tools/text.ts:1077',
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
      "The app's type layer is baked pixels, not live type. `renderText` paints the string into a 2D context with `fillText`, and the text creator hands back a single OffscreenCanvas, so what reaches the Layers panel is a bitmap. On the runtime path the layer renderer re-runs a tool's creator only for the six shape tools; text is not among them, so the visible canvas, undo replay and the PSD writer all draw `layer.bitmap` and enlarging a text layer rescales those pixels where a Photoshop type layer re-renders at the new size. The durable path is the exception: the durable materializer re-runs the text creator from the retained args, so the characters survive in one of the two engines and are re-derivable there. There are two kinds of type layer, `kind: 'point' | 'paragraph'`, distinguished by a 3 CSS px drag threshold (`POINT_TYPE_MAX_DRAG_PX`) on the pointer's travel in client pixels (not the box extent). A press that travels ≤3 px on both axes places point type; anything further places paragraph type. Adobe distinguishes the two by intent (click vs drag) and documents no threshold, no minimum box size, and nothing about which way a box grows — all three are this app's own. The threshold is applied by the Text tool, NOT by `useRect`. A press inside an existing draft or on its handles is a move/resize and does not reclassify the kind. A second placement while a draft is open commits the first draft (`commitDirtyTool` via `flushSync`) before placing the new one — Adobe commits on tool switch, panel click, or menu command. Placeholder text (`Lorem ipsum`) is seeded only on a fresh placement, not on a move/resize (which would overwrite user text). Paragraph boxes are forced to at least 1 px wide to avoid a zero-width throw in `createLayerSource`. Clicking an existing committed text layer hydrates its source into the tool args and opens the in-place editor (`beginTextLayerEdit`). Small Caps is previewed in the draft via a canvas overlay (`publishSmallCapsTextDraftPreview`) that renders with the same `renderText` used at commit. The overflow indicator (red `+`) is drawn in the draft when paragraph text overflows its box (`drawOverflowIndicator`). Escape commits by default (no preference to flip). No Font Style, no per-character color, no warp, no path type, no Character/Paragraph panels. The `TextOrientation` button is absent (Vertical Type and Type Mask tools are not implemented).",
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
      'https://helpx.adobe.com/photoshop/using/layers.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/characterstyle',
      'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/objects/options/justificationproperties/',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/modules/constants',
      'https://www.adobe.com/learn/photoshop/web/rasterize-type-shape-layer',
      'https://www.adobe.com/products/photoshop/rasterize.html',
      'https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044',
    ],
  },
  crop: {
    photoshopName: 'Crop Tool',
    summary:
      'Frames a document boundary; extending past the image reveals retained pixels. Enter applies; Esc cancels. No Fill, Straighten or Delete Cropped Pixels.',
    purpose:
      'A crop sets a new boundary for the document. Selecting the Crop tool shows a crop box you can drag out and resize by its handles; dragging just outside a corner rotates the image inside the box (Adobe: "Place the pointer a little outside the corner handles and drag to rotate the image. A grid displays inside the crop box and the image rotates behind it"), while dragging inside the box moves the image and leaves the box where it is. Adobe\'s newer crop page says the opposite on both counts; the behavior asserted here follows the current desktop page and third-party literature. Nothing is committed until you confirm with Enter/Return, the Done button, or a double-click inside the box, and Esc cancels and restores the framing you had before. Photoshop treats the crop as non-destructive until that commit, and it is only irreversible once the commit happens with Delete Cropped Pixels on. This describes Photoshop 2024–2026, where Straight Crop is the tool\'s default mode and Perspective Crop is a separate tool in the same flyout.',
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
          'Holding Ratio, W x H x Resolution, Original Ratio, 1 : 1 (Square), 4 : 5 (8 : 10), 5 : 7, 2 : 3 (4 : 6), 16 : 9 and Front Image, plus New Crop Preset… to save the current values and Delete Crop Preset to remove a saved one. Adobe names the first entry Ratio (not "Free") and defines it as cropping freely without a fixed ratio; clicking the Clear button clears the Width, Height and Resolution fields. The app renders a partial list with a Ratio select and Apply/Clear buttons (`Crop.tsx:71`).',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:71',
      },
      {
        control: 'Swap Width and Height values',
        detail:
          'The double-arrow button beside the Width and Height fields, which swaps them and changes the crop orientation without changing its size. Adobe: "Clicking the double-arrow icon changes the crop orientation by swapping the Width and Height values. This replaces the Rotate Crop Box button." The older Rotate Crop Box button it replaced is gone, and the `X` key does the same swap. The app has no swap button and `X` is unbound.',
        status: 'missing',
      },
      {
        control: 'Clear',
        detail:
          "The button beside the Width and Height fields that removes the constraints applied to the current crop preset, returning the tool to unconstrained — Adobe: \"press 'clear' to remove any constraints applied to your crop preset\", and it clears the Width, Height and Resolution fields. The app has a button labelled Clear in the same panel, but it drops the draft crop rect rather than clearing a preset's constraints.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:223',
      },
      {
        control: 'Overlay',
        detail:
          'Chooses the composition guide drawn inside the crop box. Rule of Thirds is the default; the full set is Rule of Thirds, Grid, Diagonal, Triangle, Golden Ratio and Golden Spiral. `O` cycles through them and `Shift+O` flips the orientation of the asymmetric ones. The app implements all six overlays plus a Grid divisions input (`Crop.tsx:94`).',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:94',
      },
      {
        control: 'Straighten',
        detail:
          'A control-bar button that arms the Straighten tool, so that the reference line you drag across the photo rotates the image inside the box to match it. Adobe: "Click Straighten in the control bar and then using the Straighten tool, draw a reference line to straighten the photo." Straighten is the only crop-variant control on the current bar: no Adobe page and no third party gives the crop a Curve, a Default, or a Content-Aware control (Content-Aware is a value inside the Fill dropdown; the adjustable corner form is the separate Perspective Crop tool). The app has no Straighten.',
        status: 'missing',
      },
      {
        control: 'Grid',
        detail:
          'Photoshop’s Grid overlay helps align a subject to uniform divisions inside the crop box. THIS APP EXTENDS IT: the Settings menu has a configurable Grid divisions input (default 10, range 2–100), not a Photoshop options-bar control.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:185',
      },
      {
        control: 'Settings (gear) menu',
        detail:
          'Photoshop’s gear opens crop-specific settings. THIS APP DIVERGES: it renders a text-labeled Settings menu rather than the gear control, containing app-specific Overlay visibility, Orientation and Grid divisions controls; it does not expose Photoshop’s crop settings.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:135',
      },
      {
        control: 'Overlay orientation',
        detail:
          'Photoshop can rotate asymmetric crop overlays with Shift+O. THIS APP DIVERGES: when Triangle or Golden Spiral is selected, it exposes a Settings-menu dropdown with four Triangle orientations or eight Golden Spiral orientations instead of relying on Shift+O.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:167',
      },
      {
        control: 'Delete Cropped Pixels',
        detail:
          'Decides whether pixels outside the crop boundary are permanently removed or retained as hidden layer data. Adobe says the option permanently removes outside areas, but allows editing when turned off; its current non-destructive editing guidance documents recovery with Image > Reveal All or by dragging the Crop tool beyond the image edge. Adobe says the unchecked option is unavailable for documents containing only a Background layer. The on-by-default state, Background-layer demotion, and file growth remain third-party observations. The app has no toggle; it implements the Delete Cropped Pixels OFF case as its default (frame changes, layer sources retained).',
        status: 'missing',
      },
      {
        control: 'Use Classic Mode',
        detail:
          'Adobe\'s whole sentence: "Enable this option if you want to use the Crop tool like it was in previous versions of Photoshop (CS5 and earlier)." The legacy behavior — the crop box moving while the image stays put, against the modern mode where the image moves behind a stationary box — is a third-party description, not Adobe text. The app has no Classic Mode toggle.',
        status: 'missing',
      },
      {
        control: 'Auto Center Preview',
        detail:
          'Keeps the crop box centered in the document while the crop area is being adjusted, which is what makes the image shift rather than the box. The app has no such control.',
        status: 'missing',
      },
      {
        control: 'Show Cropped Area',
        detail:
          'Displays the area outside the pending crop boundary as a shaded preview (Adobe’s wording); it does not mean pixels are deleted. Retention depends on Delete Cropped Pixels. THIS APP HAS NO TOGGLE: it draws a fixed dim preview at 0.7 alpha for the relevant crop area, which cannot be switched off from a Photoshop-style Show Cropped Area control.',
        status: 'missing',
      },
      {
        control: 'Enable Crop Shield',
        detail:
          'Applies a customizable color and opacity overlay outside the pending crop boundary. It is a visual shield, not pixel deletion. THIS APP HAS NO CROP SHIELD CONTROL: its fixed dim preview is not user-configurable by color or opacity.',
        status: 'missing',
      },
      {
        control: 'Fill',
        detail:
          'Chooses how Photoshop fills newly exposed pixels when a crop extends beyond the image. Adobe names Content-Aware Fill and says it can expand the canvas beyond the original image size; its full dropdown value list is not published. Content-Aware Fill and Generative Expand synthesize new pixels rather than reveal retained layer data. This app has no Fill control: applying a frame-only crop reveals existing off-frame layer pixels and leaves only areas with no source pixels transparent (OVR-1).',
        status: 'missing',
      },
      {
        control: 'Done / Cancel',
        detail:
          'The pair on the options bar, above the canvas rather than below the crop box. Done commits the crop (also Enter/Return and double-click inside the box); Cancel discards it (also Esc). The app renders Apply and Clear buttons; Enter/Return commits; Esc cancels; double-click inside the box commits; no dedicated Cancel button (Clear serves both).',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:79',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          "Two different things, both Adobe's. Dragging a fresh box with it held constrains that box to a square; dragging a corner handle with it held constrains the proportions the box already has. The app implements both via `useRect` (`constrainToSquare: true`).",
      },
      {
        keys: 'Alt',
        action:
          'Draws the crop box outward from its center, so the opposite edge moves as well. The app implements this via `useRect` (`fromCentre: true`).',
      },
      {
        keys: 'Alt+Shift',
        action:
          'Constrains the proportions and draws from the center at the same time. The app implements both simultaneously.',
      },
      {
        keys: 'Ctrl / ⌘',
        action:
          "Two more of Adobe's: held on its own it invokes the Straighten tool without visiting the bar, and held during a drag it temporarily disables snapping to the crop box edge. The app has no Straighten and no snapping to disable.",
      },
      {
        keys: 'Shift while rotating',
        action: 'Restricts the rotation to 15-degree increments. The app does not implement rotation snapping.',
      },
      {
        keys: 'Ctrl while rotating',
        action: 'Prevents the crop box from shrinking as it rotates. The app does not implement this.',
      },
    ],
    shortcuts: [
      { keys: 'C', action: 'Select the Crop tool.' },
      {
        keys: 'Shift+C',
        action:
          'Re-selects the same tool rather than cycling a flyout. Adobe groups four tools on `C` — Perspective Crop, Slice and Slice Select beside the Straight Crop — and this tile holds one entry, so the other three are unreachable.',
      },
      { keys: 'Enter / Return', action: 'Commits the pending crop, the same as the Done/Apply button.' },
      { keys: 'Esc', action: 'Cancels the pending crop and restores the previous framing.' },
      { keys: 'X', action: 'Switches the crop box orientation between portrait and landscape. Unbound in the app.' },
      {
        keys: 'O',
        action:
          'Cycles the six crop overlay options while the Crop tool is active; the tool-scoped handler takes precedence over the global tonal-tool binding. Implemented.',
      },
      {
        keys: 'Shift+O',
        action:
          'Flips the orientation of the Triangle and Golden Spiral overlays while the Crop tool is active; other overlays ignore this key. Implemented.',
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
      "The app's crop edits the document frame rather than a tool layer, and it is not a raster commit at all. The crop's processor is declared with `commit: 'document-operation'`, and that commit kind is refused by every layer path — painting on it, replaying it into a layer and converting it to a durable layer all bail out — so the raster trim in `src/tools/crop.ts` is declared and unreachable: what actually commits is `applyDocumentCrop`, which takes the rect unclamped, converts it into the next documentFrame and dispatches a `COMMIT_DOCUMENT_EDIT` carrying a `SET_DOCUMENT_FRAME_ACTION` history entry with the previous frame. The frame changes at once — smaller or larger, depending on the rect — and everything outside the new frame stops rendering, while layer positions and sources are untouched, so the discarded pixels are still held in the layer bitmaps and undo puts the frame back. That is Photoshop's Delete Cropped Pixels OFF case — the canvas shrinks, the pixels are kept — not the ON case, which permanently removes them. What the app genuinely lacks is the setting itself (it can neither offer nor invert it) and the Image > Reveal All menu item (does not exist anywhere in the app). The rect may be dragged past the image edge, and the commit follows it there: `applyDocumentCrop` normalises the rect with `sortRoundRect`, which sorts and rounds each edge once without the clamp `trimRect` applies, so a rect reaching past an edge commits a larger documentFrame and a rect reaching before the origin anchors the frame negatively. The commit dispatches no fill of any kind and touches no layer, so the band the growth adds is covered by no layer and stays transparent whatever the bottom layer is — that is OVR-1 in `docs/OVERRIDES.md`, recorded by hand, and it is the decision for Photoshop's Background-layer case rather than an omission of the fill. Nothing else in the stack caps a frame: the one limit is in `applyDocumentCrop` itself, which refuses anything past the 4096px per side / 16,777,216 frame pixels for canvas memory safety (app limit, not Photoshop). At angle zero, re-entering Crop after a frame change seeds the current bounds and previews retained off-frame layer pixels under the dim overlay; widening the crop and applying recovers those pixels exactly (byte-identical per `e2e/crop-history.spec.ts`). Rotated crops apply a layer transform; because overhang geometry is axis-aligned, retained-pixel preview and letterbox guides are suppressed at nonzero rotation; rotated recrops reveal retained content on commit. The live preview clears the current frame to avoid double-compositing translucent layers and budgets at most 4,194,304 backing pixels per frame-sized surface (five surfaces share a 16,777,216-pixel budget); very large previews may be lower resolution. Retention across save/reopen or flattened export is unverified.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html',
      'https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html',
      'https://helpx.adobe.com/ro/photoshop/how-to/image-resizing-basics.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/resize-adjust-resolution/crop-tool-effects-on-image-dimensions.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/apply-content-aware-fill-while-cropping-images.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/boost-workflows-with-the-contextual-task-bar.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/crop-tool.html',
      'https://helpx.adobe.com/photoshop/using/crop-straighten-photos.html',
      'https://help.adobe.com/archive/en/photoshop/cs6/photoshop_reference.pdf',
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
  'The workspace compensates its contain-fit zoom when a frame changes, including undo and redo, so existing document pixels keep the same on-screen size; compensation is bounded by the view zoom limits.',
  'The live preview clears the current frame to avoid double-compositing translucent layers and budgets at most 4,194,304 backing pixels per frame-sized surface; very large previews may be lower resolution.',
  'Rotated crops apply a layer transform. Because overhang geometry is axis-aligned, retained-pixel preview and letterbox guides are suppressed at nonzero rotation; rotated recrops reveal retained content on commit.',
  'OVR-1 applies to newly exposed areas with no retained source pixels, regardless of the bottom layer; existing off-frame pixels remain recoverable and are revealed when the document frame expands. Adobe documents Delete Cropped Pixels off, Reveal All/drag recovery, a Background-only limitation, and separate Content-Aware and Generative synthesis features.',
  'The app still lacks the Delete Cropped Pixels toggle, Image > Reveal All, Fill, and Generative Expand. Retention across save/reopen or flattened export is unverified.',
].join(' ');
