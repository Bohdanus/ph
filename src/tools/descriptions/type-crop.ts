import type { ToolDescription } from './types.ts';

export const typeCropDescriptions: Record<'text' | 'crop', ToolDescription> = {
  text: {
    photoshopName: 'Horizontal Type Tool',
    summary:
      'Creates live, resolution-independent type as a heading, a wrapped paragraph, or type flowing along a path.',
    purpose:
      "Photoshop's Type tools create live, vector-based type: glyph outlines re-rendered from the font, so a type layer stays resolution-independent and editable until you deliberately rasterize it. Clicking places point type, whose lines are independent and never wrap; dragging a bounding box places paragraph type, whose lines wrap and reflow as you resize the box. Type can also flow along an open or closed work path, or fill the inside of a closed shape. Paragraph settings — alignment, justification, indents and hyphenation — apply to paragraph type only, because with point type each line is its own paragraph. The anti-aliasing pull-down is no longer on the type options bar; it is reached from the Character panel, the layer's properties and the Type menu instead. When exactly it left the bar is community-reported only and is not asserted here.",
    options: [
      {
        control: 'Tool preset',
        detail:
          'A picker of saved type-tool presets at the far left of the bar, so a whole set of type settings can be recalled at once.',
        status: 'missing',
      },
      {
        control: 'Text Orientation',
        detail:
          'The second button in the bar, a T with a direction marker, that switches new type between horizontal and vertical; Layer > Type > Horizontal/Vertical and Change Text Orientation in the Character panel menu do the same to an existing layer, flipping the whole layer regardless of what is selected.',
        status: 'missing',
      },
      {
        control: 'Font family',
        detail:
          'A combo box showing every font available to Photoshop in a WYSIWYG list, each entry rendered in its own face so the list previews the fonts.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:123',
      },
      {
        control: 'Font Style',
        detail:
          'A combo box over the styles the chosen family actually has — Regular, Italic, Bold, Bold Italic and family-specific variants — with Faux Bold and Faux Italic synthesized when the family lacks them.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:189',
      },
      {
        control: 'Size',
        detail:
          'The type size, entered in points by default and accepting a unit suffix (pt, px, mm, in, pica). 1 pt is 1/72 in. The value sets the em size, not the cap height.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:136',
      },
      {
        control: 'Anti-Alias',
        detail:
          'Five presets — None, Sharp (type appears at its sharpest), Crisp (somewhat sharp), Strong (heavier) and Smooth (smoother) — that control how the glyph edges are rendered into pixels. It is no longer on the type options bar, and is reached from the Character panel, the layer’s properties and the Layer > Type menu instead; when it left the bar is community-reported only, and no Adobe page states a version boundary.',
        status: 'missing',
      },
      {
        control: 'Text color',
        detail:
          'A color swatch that opens the Color Picker and sets the type fill, also reachable by Alt+Backspace for the foreground color and Ctrl+Backspace for the background color. Selecting characters rather than the layer limits the change to those characters.',
        status: 'missing',
      },
      {
        control: 'Align Text Left / Center Text / Align Text Right',
        detail:
          'A row of three buttons that set paragraph alignment, defaulting to Align Text Left. Justify Last Left, Justify Last Centered, Justify Last Right and Justify All live in the Paragraph panel.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:175',
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
          'A T over a curved line that opens the Warp Text dialog: a Style list (Arc, Arc Lower, Arc Upper, Arch, Bulge and more), a Horizontal/Vertical orientation, and Bend plus Horizontal Distortion and Vertical Distortion sliders. Choosing None in the dialog unwraps the layer.',
        status: 'missing',
      },
      {
        control: 'Toggle the Character and Paragraph panels',
        detail:
          'The last button in the bar, which brings the Character and Paragraph panels to the front of the panel group so the settings that are not on the bar can be reached.',
        status: 'missing',
      },
      {
        control: 'Commit / Cancel',
        detail:
          "The check mark and the cancel cross, which appear only while a type layer is in edit mode. The check mark also fires on the numeric keypad's Enter and on Ctrl+Enter (Windows) or Command+Return (Mac OS); Esc commits by default and can be switched to cancel under Preferences > Type.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Text/Text.tsx:210',
      },
    ],
    modifiers: [],
    shortcuts: [{ keys: 'T', action: 'Select the Type tool.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/text.ts:22',
      'src/tools/text.ts:66',
      'src/components/ToolbarsRight/Text/Text.tsx:26',
      'src/components/Main/TextToolArea.tsx:24',
      'src/tools/settings.ts:77',
      'src/tools/toolProcessors.ts:159',
      'src/contexts/useLayer.ts:345',
      'src/contexts/layer-renderer.ts:32',
      'src/util/rect.ts:116',
      'toolbar-mapping.ts:107',
    ],
    appNotes:
      "The app's type layer is baked pixels, not live type. renderText paints the string into a 2D context with fillText, and the text processor hands back a single OffscreenCanvas, so what reaches the Layers panel is a bitmap; the layer renderer re-runs a tool's creator only for the six shape tools, and text is not on that list, so its retained args are never re-rendered. Enlarging a text layer therefore rescales those pixels where a Photoshop type layer re-renders at the new size. There is no text box either: the app grows the rect to the widest line instead of wrapping, so a long line runs to the canvas edge rather than reflowing, and every newline is a hard break. Text is typed into a textarea in the right-hand panel rather than onto the canvas, so there is no caret, no text selection and no per-character formatting; the draft is committed by Apply or implicitly by switching tools, and the commit creates a raster layer. There is no colour control on this bar at all: the type fill is slaved to the global foreground swatch in the left rail, which this panel only mirrors into the tool args and the overlay, so the colour is a whole-app choice rather than a per-type-layer one. Font size is a CSS pixel range of 8-500 rather than points, the font list is fourteen hard-coded families rather than the system enumeration, and leading is a unitless multiplier of the font size where Photoshop's is an absolute baseline-to-baseline distance in points. T is the only type key, and only while the textarea does not hold focus — the panel focuses it as soon as the tool is selected, and a shortcut that does not opt into inputs is refused while a field is focused, so a T pressed mid-edit types a letter rather than reselecting the tool. The type tile holds a single entry, so Shift+T re-selects the same tool instead of cycling a flyout. Nothing binds Ctrl+Enter, Enter or Esc to a type commit or cancel: Enter inside the focused textarea takes the textarea's own newline, and the one Escape handler the type tool would have had is commented out; the only live Escape near this bar belongs to the font popup, where it reverts the pending family and closes the list.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/creating-type.html',
      'https://helpx.adobe.com/photoshop/using/editing-text.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html',
      'https://helpx.adobe.com/photoshop/using/formatting-characters.html',
      'https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html',
      'https://helpx.adobe.com/photoshop/using/line-character-spacing.html',
      'https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html',
      'https://helpx.adobe.com/photoshop/using/layers.html',
      'https://www.adobe.com/learn/photoshop/web/rasterize-type-shape-layer',
      'https://www.adobe.com/products/photoshop/rasterize.html',
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
      "A crop sets a new boundary for the document. Selecting the Crop tool shows a crop box you can drag out, resize by its handles, and rotate by dragging outside a corner; dragging inside the box moves the image while the box stays where it is, and dragging outside repositions the box without moving the image. Nothing is committed until you confirm with Enter, Return, the check mark, or a double-click inside the box, and Esc restores the framing you had before. Photoshop treats the crop as non-destructive until that commit, and it is only irreversible once the commit happens with Delete Cropped Pixels on. This describes Photoshop 2024-2026, where Straight Crop is the tool's default mode and Perspective Crop is a separate tool in the same flyout rather than a mode of this one.",
    options: [
      {
        control: 'Aspect ratio menu',
        detail:
          'The leftmost control, holding Ratio, W x H x Resolution, Original Ratio, 1 : 1 (Square), 4 : 5 (8 : 10), 5 : 7, 2 : 3 (4 : 6), 16 : 9 and Front Image, plus New Crop Preset to save the current values and Delete Crop Preset to remove a saved one. Adobe names the first entry Ratio, not "Free", and defines it as cropping freely without a fixed ratio; clearing the two Width and Height fields is what returns the tool to unconstrained.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:61',
      },
      {
        control: 'Swap Width and Height values',
        detail:
          'The double-arrow button beside the Width and Height fields, which swaps them and so changes the crop orientation without changing its size. Adobe states it directly: "To swap Width and Height values, click the Swap icon in the options bar." The older `Rotate Crop Box` button it replaced is gone, and the `X` key does the same swap.',
        status: 'missing',
      },
      {
        control: 'Straighten / Curve / Content-Aware / Default',
        detail:
          'The row of crop variants under the ratio menu. Straighten takes a dragged reference line and rotates the image inside the box to match it; Curve is the adjustable form; Content-Aware is the fill variant; Default returns to an unrotated crop. Holding Ctrl (Windows) or Command (Mac OS) reaches Straighten without visiting the bar.',
        status: 'missing',
      },
      {
        control: 'Fill',
        detail:
          'What the area the crop adds outside the photo is filled with: None, Content-Aware Fill, Background, Foreground Color, Black, 50% Gray or White. Choosing Content-Aware Fill is what lets the crop box extend past the image edge and synthesize the gap instead of leaving it transparent; it requires Use Classic Mode to be off.',
        status: 'missing',
      },
      {
        control: 'Delete Cropped Pixels',
        detail:
          'Decides whether a committed crop is reversible. On, it permanently removes everything outside the crop; off, the pixels are kept and the canvas simply shrinks. Adobe states the setting only as "Permanently removes areas outside the crop, but allows editing when turned off" — the on-by-default state, the Background layer being demoted so Photoshop can hold the hidden pixels, the Image > Reveal All route back and the resulting file growth are third-party observations, not Adobe text.',
        status: 'missing',
      },
      {
        control: 'Show Cropped Area',
        detail: 'Displays the cropped-out area as a shaded overlay inside the crop box.',
        status: 'missing',
      },
      {
        control: 'Enable Crop Shield',
        detail:
          'Applies a color overlay outside the crop area, with a customizable color and opacity. The shield darkens the parts of the canvas the crop will discard.',
        status: 'partial',
        appRef: 'src/hooks/useRect.ts:167',
      },
      {
        control: 'Use Classic Mode',
        detail:
          'Reverts the tool to the legacy behavior from before Creative Cloud 2019, in which the crop box itself rotates; the modern mode rotates the image inside a stationary box.',
        status: 'missing',
      },
      {
        control: 'Auto Center Preview',
        detail: 'Keeps the image centered in the document while the crop area is being adjusted.',
        status: 'missing',
      },
      {
        control: 'Overlay',
        detail:
          'Chooses the composition guide drawn inside the crop box. Rule of Thirds is the default; the full set is Rule of Thirds, Grid, Diagonal, Triangle, Golden Ratio and Golden Spiral, and O cycles through them.',
        status: 'missing',
      },
      {
        control: 'Grid',
        detail:
          'Draws a uniform grid of a chosen number of divisions inside the crop box, for aligning to a subject rather than to a composition rule.',
        status: 'missing',
      },
      {
        control: 'Done / Cancel',
        detail:
          'The check mark and the cancel cross below the crop box. Done commits the crop, which is also Enter (Windows) or Return (Mac OS) and a double-click inside the box; Cancel discards it, which is also Esc.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Crop/Crop.tsx:79',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Constrains the crop box to the proportions it already has while a handle is dragged, instead of letting the drag set them freely.',
      },
      {
        keys: 'Alt',
        action: 'Draws and resizes the crop box outward from its center, so the opposite edge moves as well.',
      },
      { keys: 'Alt+Shift', action: 'Constrains the proportions and draws from the center at the same time.' },
    ],
    shortcuts: [{ keys: 'C', action: 'Select the Crop tool.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/crop.ts:26',
      'src/components/ToolbarsRight/Crop/Crop.tsx:61',
      'src/components/Main/CropToolArea.tsx:21',
      'src/hooks/useRect.ts:89',
      'src/hooks/useRect.ts:145',
      'src/hooks/useRect.ts:255',
      'src/util/rect.ts:36',
      'src/contexts/useLayer.ts:612',
      'src/tools/settings.ts:62',
      'src/tools/toolProcessors.ts:145',
      'toolbar-mapping.ts:59',
    ],
    appNotes:
      "The app's crop edits the document frame rather than a tool layer. applyDocumentCrop trims the rect to the canvas, converts it into the next documentFrame, and dispatches a SET_DOCUMENT_FRAME_ACTION history entry, so the document shrinks at once and everything outside the new frame stops rendering. The layer positions and sources are untouched, so the discarded pixels are still held in the layer bitmaps, and the history entry carries the previous frame, so undo brings the area back. That is Photoshop's Delete Cropped Pixels OFF case — the canvas shrinks, the pixels are kept — not the ON case, which permanently removes them. What the app genuinely lacks is the setting itself, which it can neither offer nor invert, and the Image > Reveal All menu item, which does not exist anywhere in the app. The rect may be dragged past the image edge, yet trimRect clamps it to the document, so extending a crop cannot add canvas the way Photoshop's Fill control does. Dragging inside the crop box moves the box rather than the image: useRect translates the rect for its inside edge, and CropToolArea never passes a layer under the pointer, so the branch that would pick up the layer never runs. The pending rect is not written through to the persisted settings: the crop arm of the settings saver omits the rect and the pre-ratio rect before persisting, so the aspect ratio survives a tool switch and the draft does not, and switching away from the Crop tool and back discards the draft. That is closer to Photoshop's cancel-on-Escape than to its commit-on-switch. On modifiers, Shift does lock the current aspect ratio, but it is honoured for any modifier the browser reports rather than Shift alone, and there is no Alt from-center drag, so the Alt and Alt+Shift rows of the table above are aspirational. C is the only crop key. The crop tile holds a single entry, so Shift+C re-selects the Crop tool rather than cycling a flyout, and Perspective Crop, Slice and Slice Select are not in the tool registry at all. O and Shift+O are bound to the Dodge and Burn tonal group, so pressing either while cropping switches to another tool instead of cycling an overlay, and there is no overlay control to cycle. No X key is bound anywhere in the app. Backspace and Delete are bound only in the two lasso tool areas, and Enter and Escape only in those same two areas and in the font popup, so the crop registers no key handler of its own and the framing is committed or dropped with the panel's Apply and Clear buttons alone. Ctrl on Windows, or Command on Mac OS, is read by the app for the opposite purpose: it locks the current aspect ratio, which is the behaviour the Shift row describes, and it never invokes a Straighten tool. Finally, the app draws one crop overlay, not two: the mask fills the whole canvas with a fixed 0.7 black and then clears the crop rect, which is a single treatment outside the box, so it can stand in for Enable Crop Shield alone. Photoshop's Show Cropped Area shades the discarded image inside the box, and nothing in the app draws that.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/apply-content-aware-fill-while-cropping-images.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/crop-tool.html',
      'https://helpx.adobe.com/photoshop/using/crop-straighten-photos.html',
      'https://helpx.adobe.com/photoshop-elements/using/cropping.html',
      'https://helpx.adobe.com/in/photoshop/using/new-shortcuts-cs6.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/content-aware-crop-fill.html',
      'https://www.adobe.com/products/photoshop/crop-image.html',
      'https://www.photoshopessentials.com/basics/photoshop-crop-tool-tips-and-tricks',
      'https://creativepro.com/essential-tips-for-cropping-images-photoshop',
      'https://design.tutsplus.com/tutorials/10-things-you-should-know-about-the-crop-tool--psd-34592',
    ],
  },
};
