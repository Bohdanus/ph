import type { ToolDescription } from './types.ts';

export const typeCropDescriptions: Record<'text' | 'crop', ToolDescription> = {
  text: {
    photoshopName: 'Horizontal Type Tool',
    summary:
      'Creates live, resolution-independent type as a heading, a wrapped paragraph, or type flowing along a path.',
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
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:136',
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
          'The type size, entered in points by default and accepting a unit suffix (pt, px, mm, in, pica). 1 pt is 1/72 in. The value sets the em size, not the cap height, and the bound Adobe documents is on the field rather than on rendering.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:149',
      },
      {
        control: 'Text color',
        detail:
          'A color swatch that opens the Color Picker and sets the type fill, also reachable by Alt+Backspace for the foreground color and Ctrl+Backspace for the background color. Selecting characters rather than the layer limits the change to those characters.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:184',
      },
      {
        control: 'Align Text Left / Center Text / Align Text Right',
        detail:
          'A row of three buttons that set paragraph alignment, defaulting to Align Text Left. Justify Last Left, Justify Last Centered, Justify Last Right and Justify All live in the Paragraph panel.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:195',
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
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:230',
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
      'src/tools/text.ts:28',
      'src/tools/text.ts:72',
      'src/tools/toolProcessors.ts:160',
      'src/components/ToolbarsRight/Text/Text.tsx:95',
      'src/components/Main/TextToolArea.tsx:24',
      'src/contexts/useLayer.ts:369',
      'src/contexts/layer-renderer.ts:32',
      'src/contexts/layer-renderer.ts:53',
      'src/contexts/materialization.ts:171',
      'src/util/rect.ts:116',
      'src/util/settings.ts:31',
      'src/tools/settings.ts:82',
      'toolbar-mapping.ts:108',
    ],
    appNotes:
      "The app's type layer is baked pixels, not live type. renderText paints the string into a 2D context with fillText, and the text creator hands back a single OffscreenCanvas, so what reaches the Layers panel is a bitmap. On the runtime path the layer renderer re-runs a tool's creator only for the six shape tools and text is not among them, so the visible canvas, undo replay and the PSD writer all draw `layer.bitmap` and enlarging a text layer rescales those pixels where a Photoshop type layer re-renders at the new size. The durable path is the exception and the runtime claim is not the whole truth: the durable materializer re-runs the text creator from the retained args, so the characters survive in one of the two engines and are re-derivable there. There is no text box either: the app grows the rect to the widest line instead of wrapping, so a long line runs to the canvas edge rather than reflowing, and every newline is a hard break. Text is typed into a textarea in the right-hand panel rather than onto the canvas, so there is no caret, no text selection and no per-character formatting; the draft is committed by Apply or implicitly by switching tools, and the commit creates a raster layer. The colour row is the one this file used to get backwards. There IS a colour control — a native colour input at Text.tsx:184 that writes through to the args and from there into renderText — and it is the tool's own setting: the bar no longer mirrors the global foreground swatch into the args on every render, which is what the earlier text claimed. What the app still lacks is Photoshop's Color Picker rather than the platform's, the Alt+Backspace and Ctrl+Backspace foreground/background bindings (there is no altKey registration anywhere in the keyboard table), per-character scoping, and Photoshop's default of seeding the type colour from the foreground swatch — the app's seed is a fixed black. Font size is a CSS pixel range of 8-500 rather than points, the font list is fourteen hard-coded families rather than the system enumeration, and leading is a unitless multiplier of the font size defaulting to 1.1 where Photoshop's Leading defaults to Auto, so every line the app draws is set to a fixed ratio rather than an automatic one. T is the only type key, and only while the textarea does not hold focus — the canvas tool area focuses it as soon as the tool is selected, and a shortcut that does not opt into inputs is refused while a field is focused, so a T pressed mid-edit types a letter rather than reselecting the tool. The type tile holds a single entry, so Shift+T re-selects the same tool instead of cycling a flyout — and that one entry stands in for a four-tool group.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/creating-type.html',
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
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:61',
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
        status: 'missing',
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
          'Decides whether a committed crop is reversible. On, it permanently removes everything outside the crop; off, the pixels are kept and the canvas simply shrinks. Adobe states the setting only as "Permanently removes areas outside the crop, but allows editing when turned off" — the on-by-default state, the Background layer being demoted so Photoshop can hold the hidden pixels, the Image > Reveal All route back and the resulting file growth are third-party observations, not Adobe text.',
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
          "Displays the cropped-out area as a shaded overlay, which is Adobe's own wording. The region is the area the crop will discard — the same one Enable Crop Shield covers — and the difference between the two is that this one is a plain shade where Crop Shield is a colour and an opacity you choose.",
        status: 'partial',
        appRef: 'src/hooks/useRect.ts:223',
      },
      {
        control: 'Enable Crop Shield',
        detail:
          'Applies a color overlay outside the crop area, with a customizable color and an opacity you set, plus an auto-adjust option that lightens the overlay as the crop is dragged so it never obscures the subject. The shield darkens the parts of the canvas the crop will discard.',
        status: 'partial',
        appRef: 'src/hooks/useRect.ts:223',
      },
      {
        control: 'Fill',
        detail:
          'What the area the crop adds outside the photo is filled with. No Adobe page enumerates this dropdown, and the flat list the previous version of this row gave — None, Content-Aware Fill, Background, Foreground Color, Black, 50% Gray or White — is third-party throughout and predates Generative Expand; what a current walkthrough of the bar reads is Transparent, Content-Aware and Generative Expand, the last being the value Adobe’s own crop flow is built around: "Just click and drag beyond the borders of an image with the Crop tool, and then fill the extended canvas with new content that blends with the existing image." The first entry therefore reads Transparent, not None. Choosing Content-Aware Fill is what lets the crop box extend past the image edge and synthesize the gap instead of leaving it transparent, and Adobe’s own note for it is "To use Content-Aware Fill on Crop, ensure Use Classic Mode is turned off". Classic Mode does not remove this dropdown — it is the one crop setting that is independent of the other two.',
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
          "Two different things, both Adobe's. Dragging a fresh box with it held starts a new crop box; dragging a corner handle with it held constrains the proportions the box already has.",
      },
      {
        keys: 'Alt',
        action: 'Draws and resizes the crop box outward from its center, so the opposite edge moves as well.',
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
      { keys: 'O', action: 'Cycles the overlay options. Unbound in the app — `O` selects the Dodge tool.' },
      {
        keys: 'Shift+O',
        action:
          'Cycles the orientation of the asymmetric overlays. Unbound in the app — `Shift+O` selects the Burn tool.',
      },
      { keys: 'Backspace / Delete', action: 'Resets the crop box. Unbound in the app for this tool.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/crop.ts:26',
      'src/tools/toolProcessors.ts:146',
      'src/components/ToolbarsRight/Crop/Crop.tsx:61',
      'src/components/Main/CropToolArea.tsx:40',
      'src/components/Main/CropToolArea.tsx:61',
      'src/hooks/useRect.ts:156',
      'src/hooks/useRect.ts:223',
      'src/hooks/useRect.ts:342',
      'src/hooks/useRect.ts:454',
      'src/util/rect.ts:36',
      'src/contexts/useLayer.ts:644',
      'src/util/settings.ts:39',
      'src/tools/settings.ts:67',
      'toolbar-mapping.ts:59',
    ],
    appNotes:
      "The app's crop edits the document frame rather than a tool layer, and it is not a raster commit at all. The crop's processor is declared with `commit: 'document-operation'`, and that commit kind is refused by every layer path — painting on it, replaying it into a layer and converting it to a durable layer all bail out — so the raster trim in src/tools/crop.ts is declared and unreachable: what actually commits is applyDocumentCrop, which trims the rect to the canvas, converts it into the next documentFrame and dispatches a COMMIT_DOCUMENT_EDIT carrying a SET_DOCUMENT_FRAME_ACTION history entry with the previous frame. The document shrinks at once and everything outside the new frame stops rendering, while layer positions and sources are untouched, so the discarded pixels are still held in the layer bitmaps and undo puts the frame back. That is Photoshop's Delete Cropped Pixels OFF case — the canvas shrinks, the pixels are kept — not the ON case, which permanently removes them. What the app genuinely lacks is the setting itself, which it can neither offer nor invert, and the Image > Reveal All menu item, which does not exist anywhere in the app. The rect may be dragged past the image edge, yet trimRect clamps it to the document, so extending a crop cannot add canvas the way Photoshop's Fill control does. Dragging inside the crop box translates the rect rather than picking up the layer under the pointer, because CropToolArea never passes one and so the branch that would move the image never runs; whether that is a divergence is not settled, because Adobe's current crop page says an inside drag moves the box. The pending rect is not written through to the persisted settings — the crop arm of the settings saver omits the rect and the pre-ratio rect before persisting — so the aspect ratio survives a tool switch and the draft does not, and switching away from the Crop tool and back discards the draft. That is closer to Photoshop's cancel-on-Escape than to its commit-on-switch. On modifiers, Shift does lock the current aspect ratio on a handle drag, but it is honoured for any modifier the browser reports rather than Shift alone, and useRect's fromCentre and constrainToSquare props are opt-in that CropToolArea never passes, so there is no Alt from-centre drag at all and the Alt, Alt+Shift, Ctrl, Shift-rotate and Ctrl-rotate rows of the table above are aspirational. Enter and Esc are the exception to that pattern: CropToolArea installs its own window keydown listener rather than a table entry, so Enter commits and Esc cancels for real, and neither is reachable from the shared keyboard table. X, O and Shift+O are unbound, and O and Shift+O are actively harmful to repeat because they select the Dodge and Burn tools. The crop tile holds a single entry, so Shift+C re-selects the Crop tool rather than cycling a flyout, and Perspective Crop, Slice and Slice Select are not in the tool registry at all.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html',
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
