import type { ToolDescription } from './types.ts';

export const transformDescriptions: Record<'reposition' | 'transform' | 'levels' | 'color', ToolDescription> = {
  reposition: {
    photoshopName: 'Move Tool',
    summary:
      "Photoshop's Move tool (V) drags layers, selections and artboards around the document, and hosts the transform box Free Transform hangs off.",
    purpose:
      'The Move tool is how content gets placed. Select it, press on a layer, a selection or an artboard, and drag: the layer follows the pointer and settles when the button comes up, so a single drag is a single undo step. It is also the entry point to everything geometric — with Show Transform Controls checked, the same bounding box appears and dragging its handles scales, skews and rotates the layer, which is exactly the state Cmd+T enters. Auto-Select makes the tool pick the layer under the pointer instead of requiring a trip to the Layers panel, and Alt-dragging a layer moves a duplicate of it rather than the original.',
    options: [
      {
        control: 'Tool Preset Picker',
        detail:
          'The tool icon at the far left of the options bar with a flyout arrow. Clicking it lists that tool’s saved presets; Control-clicking it (Command-clicking on macOS) opens a two-item menu — Reset Tool, which returns the current tool’s options to their defaults, and Reset All Tools, which does the same for every tool. It is the escape hatch for the fact that a tool’s options are the ones you last used, not the ones it shipped with.',
        status: 'missing',
      },
      {
        control: 'Auto-Select',
        detail:
          'Checkbox that, when on, resolves the target by hit test: the tool selects the topmost layer that actually has pixels under the cursor, rather than moving whichever layer happens to be active.',
        status: 'partial',
        appRef: 'src/components/Main/MoveToolArea.tsx:176',
      },
      {
        control: 'Auto-Select: Group / Layer',
        detail:
          'Menu beside the Auto-Select checkbox choosing what the hit test resolves to. Layer takes the individual layer under the pointer; Group takes the whole layer group that layer belongs to, so a click anywhere on a grouped child moves the group.',
        status: 'missing',
      },
      {
        control: 'Show Transform Controls',
        detail:
          'Checkbox that puts the transform bounding box and its handles on the currently selected layer without putting the tool into transform mode — the handles simply appear. Dragging one of them is what starts the transform, and it is the same handle-driven state Cmd+T opens; the bar swaps to the numeric transform fields while a handle is held.',
        status: 'partial',
        appRef: 'src/components/Main/MoveToolArea.tsx:117',
      },
      {
        control: 'Align',
        detail:
          'Six buttons, enabled once two or more layers or groups are selected: Top Edges, Vertical Centers, Bottom Edges, Left Edges, Horizontal Centers and Right Edges. Each moves the selected layers so the named edge or center coincides with the extreme of the selection, or with the selection border. Adobe also states the target as two menu commands — Layer > Align against the selected layers, Layer > Align Layers To Selection against the selection border — and the bar control reaches the same two targets through the `Align to` row below.',
        status: 'missing',
      },
      {
        control: 'Distribute',
        detail:
          'The distribute row, enabled only at three or more selected layers: the same six edge and center commands to space the layers evenly between the outermost two, plus the Horizontally and Vertically spacing buttons. The two outermost layers are treated as fixed and only the ones between them move.',
        status: 'missing',
      },
      {
        control: 'Align to',
        detail:
          "The control that chooses what the align and distribute commands align to: Selection, the default, against the border of the current selection, or Canvas, the whole document. It sits at the right of the alignment group, reached through the three-dot More control, and it changes what the same six buttons do rather than adding a command. Adobe's own account of it is the Canvas route — \"To align layers based on the canvas, click the More icon (the three dots) to choose Canvas\" — and the Selection default is the state users report as \"the alignment is set to 'Selection' and not 'Canvas'\".",
        status: 'missing',
      },
      {
        control: 'Width',
        detail:
          'Numeric text box, in percent, for the layer width. It replaces the Auto-Select controls while a transform is active, and carries a Link icon that is on by default since Photoshop 21.0.',
        status: 'missing',
      },
      {
        control: 'Height',
        detail:
          'Numeric text box, in percent, for the layer height, paired with Width through the Link icon so a corner drag scales proportionally.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Drag a duplicate of the layer or selection instead of the original, leaving the source layer where it was. Printed by Adobe as Alt on Windows and Option on macOS.',
      },
      {
        keys: 'Shift',
        action:
          'Constrain the drag to a single axis, so a sloppy diagonal snaps to purely horizontal or purely vertical movement.',
      },
      {
        keys: 'Shift',
        action:
          'Click a layer in the canvas or the Layers panel to add it to the current selection rather than replacing it. Adjacent layers need only Shift-click; noncontiguous layers need Ctrl-click (Command-click on macOS).',
      },
      {
        keys: 'Arrow keys',
        action:
          'Nudge the active layer by one pixel when nothing is selected on it, or the selection itself by one pixel when there is.',
      },
      {
        keys: 'Shift+Arrow keys',
        action: 'Nudge by ten pixels instead of one.',
      },
    ],
    shortcuts: [
      {
        keys: 'V',
        action:
          'Select the Move tool. Tapping the key selects it; holding it springs the Move tool onto the currently active tool for as long as the key is down, and releasing returns to the tool you were on. Spring-loaded switching is a preference (Preferences > Tools > Spring-loaded Tool Shortcuts) and is on by default.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/Main/MoveToolArea.tsx:85',
      'src/components/Main/MoveToolArea.tsx:132',
      'src/components/Main/MoveToolArea.tsx:176',
      'src/components/Main/MoveToolArea.tsx:197',
      'src/tools/reposition.ts:12',
      'src/tools/toolProcessors.ts:114',
      'src/components/ToolbarsRight/Move/Reposition.tsx:12',
      'src/components/Common/AppKeyboardShortcuts.tsx:216',
      'src/components/SidebarLeft/SidebarLeft.tsx:258',
      'src/components/SidebarLeft/SidebarLeft.tsx:431',
      'toolbar-mapping.ts:39',
    ],
    appNotes:
      "The app's Move tool moves and resizes, and the whole gesture is one committed history entry, but almost nothing of Photoshop's bar survives, and what does survive is not merely narrower than Photoshop's: the one canvas overlay the app draws is a resize rectangle where Photoshop draws a transform box, and two of Photoshop's controls are behaviours this app has with nothing on screen to turn them off. That overlay is a divergence rather than a gap, and it is why the verdict is `partial` and not `implemented`. The two rows whose behaviour is welded on are `partial` on exactly that basis, and their `appRef`s point at the behaviour the app performs rather than at a control, because there is no control in the bar to point at. Neither the Auto-Select checkbox nor the Group/Layer menu beside it is rendered, and a search of `src/` and `e2e/` finds no control for either: the tool always resolves the layer under the pointer by hit test and always makes it active, which is Auto-Select: Layer with that state permanently on and the group mode removed — so a grouped child cannot be dragged out of its group, and a click that lands on a transparent part of a layer finds whatever is underneath instead of nothing. There is no Show Transform Controls checkbox either, and the difference is more than cosmetic, because the overlay that does render is a plain resize rectangle drawn by the shared useRect hook — four painted corner handles sitting on eight draggable edges, no rotation zone at all outside the box, no numeric W/H, no reference point — so the geometric half of the tool, which is where Free Transform normally lives, is absent from the Move tool entirely. The align, distribute and align-target rows, the Alt-drag duplicate, the Shift axis constraint, the Shift-click-to-extend and the arrow-key nudge are all missing, which together mean the app can place one layer but cannot line several up. A third divergence is the refusal, which is not a missing feature: the app refuses a press on a bedrock layer, and it does not consult the locked flag that its own layer model carries, so a layer marked locked is still draggable. The keyboard is a divergence too, and it is a strange one because the badge looks right. The Move tile declares V in the toolbar mapping, and the app does bind V — but the badge is not what binds it, and the letter-key layer is a separate hand-written table rather than anything derived from the toolbar. Spring-loaded switching does not exist here at all: the handler switches the tool on keydown and nothing listens for the keyup, so holding V cannot borrow the Move tool for one gesture and hand it back. Auto-Align is a different matter, because it is not this tool's control to lose: in Photoshop it is the Edit > Auto-Align Layers command, a dialog with a Projection choice, and the app has no equivalent of it at all. The panel the app does render is its own: the active layer's name, a Merge all button and a hint, none of which Photoshop's Move bar has.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/move-tool.html',
      'https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html',
      'https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html',
      'https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-content-of-layers-and-groups.html',
      'https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-image-layers.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://helpx.adobe.com/photoshop-elements/desktop/keyboard-shortcuts/keys-selecting-moving-objects.html',
      'https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html',
      'https://helpx.adobe.com/photoshop-elements/using/moving-copying-selections.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html',
      'https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html',
      'http://www.photoshopforphotographers.com/3101-1901/Help_guide/tp/Move_tool.html',
      'https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html',
      'https://jkost.com/blog/2021/10/align-and-distribute-layers-in-photoshop.html',
      'https://www.bwillcreative.com/the-move-tool-in-photoshop/',
      'https://community.adobe.com/questions-712/move-tool-align-to-canvas-by-default-1171406',
    ],
  },

  transform: {
    photoshopName: 'Free Transform — the Edit > Transform command, not a Tools panel Tool',
    summary:
      "Photoshop's Free Transform (Cmd+T) scales, rotates, skews, distorts, warps or tilts a layer in one continuous drag on its bounding box.",
    purpose:
      'Free Transform puts a bounding box around the active layer and lets one continuous operation change its size, angle and shape together, which is the point: rotating and rescaling an image in two steps resamples it twice. Every mode is a drag on that box, and the mode is chosen by right-click menu, by an options-bar button, or by holding a modifier so the box changes behavior mid-gesture. Nothing is written to the document until you commit, so a transform can be abandoned and undone as a unit.',
    options: [
      {
        control: 'Width',
        detail:
          'Numeric text box, in percent, for the layer width. The paired Link icon is on by default since Photoshop 21.0, so a corner handle scales proportionally.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:253',
      },
      {
        control: 'Height',
        detail: 'Numeric text box, in percent, for the layer height, linked to Width by the Link icon.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:268',
      },
      {
        control: 'Maintain Aspect Ratio (Link)',
        detail:
          'Toggle between proportional and non-proportional scaling, on by default since Photoshop 21.0. Shift is bound to the same state and inverts it while held.',
        status: 'missing',
      },
      {
        control: 'Reference point location',
        detail:
          'A 3-by-3 grid of squares choosing the pivot, draggable in the document to move the transform origin. The reference point is hidden by default and must be shown from this control; transforms start from the object center until it is moved.',
        status: 'missing',
      },
      {
        control: 'Rotation',
        detail:
          'Numeric text box, in degrees, for the rotation angle. The same angle is produced by dragging outside the bounding box, where Shift snaps to 15-degree increments.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:182',
      },
      {
        control: 'H',
        detail:
          'Numeric text box, in degrees, for horizontal skew. Adobe names the field H: "To skew numerically, enter degrees in the H (horizontal skew) and V (vertical skew) text boxes in the options bar." The pair is absent from the bar when a Smart Object is the thing being transformed.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:202',
      },
      {
        control: 'V',
        detail: "Numeric text box, in degrees, for vertical skew — Adobe's V, the other half of the H/V pair above.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:218',
      },
      {
        control: 'Switch Between Free Transform And Warp Modes',
        detail:
          'Button that swaps the box for a warp mesh, after which a Warp pop-up menu offers the predefined warp styles and a square handle adjusts the chosen one.',
        status: 'missing',
      },
      {
        control: 'X',
        detail:
          'Numeric text box for the horizontal position of the transform reference point. It is the numeric form of dragging the item inside its own bounding box, and Adobe describes it as taking "values for the new location of the reference".',
        status: 'missing',
      },
      {
        control: 'Y',
        detail:
          "Numeric text box for the vertical position of that same reference point, paired with X; which of the two positionings they express is the Relative Positioning button's state.",
        status: 'missing',
      },
      {
        control: 'Relative Positioning',
        detail:
          'Button that switches what the X and Y values mean: click it "to specify the new position in relation to the current position", so the pair becomes a measured displacement from where the item already is rather than a coordinate.',
        status: 'missing',
      },
      {
        control: 'Commit',
        detail:
          'The checkmark that applies the transform. Enter works too, and so does selecting a new tool, clicking a layer in the Layers panel, or clicking outside the canvas or the bounding box.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:303',
      },
      {
        control: 'Cancel',
        detail:
          'The cancel button that abandons the transform and restores the original shape and size. Esc does the same.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:306',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'With a rotation drag outside the bounding box, constrain the angle to 15-degree increments. With a handle drag, toggle proportional scaling off and on, which is what Shift means since Photoshop 21.0.',
      },
      {
        keys: 'Alt',
        action:
          'Distort relative to the center point of the bounding box, so the opposite handle moves at the same time in the opposite direction. Printed by Adobe as Alt on Windows and Option on macOS.',
      },
      {
        keys: 'Cmd',
        action:
          'Distort freely by dragging a handle, in any direction, with no constraint. Printed by Adobe as Command on macOS and Control on Windows.',
      },
      {
        keys: 'Cmd+Shift',
        action: 'Skew: drag a side handle to slant that side while the opposite side stays parallel.',
      },
      {
        keys: 'Cmd+Alt+Shift',
        action:
          'Perspective: drag a corner handle so the layer recedes toward one edge, the two sides no longer meeting at a right angle.',
      },
    ],
    shortcuts: [
      {
        keys: 'Cmd+T',
        action:
          'Free Transform. Choosing the Move tool and checking Show Transform Controls enters the same state, which is how a pixel layer gets its box.',
      },
      {
        keys: 'Cmd+Option+T',
        action:
          'Duplicate the layer or selection and enter Free Transform on the duplicate, leaving the original untouched.',
      },
      {
        keys: 'Enter',
        action: 'Commit the transform. Selecting another tool or another layer commits it too.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/ToolbarsRight/Transform/Transform.tsx:155',
      'src/components/ToolbarsRight/Transform/Transform.tsx:35',
      'src/contexts/affine-transform.ts:173',
      'src/contexts/affine-transform.ts:216',
      'src/tools/transform.ts:119',
      'src/tools/transform.ts:153',
      'src/tools/toolProcessors.ts:141',
      'src/contexts/useLayer.ts:345',
      'toolbar-mapping.ts:64',
    ],
    appNotes:
      'Free Transform is a command, not a tool. The primary evidence is a negative one and it is a good one: a complete, version-stamped inventory of the Photoshop 2026 Tools panel lists every entry in the bar — Move, the marquees, the crop, the pen family, the type tools, the shape tools, Hand, Zoom — and has no Transform entry in it, while Photoshop reaches the operation through Edit > Transform > Free Transform or Cmd+T. Adobe\'s own routing agrees, sending a pixel layer to the Move tool with Show Transform Controls rather than to any transform tool. One counter-sentence exists on Adobe\'s marketing copy — "Select the Transform tool by pressing Ctrl + T (Cmd + T for Mac)" — but the very next clause of the same page is "You can also go to Edit > Free Transform": the page names the menu route itself, and uses "tool" for the interactive state rather than for a Tools-panel entry. The app registers it as a toolbar entry next to Colors and Levels, and none of the three has a Photoshop toolbar slot. That is a defensible choice, but it makes the panel in the options bar a different thing from Free Transform\'s bar, and the two should not be described as the same control set. What the app builds is a fixed-parameter panel for the Image > Transform operations — rotate 90 degrees left, 180 and 90 degrees right, a continuous rotation slider clamped to plus or minus 90, skew X and skew Y in plus or minus 45 degrees, scale X and Y in 10 to 300 percent, and horizontal and vertical flip — plus one projective operation the app calls Trapezoid, a percentage taper that narrows the top or the bottom of the layer about its horizontal centerline. Photoshop\'s nearest counterpart for that taper is the Perspective mode of Free Transform, reached by Cmd+Option+Shift-drag rather than by a slider, and it is mutually exclusive with every other parameter here: setting Trapezoid resets rotation, both skews and both scales to their defaults, and the processor refuses a trapezoid combined with any retained affine transform rather than composing them. The panel is not a live transform either. There is no bounding box, no handles, no reference point and no commit-on-click-outside; the sliders write a preview through the transient update path and the geometry is only committed, as one history entry, when the dirty tool is committed — on Apply, on tool switch or on export. Escape is the opposite of a commit route: it and the Cancel button both call the same cancel handler, which deletes the pending preview, resets the panel to its defaults and dispatches nothing, so what remains is the last committed state. Of Free Transform\'s own bindings, only Escape is wired; Enter does not commit, and there is no intra-transform undo. Warp, Distort and Perspective-as-a-drag have no implementation at all, and the composite order the app declares — scale, then rotation, then skew, all about the untransformed layer center — is fixed, where Photoshop composes handle drags in the order they happen.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/adjust-scale-rotation-and-perspective.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/apply-transformations.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/duplicate-objects-as-you-transform.html',
      'https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html',
      'https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/manage-image-states.html',
      'https://jkost.com/blog/2019/06/new-free-transform-preference-in-photoshop.html',
      'https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf',
      'https://glensmith.co.uk/photoshop/tools',
      'https://www.adobe.com/products/photoshop/resize-image.html',
      'https://community.adobe.com/questions-712/horizontal-h-and-vertical-v-skew-fields-are-missing-in-the-options-bar-on-photoshop-cc-2019-1078402',
    ],
  },

  levels: {
    photoshopName: 'Levels — the Image > Adjustments command, not a Tools panel Tool',
    summary:
      "Photoshop's Levels remaps an image's tonal range through a black point, a gamma midtone and a white point, per channel, read against a histogram.",
    purpose:
      "Levels is the tonal correction tool: it stretches or compresses where the image's darkest and lightest pixels land, and bends the midtones independently of the ends, which is what separates it from a brightness or contrast slider. The histogram above the controls is the working surface — you read where the data actually sits, then move the three input sliders until the blacks reach the black point, the whites the white point, and the middle slider corrects the overall exposure without crushing either end. Every move can be scoped to one color channel, which is how a cast gets removed rather than merely desaturated. Applied from Image > Adjustments it works directly on the image layer and discards the information it overwrites; applied as an adjustment layer it stays editable forever.",
    options: [
      {
        control: 'Preset',
        detail:
          'Menu of saved settings, with Save Preset alongside it. Adobe states the round trip in one sentence and counts nothing: "You can save Levels settings as a preset, then apply them to other images."',
        status: 'missing',
      },
      {
        control: 'Channel',
        detail:
          'Menu choosing the channel the adjustment applies to — RGB and the individual Red, Green and Blue channels, plus the channel combinations selected in the Channels panel. Defaults to RGB.',
        status: 'missing',
      },
      {
        control: 'Histogram',
        detail:
          'The graph of how pixels are distributed across tonal levels, drawn over the three input sliders as their backing track. It is the guide, not a control: reading it is how you decide where the black and white points belong.',
        status: 'missing',
      },
      {
        control: 'Input Levels: black point',
        detail:
          'Leftmost input slider, on the 0 to 255 level domain Adobe states for the adjustment. It sits at level 0, which Adobe does not state as a default; what Adobe does state is that with the Output sliders in their default positions "moving the black input slider maps the pixel value to level 0". Dragging it right sets clipping: a black point at level 5, this description’s symmetric case to Adobe’s own 243 example on the white point, maps every pixel at level 5 and lower to level 0.',
        status: 'missing',
      },
      {
        control: 'Input Levels: midtone gamma',
        detail:
          'Middle input slider, which "adjusts the gamma in the image" rather than either extreme. It sits at 1.00 by default, which Adobe does not state; moving it left lightens the image and right darkens it, and the pivot is the midpoint level between the output sliders rather than the center of the range.',
        status: 'missing',
      },
      {
        control: 'Input Levels: white point',
        detail:
          'Rightmost input slider, sitting at level 255 by default, which Adobe does not state as a default. Adobe does print the worked case on this slider: "if you move the white point slider to the left at level 243, Photoshop maps all pixels at level 243 and higher to level 255."',
        status: 'missing',
      },
      {
        control: 'Output Levels: black',
        detail:
          'Left output slider, the level the black point maps to, and its default is Adobe’s: "By default, the Output sliders are at level 0, where the pixels are black, and level 255, where the pixels are white." The output pair is what the two input points are defined against, so moving it changes where black lands without touching where it is read from.',
        status: 'missing',
      },
      {
        control: 'Output Levels: white',
        detail:
          'Right output slider, default level 255, the level the white point maps to — the other half of Adobe’s stated Output-slider defaults.',
        status: 'missing',
      },
      {
        control: 'Auto',
        detail:
          'Button that clips a small fraction of the shadows and highlights in every channel and maps the remaining extremes to pure black and pure white, as a starting point to refine by hand. Adobe states both halves of it: the domain is 0 to 255, and "By default, the Auto option and the Auto Tone command clip the white and black pixels by 0.1% — that is, it ignores the first 0.1% of either extreme."',
        status: 'missing',
      },
      {
        control: 'Auto Options',
        detail:
          'Menu command opening the Auto Color Correction Options dialog, which chooses the algorithm Auto runs and sets the shadow and highlight clipping percentages. Adobe’s guidance for those Clip boxes is that a value between 0.0% and 1% is recommended. Three of the four algorithms are Adobe-named — Enhance Monochromatic Contrast, Enhance Per Channel Contrast and Find Dark and Light Colors — and the fourth, Enhance Brightness and Contrast, is third-party only.',
        status: 'missing',
      },
      {
        control: 'Eyedroppers',
        detail:
          'Three eyedroppers — Set Black Point, Set Gray Point and Set White Point — that set each point by clicking the image. Using them discards any Levels adjustment already made, so Adobe advises using them first. The gray point one is for removing a color cast and is unavailable on grayscale images.',
        status: 'missing',
      },
      {
        control: 'Reset',
        detail:
          'Returns the adjustment to its original settings. Part of the adjustment panel rather than the tonal controls themselves, and listed here because it belongs to this adjustment.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Levels/Levels.tsx:138',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Hold while dragging the black point or white point slider to see which areas are being clipped, instead of moving the slider. Adobe prints it as Alt on Windows and Option on macOS. Choosing Show Clipping For Black/White Points from the panel menu makes the same preview permanent.',
      },
    ],
    shortcuts: [
      {
        keys: 'Cmd+L',
        action:
          'Apply the Levels command. Cmd+Shift+L applies it again with the previous settings, and Cmd+Option+L is Levels with the last settings used.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/ToolbarsRight/Levels/Levels.tsx:99',
      'src/components/ToolbarsRight/Levels/Levels.tsx:86',
      'src/tools/levels.ts:12',
      'src/tools/functions.ts:66',
      'src/tools/settings.ts:54',
      'src/tools/toolProcessors.ts:132',
      'src/contexts/useLayer.ts:536',
      'src/contexts/useLayer.ts:345',
      'src/contexts/history-replay.ts:172',
      'src/contexts/layer-renderer.ts:18',
      'src/contexts/materialization.ts:84',
      'src/test/setup.ts:320',
      'toolbar-mapping.ts:63',
    ],
    appNotes:
      "Levels is an Image > Adjustments command, or an adjustment layer — not a toolbar tool — so the app's Levels entry occupies a slot Photoshop's toolbar does not have. Inside that slot nothing in Photoshop's Levels panel is reproduced, and the two sliders that are rendered are not Levels controls at all: Photoshop's Levels has no Brightness and no Contrast slider. What the app renders is CSS brightness() and contrast() over the encoded pixel values, both on an exponential curve re-anchored so the endpoints are exact, which means a flat linear multiply and a pivot at mid-gray in encoded space where Photoshop's curve is piecewise-linear through three control points with its midpoint at level 128. The Brightness slider is labelled and centred on a neutral of 0, and the re-anchoring makes that literal rather than approximate: 0 emits exactly brightness(100%), so the panel at its defaults applies nothing at all, and it is the slider's minimum of -100 that emits brightness(0%) and multiplies the whole layer to black — a range-wide multiply, where Photoshop's black point is a threshold that only remaps the pixels below it. There is no black point, no white point, no gamma midtone, no output pair, no histogram, no channel selector, no Auto, no Auto Options and no eyedroppers. Levels works on the document's encoded values rather than a linear-light space — Adobe draws exactly this contrast with Exposure, which does calculate in linear color space — and the app's filter is likewise in whatever space the canvas composite happens to be. A committed adjustment is retained rather than destroyed, and that is the half of the split the app gets right. A committed Levels adjustment is a layer operation, not a rewrite of pixels: the layer's own bitmap is never touched, the commit appends an operation to the layer's operations array and records one history entry, the renderer re-derives the filter from that array on every frame, and undo and redo replay the operation rather than a stored raster. What the app does not have is the other half of the split: the adjustment is not re-editable, so a committed one can only be taken back with undo, which is why the Reset button is gated on an uncommitted preview and restores the panel's own defaults rather than re-opening the adjustment. The engine for all of that is a CSS filter string assigned to ctx.filter on an ordinary HTMLCanvasElement 2D context — the canvas the user is actually looking at, which the renderer builds with document.createElement and draws the layer stack into. The OffscreenCanvas processors in src/tools/levels.ts are not on that path at all: levels and color are registered as commit: 'layer-operation', and the preview and commit paths append the operation and return before any pixel is produced, so those processors are never reached while editing, previewing or committing. The one surface that still applies the string to an OffscreenCanvas 2D context is the durable materializer, which prefers new OffscreenCanvas wherever one exists; no module outside src/contexts/__tests__ imports it today, and the OffscreenCanvasRenderingContext2D.filter support Safari has never shipped is a property of that surface rather than of the canvas this tool edits on. The string is built in one place, so the renderer and that materializer cannot drift, and the test harness exposes filter as a real writable property, so the emitted string is assertable — though the jsdom mock still cannot rasterize it, so no assertion here proves what the filter looks like.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/levels-adjustment.html',
      'https://helpx.adobe.com/photoshop/using/adjust-color-tone-levels-curves.html',
      'https://helpx.adobe.com/photoshop/using/making-quick-tonal-adjustments.html',
      'https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html',
      'https://helpx.adobe.com/photoshop/using/color-adjustments.html',
      'https://helpx.adobe.com/ca/photoshop/web/edit-images/color--tone--and-lighting/modify-tones-with-levels-adjustment.html',
      'https://www.adobe.com/learn/photoshop/web/photoshop-improve-tones-levels',
      'https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf',
      'https://glensmith.co.uk/photoshop/tools',
      'https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview',
    ],
  },

  color: {
    photoshopName: 'Black and White — the Image > Adjustments command, not a Tools panel Tool',
    summary:
      "Photoshop's Black and White converts a color image to monochrome with six independent hue-sextant sliders, optionally tinted with a tone color.",
    purpose:
      'Black and White is not a desaturation — it is a weighted mix, and the six sliders are the weights. Each of the six sextants of the color wheel, Reds, Yellows, Greens, Cyans, Blues and Magentas, gets its own control over how bright that family of hues becomes in the result, so a landscape can have a dark sky and a bright sky in the same conversion, and skin can be lifted without touching the greens. Every slider starts at a value that reproduces a conventional conversion, and dragging one away from that value is the whole technique. Ticking Tint lays a uniform tone color over the monochrome so it reads as toned rather than neutral, which is how a sepia or a split-tone is made from a color original without going back to it.',
    options: [
      {
        control: 'Preset',
        detail:
          'Menu of predefined grayscale mixes and of any mix the user has saved, with Save Black & White Preset alongside it.',
        status: 'missing',
      },
      {
        control: 'On-image adjustment icon',
        detail:
          'The Targeted Adjustment tool, sitting directly under the Preset option at the top of the panel. Selecting it and dragging on the image moves the sextant slider for whichever family of hues dominates the pixels under the cursor, and that one slider moves every area containing those hues rather than a mark you place.',
        status: 'missing',
      },
      {
        control: 'Auto',
        detail: 'Sets a grayscale mix based on the values in the image itself.',
        status: 'missing',
      },
      {
        control: 'Tint',
        detail:
          'Checkbox that lays a uniform tone color over the monochrome result, which is what turns a neutral conversion into a toned or sepia one.',
        status: 'missing',
      },
      {
        control: 'Tint Color',
        detail:
          'The color swatch beside the Tint checkbox. Choosing it opens the Color Picker, and the tone applied is called Tint Color.',
        status: 'missing',
      },
      {
        control: 'Color sliders',
        detail:
          'Six sliders, one per sextant of the color wheel, in the order Reds, Yellows, Greens, Cyans, Blues, Magentas. Each sets how bright that family of hues renders in the monochrome. Adobe\'s Black and White page does not print their resting values; the default of 40, 60, 40, 60, 20 and 80 is third-party, and the pages that give it print only the first three — "Reds set to 40%, Yellows set to 60%, and so on".',
        status: 'missing',
      },
      {
        control: 'Reset',
        detail:
          'The reset icon that returns the sliders to their default values, and more generally the panel control that returns the adjustment to its original settings.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Colors/Color.tsx:183',
      },
    ],
    modifiers: [],
    shortcuts: [],
    implementation: 'partial',
    implementationRefs: [
      'src/components/ToolbarsRight/Colors/Color.tsx:123',
      'src/components/ToolbarsRight/Colors/Color.tsx:110',
      'src/tools/colors.ts:12',
      'src/tools/functions.ts:60',
      'src/tools/settings.ts:53',
      'src/tools/toolProcessors.ts:126',
      'src/contexts/useLayer.ts:536',
      'src/contexts/useLayer.ts:345',
      'src/contexts/history-replay.ts:172',
      'src/contexts/layer-renderer.ts:16',
      'src/contexts/materialization.ts:78',
      'src/test/setup.ts:320',
      'toolbar-mapping.ts:62',
    ],
    appNotes:
      "Black and White is an Image > Adjustments command, or an adjustment layer — not a toolbar tool — so the app's Colors entry occupies a slot Photoshop's toolbar does not have. None of Photoshop's seven controls is reproduced, and the three sliders that are rendered are not Black and White controls: there is no sextant weighting anywhere in the app, so no per-hue decision can be made and the conversion is a flat luminance desaturation rather than a mix. The grayscale slider is the nearest thing to the whole panel and it is the one control that cannot stand in for it, because a hue-weighted mix and a luminance average differ the moment any of the six families is pushed. Sepia is not the Tint checkbox either: Tint lays a uniform tone color over a conversion whose mix you still control, and applying sepia is a second filter stage that tints the whole image rather than replacing its channel weights, so the two can be combined and the result is not the same look. Saturation belongs to no part of Black and White; it is a Hue/Saturation control, and the fact that this app has one is a leftover from the identity question this tool's shape was chosen to answer. Presets, Auto, the on-image adjustment icon and the six sliders are all absent, and the Reset button that is present does not behave as Photoshop's does: it is disabled unless an uncommitted preview is live, and it restores that panel's own defaults rather than the sextant defaults, so a committed conversion can only be undone. As with Levels, the engine is a CSS filter string, and the surface it is assigned to is the visible canvas: the renderer builds an ordinary HTMLCanvasElement, sets ctx.filter from the layer's operations array and draws the layer stack into it. The OffscreenCanvas processors in src/tools/colors.ts are not on the editing, preview or commit path — color is registered as commit: 'layer-operation', so those paths append the operation and return before a pixel is produced — and the committed conversion is retained on the same terms as Levels, with the layer's own bitmap untouched and undo replaying the operation rather than a raster. The string is built once, so the renderer and the durable materializer cannot drift, and the test harness exposes filter as a writable property, so the emitted string is assertable; the jsdom mock still cannot rasterize it, so no test here shows what the filter looks like.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html',
      'https://helpx.adobe.com/photoshop/using/color-adjustments.html',
      'https://helpx.adobe.com/photoshop/using/color-monochrome-adjustments-using-channels.html',
      'https://www.photoshopessentials.com/photo-editing/black-and-white-cs3',
      'https://www.photoshopessentials.com/photo-editing/converting-color-photos-to-black-and-white-in-photoshop',
      'https://www.photoshopessentials.com/photo-effects/easy-selective-color-effect-with-photoshop',
      'https://photoshoptrainingchannel.com/black-white-photos-photoshop/',
      'https://glensmith.co.uk/photoshop/tools',
      'https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview',
    ],
  },
};
