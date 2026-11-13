import type { ToolDescription } from './types.ts';

export const transformDescriptions: Record<
  'reposition' | 'transform' | 'levels' | 'invert' | 'color',
  ToolDescription
> = {
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
          "The tool icon at the far left of the options bar with a flyout arrow. Clicking it lists that tool's saved presets; Control-clicking it (Command-clicking on macOS) opens a two-item menu — Reset Tool, which returns the current tool's options to their defaults, and Reset All Tools, which does the same for every tool. It is the escape hatch for the fact that a tool's options are the ones you last used, not the ones it shipped with.",
        status: 'missing',
      },
      {
        control: 'Auto-Select',
        detail:
          'Checkbox that, when on, resolves the target by hit test: the tool selects the topmost layer that actually has pixels under the cursor, rather than moving whichever layer happens to be active. THIS APP DIVERGES: No checkbox rendered. The tool ALWAYS resolves the layer under the pointer by hit test and makes it active — Auto-Select: Layer is permanently ON with no way to disable, and no Group/Layer menu exists.',
        status: 'partial',
        appRef: 'src/components/Main/MoveToolArea.tsx:178',
      },
      {
        control: 'Auto-Select: Group / Layer',
        detail:
          'Menu beside the Auto-Select checkbox choosing what the hit test resolves to. Layer takes the individual layer under the pointer; Group takes the whole layer group that layer belongs to, so a click anywhere on a grouped child moves the group. THIS APP DIVERGES: No Group/Layer menu. Clicking a grouped child always selects the individual layer, never the group.',
        status: 'missing',
      },
      {
        control: 'Show Transform Controls',
        detail:
          'Checkbox that displays transform handles on the selected layer without entering Free Transform; dragging a handle starts the transform. THIS APP DIVERGES: No checkbox or Photoshop numeric transform fields/reference point. The app uses a resize rectangle for ordinary layers and enables rotation handles only for rotatable shape layers (`activeLayerSupportsRotation` via `useRect.rotationEnabled`).',
        status: 'partial',
        appRef: 'src/components/Main/MoveToolArea.tsx:285',
      },
      {
        control: 'Align',
        detail:
          'Six buttons, enabled once two or more layers or groups are selected: Top Edges, Vertical Centers, Bottom Edges, Left Edges, Horizontal Centers and Right Edges. Each moves the selected layers so the named edge or center coincides with the extreme of the selection, or with the selection border. Adobe also states the target as two menu commands — Layer > Align against the selected layers, Layer > Align Layers To Selection against the selection border — and the bar control reaches the same two targets through the `Align to` row below. THIS APP DIVERGES: No align buttons implemented.',
        status: 'missing',
      },
      {
        control: 'Distribute',
        detail:
          'The distribute row, enabled only at three or more selected layers: the same six edge and center commands to space the layers evenly between the outermost two, plus the Horizontally and Vertically spacing buttons. The two outermost layers are treated as fixed and only the ones between them move. THIS APP DIVERGES: No distribute buttons implemented.',
        status: 'missing',
      },
      {
        control: 'Align to',
        detail:
          "The control that chooses what the align and distribute commands align to: Selection, the default, against the border of the current selection, or Canvas, the whole document. It sits at the right of the alignment group, reached through the three-dot More control, and it changes what the same six buttons do rather than adding a command. Adobe's own account of it is the Canvas route — \"To align layers based on the canvas, click the More icon (the three dots) to choose Canvas\" — and the Selection default is the state users report as \"the alignment is set to 'Selection' and not 'Canvas'\". THIS APP DIVERGES: No align target selector implemented.",
        status: 'missing',
      },
      {
        control: 'Width',
        detail:
          'Numeric text box, in percent, for the layer width. It replaces the Auto-Select controls while a transform is active, and carries a Link icon that is on by default since Photoshop 21.0. THIS APP DIVERGES: No numeric width percentage field in options bar.',
        status: 'missing',
      },
      {
        control: 'Height',
        detail:
          'Numeric text box, in percent, for the layer height, paired with Width through the Link icon so a corner drag scales proportionally. THIS APP DIVERGES: No numeric height percentage field in options bar.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Drag a duplicate of the layer or selection instead of the original, leaving the source layer where it was. Printed by Adobe as Alt on Windows and Option on macOS. THIS APP DIVERGES: Alt+drag does not duplicate layer; behaves as normal drag.',
      },
      {
        keys: 'Shift',
        action:
          'Constrain the drag to a single axis, so a sloppy diagonal snaps to purely horizontal or purely vertical movement. THIS APP DIVERGES: Shift does not constrain drag to single axis.',
      },
      {
        keys: 'Shift',
        action:
          'Click a layer in the canvas or the Layers panel to add it to the current selection rather than replacing it. Adjacent layers need only Shift-click; noncontiguous layers need Ctrl-click (Command-click on macOS). THIS APP DIVERGES: Shift+click does not add layer to selection.',
      },
      {
        keys: 'Arrow keys',
        action:
          'Nudge the active layer by one pixel when nothing is selected on it, or the selection itself by one pixel when there is. THIS APP DIVERGES: Arrow keys do not nudge layer by 1px (or 10px with Shift).',
      },
      {
        keys: 'Shift+Arrow keys',
        action: 'Nudge by ten pixels instead of one. THIS APP DIVERGES: Not implemented.',
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
      'src/components/Main/MoveToolArea.tsx:119',
      'src/components/Main/MoveToolArea.tsx:150',
      'src/components/Main/MoveToolArea.tsx:178',
      'src/components/Main/MoveToolArea.tsx:199',
      'src/contexts/useLayer.ts:334',
      'src/tools/reposition.ts:12',
      'src/tools/toolProcessors.ts:115',
      'src/components/ToolbarsRight/Move/Reposition.tsx:13',
      'src/components/Common/AppKeyboardShortcuts.tsx:327',
      'src/components/SidebarLeft/SidebarLeft.tsx:644',
      'src/components/SidebarLeft/SidebarLeft.tsx:974',
      'toolbar-mapping.ts:39',
    ],
    appNotes:
      "The app's Move tool moves and resizes, and the whole gesture is one committed history entry, but almost nothing of Photoshop's bar survives, and what does survive is not merely narrower than Photoshop's: the one canvas overlay the app draws is a resize rectangle where Photoshop draws a transform box, and two of Photoshop's controls are behaviours this app has with nothing on screen to turn them off. That overlay is a divergence rather than a gap, and it is why the verdict is `partial` and not `implemented`. The two rows whose behaviour is welded on are `partial` on exactly that basis, and their `appRef`s point at the behaviour the app performs rather than at a control, because there is no control in the bar to point at. Neither the Auto-Select checkbox nor the Group/Layer menu beside it is rendered, and a search of `src/` and `e2e/` finds no control for either: the tool always resolves the layer under the pointer by hit test and always makes it active, which is Auto-Select: Layer with that state permanently on and the group mode removed — so a grouped child cannot be dragged out of its group, and a click that lands on a transparent part of a layer finds whatever is underneath instead of nothing. There is no Show Transform Controls checkbox either, and the difference is more than cosmetic, because the overlay that does render is a plain resize rectangle drawn by the shared useRect hook — four painted corner handles sitting on eight draggable edges, no rotation zone at all outside the box, no numeric W/H, no reference point — so the geometric half of the tool, which is where Free Transform normally lives, is absent from the Move tool entirely. The align, distribute and align-target rows, the Alt-drag duplicate, the Shift axis constraint and the Shift-click-to-extend remain missing, which still prevents the app from aligning several layers. Arrow keys nudge one active unlocked non-bedrock layer by one document pixel, or ten with Shift, when no selection is active.",
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
      'https://photoshoptrainingchannel.com/tips/show-transform-controls',
    ],
  },

  transform: {
    photoshopName: 'Free Transform — the Edit > Free Transform command, not a Tools panel Tool',
    summary:
      "Photoshop's Free Transform (Cmd+T) scales, rotates, skews, distorts, adds perspective or warps a layer in one continuous operation.",
    purpose:
      'Free Transform puts a bounding box around the active layer and lets one continuous operation change its size, angle and shape together, which is the point: rotating and rescaling an image in two steps resamples it twice. Every mode is a drag on that box, and the mode is chosen by right-click menu, by an options-bar button, or by holding a modifier so the box changes behavior mid-gesture. Nothing is written to the document until you commit, so a transform can be abandoned and undone as a unit.',
    options: [
      {
        control: 'Width',
        detail:
          'Numeric text box, in percent, for the layer width. The paired Link icon is on by default since Photoshop 21.0, so a corner handle scales proportionally. THIS APP DIVERGES: Implementation has Resize X slider (10-300%) but NO numeric text field for width percentage. No Link icon for aspect ratio.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:290',
      },
      {
        control: 'Height',
        detail:
          'Numeric text box, in percent, for the layer height, linked to Width by the Link icon. THIS APP DIVERGES: Implementation has Resize Y slider (10-300%) but NO numeric text field for height percentage.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:305',
      },
      {
        control: 'Maintain Aspect Ratio (Link)',
        detail:
          'Toggle between proportional and non-proportional scaling, on by default since Photoshop 21.0. Shift is bound to the same state and inverts it while held. THIS APP DIVERGES: No Link toggle icon to maintain aspect ratio between Width/Height.',
        status: 'missing',
      },
      {
        control: 'Reference point location',
        detail:
          'A 3-by-3 grid of squares choosing the pivot, draggable in the document to move the transform origin. The reference point is hidden by default and must be shown from this control; transforms start from the object center until it is moved. THIS APP DIVERGES: No 3x3 grid for reference point selection. No draggable reference point in document.',
        status: 'missing',
      },
      {
        control: 'Rotation',
        detail:
          'Numeric text box, in degrees, for the rotation angle. The same angle is produced by dragging outside the bounding box, where Shift snaps to 15-degree increments. THIS APP DIVERGES: Implementation has rotate buttons (-90°, 180°, +90°) and rotation slider (-90 to 90), but NO numeric text field for rotation angle in degrees.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:218',
      },
      {
        control: 'H',
        detail:
          'Numeric text box, in degrees, for horizontal skew. Adobe names the field H: "To skew numerically, enter degrees in the H (horizontal skew) and V (vertical skew) text boxes in the options bar." The pair is absent from the bar when a Smart Object is the thing being transformed. THIS APP DIVERGES: Implementation has Skew X slider (-45 to 45) but NO numeric text field.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:239',
      },
      {
        control: 'V',
        detail:
          "Numeric text box, in degrees, for vertical skew — Adobe's V, the other half of the H/V pair above. THIS APP DIVERGES: Implementation has Skew Y slider (-45 to 45) but NO numeric text field.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:254',
      },
      {
        control: 'Trapezoid (app-only)',
        detail:
          'This is not a Photoshop Free Transform control. The app adds a projective Trapezoid slider from -85 to 85. Changing it resets rotation, mirroring, skew and scale to their defaults; changing any of those controls clears Trapezoid. The transforms are mutually exclusive in this panel.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:272',
      },
      {
        control: 'Switch Between Free Transform And Warp Modes',
        detail:
          "Button that swaps the box for a warp mesh, after which a Warp pop-up menu offers the predefined warp styles and a square handle adjusts the chosen one. THIS APP DIVERGES: No warp mode switch button. App has Trapezoid slider (-85 to 85) which is a projective transform not in Photoshop's main Free Transform.",
        status: 'missing',
      },
      {
        control: 'X',
        detail:
          'Numeric text box for the horizontal position of the transform reference point. It is the numeric form of dragging the item inside its own bounding box, and Adobe describes it as taking "values for the new location of the reference". THIS APP DIVERGES: No numeric field for reference point X position.',
        status: 'missing',
      },
      {
        control: 'Y',
        detail:
          "Numeric text box for the vertical position of that same reference point, paired with X; which of the two positionings they express is the Relative Positioning button's state. THIS APP DIVERGES: No numeric field for reference point Y position.",
        status: 'missing',
      },
      {
        control: 'Relative Positioning',
        detail:
          'Button that switches what the X and Y values mean: click it "to specify the new position in relation to the current position", so the pair becomes a measured displacement from where the item already is rather than a coordinate. THIS APP DIVERGES: No toggle for relative vs absolute reference point positioning.',
        status: 'missing',
      },
      {
        control: 'Commit',
        detail:
          'The checkmark that applies the transform. Enter works too — Adobe prints it as "Press Enter (Windows) or Return (macOS) to apply the transformation." A third route, clicking away from the transform controls once the pointer is a black arrow again rather than a handle cursor, is documented outside Adobe. Selecting a new tool commits the transform too. THIS APP DIVERGES: No explicit Commit button. Commits automatically on slider "change" event (pointer release) and discrete button clicks. Enter key not handled for commit.',
        status: 'missing',
      },
      {
        control: 'Cancel',
        detail:
          'The cancel button that abandons the transform and restores the original shape and size. Esc does the same. THIS APP DIVERGES: Only cancels via Escape key — no visible Cancel button in UI.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Transform/Transform.tsx:36',
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
      'src/tools/toolProcessors.ts:142',
      'src/contexts/useLayer.ts:552',
      'src/contexts/useLayer.ts:348',
      'toolbar-mapping.ts:189',
    ],
    appNotes:
      'Free Transform is a command, not a tool. The primary evidence is a negative one and it is a good one: a complete, version-stamped inventory of the Photoshop 2026 Tools panel lists every entry in the bar — Move, the marquees, the crop, the pen family, the type tools, the shape tools, Hand, Zoom — and has no Transform entry in it, while Photoshop reaches the operation through Edit > Free Transform or Cmd+T. Adobe\'s own routing agrees, sending a pixel layer to the Move tool with Show Transform Controls rather than to any transform tool. Note the shape of the menu, because it is two items and not one: Edit > Free Transform is a top-level Edit item, and Edit > Transform is a separate submenu carrying the six single modes — Scale, Rotate, Skew, Distort, Perspective and Warp. One counter-sentence exists on Adobe\'s marketing copy — "Select the Transform tool by pressing Ctrl + T (Cmd + T for Mac)" — but the very next clause of the same page is "You can also go to Edit > Free Transform": the page names the menu route itself, and uses "tool" for the interactive state rather than for a Tools-panel entry. The app reaches the same command from Edit > Free Transform, which is the route Adobe documents, so the route matches and the panel does not: it makes the panel in the options bar a different thing from Free Transform\'s bar, and the two should not be described as the same control set. Colors and Levels went the other way, out of the toolbar and into Image > Adjustments, because they are commands too; `extraTools` in toolbar-mapping.ts is the list of registered tool ids that deliberately carry no rail entry. What the app builds is a fixed-parameter panel for the Image > Transform operations — rotate 90 degrees left, 180 and 90 degrees right, a continuous rotation slider clamped to plus or minus 90, skew X and skew Y in plus or minus 45 degrees, scale X and Y in 10 to 300 percent, and horizontal and vertical flip — plus one projective operation the app calls Trapezoid (-85 to 85) which is not in Photoshop\'s Free Transform bar. No numeric text fields for W/H/X/Y/rotation/H/V, no Link icon, no reference point grid, no warp mode switch, no Commit button, Cancel only via Escape. The app\'s panel is a different control set from Photoshop\'s Free Transform bar.',
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
      'https://www.photoshopessentials.com/basics/free-transform',
      'https://www.peachpit.com/articles/article.aspx?p=3150375',
      'https://community.adobe.com/questions-712/horizontal-h-and-vertical-v-skew-fields-are-missing-in-the-options-bar-on-photoshop-cc-2019-1078402',
    ],
  },

  levels: {
    photoshopName: 'Levels — the Image > Adjustments command, not a Tools panel Tool',
    summary:
      "Photoshop's Levels remaps an image's tonal range through a histogram, a gamma pivot and per-channel black, white and output points.",
    purpose:
      'Levels is the tonal correction tool: it stretches or compresses where the image\'s darkest and lightest pixels land, and bends the midtones independently of the ends, which is what separates it from a brightness or contrast slider. The histogram above the controls is the working surface — you read where the data actually sits, then move the three input sliders until the blacks reach the black point, the whites the white point, and the middle slider makes the gamma adjustment that sets overall midtone brightness without crushing either end. Every move can be scoped to one color channel, which is how a cast gets removed rather than merely desaturated. The two routes are not equivalent, and Adobe says so: choosing Image > Adjustments > Levels "makes direct adjustments to the image layer and discards image information", while an adjustment layer stays editable.',
    options: [
      {
        control: 'Preset',
        detail:
          'Menu of saved settings, with Save Preset alongside it. Adobe states the round trip in one sentence and counts nothing: "You can save Levels settings as a preset, then apply them to other images." THIS APP DIVERGES: No preset menu or save preset functionality.',
        status: 'missing',
      },
      {
        control: 'Channel',
        detail:
          'Menu choosing the channel the adjustment applies to — RGB and the individual Red, Green and Blue channels, plus the channel combinations selected in the Channels panel, whose names the menu abbreviates ("CM for cyan and magenta", as Adobe puts it). RGB is the resting choice, a default Adobe does not state. Choosing a combination is unavailable in a Levels adjustment layer, which Adobe notes alongside the menu. THIS APP DIVERGES: No channel selector (RGB, Red, Green, Blue).',
        status: 'missing',
      },
      {
        control: 'Histogram',
        detail:
          'The graph of how pixels are distributed across tonal levels, drawn over the three input sliders as their backing track. It is the guide, not a control: reading it is how you decide where the black and white points belong, and Adobe says so — "drag the black and white Input Levels sliders to the edge of the first group of pixels at either end of the histogram." THIS APP DIVERGES: No histogram display.',
        status: 'missing',
      },
      {
        control: 'Input Levels: black point',
        detail:
          'Leftmost input slider, on the 0 to 255 level domain Adobe states for the adjustment, with a text box beside it for entering the level directly. It sits at level 0, which Adobe does not state as a default. Adobe prints the worked case itself, and it is the clipping case: "if you move the black point slider to the right at level 5, Photoshop maps all the pixels at level 5 and lower to level 0." THIS APP DIVERGES: No black point input slider (0-255).',
        status: 'missing',
      },
      {
        control: 'Input Levels: midtone gamma',
        detail:
          'Middle input slider, which "adjusts the gamma in the image" and "moves the midtone (level 128)" rather than either extreme. It sits at 1.00 by default, which Adobe does not state; moving it left makes the image lighter and right darker, and the pivot is the midpoint level between the output sliders, which is level 128 while they are at their defaults. THIS APP DIVERGES: No midtone gamma slider.',
        status: 'missing',
      },
      {
        control: 'Input Levels: white point',
        detail:
          'Rightmost input slider, with a text box beside it, sitting at level 255 by default, which Adobe does not state as a default. Adobe does print the worked case on this slider: "if you move the white point slider to the left at level 243, Photoshop maps all pixels at level 243 and higher to level 255." THIS APP DIVERGES: No white point input slider.',
        status: 'missing',
      },
      {
        control: 'Output Levels: black',
        detail:
          'Left output slider, the level the black point maps to, and its default is Adobe\'s: "By default, the Output sliders are at level 0, where the pixels are black, and level 255, where the pixels are white." The output pair is what the two input points are defined against, so moving it changes where black lands without touching where it is read from. THIS APP DIVERGES: No output levels black slider.',
        status: 'missing',
      },
      {
        control: 'Output Levels: white',
        detail:
          "Right output slider, default level 255, the level the white point maps to — the other half of Adobe's stated Output-slider defaults. THIS APP DIVERGES: No output levels white slider.",
        status: 'missing',
      },
      {
        control: 'Auto',
        detail:
          'Button that clips a small fraction of the shadows and highlights in every channel and maps the remaining extremes to pure black and pure white, as a starting point to refine by hand. Adobe states both halves of it: the domain is 0 to 255, and "By default, the Auto option and the Auto Tone command clip the white and black pixels by 0.1% — that is, it ignores the first 0.1% of either extreme." THIS APP DIVERGES: No Auto button.',
        status: 'missing',
      },
      {
        control: 'Auto Options',
        detail:
          'Entry in the Properties panel menu that opens the Auto Color Correction Options dialog, which chooses the algorithm Auto runs and sets the shadow and highlight clipping percentages; Alt-clicking (Windows) or Option-clicking (Mac OS) the Auto button opens the same dialog. Adobe states the route verbatim: "To experiment with other automatic adjustment options, choose Auto Options from the Properties panel menu, then change Algorithms in the Auto Color Corrections Options dialog box." Adobe\'s guidance for the Clip boxes is that a value between 0.0% and 1% is recommended. Three of the four algorithms are Adobe-named — Enhance Monochromatic Contrast, Enhance Per Channel Contrast and Find Dark & Light Colors — and the fourth, Enhance Brightness and Contrast, is third-party only; the dialog also has a Snap Neutral Midtones checkbox, which Adobe does name. THIS APP DIVERGES: No Auto Options dialog.',
        status: 'missing',
      },
      {
        control: 'Eyedroppers',
        detail:
          'Three eyedroppers — Set Black Point, Set Gray Point and Set White Point — that set each point by clicking the image. Using them discards any Levels adjustment already made, so Adobe advises using them first. The gray point one is for removing a color cast and is unavailable on grayscale images. THIS APP DIVERGES: No Set Black/Gray/White Point eyedroppers.',
        status: 'missing',
      },
      {
        control: 'Reset',
        detail:
          'Returns the adjustment to its original settings. Part of the adjustment panel rather than the tonal controls themselves, and listed here because it belongs to this adjustment. THIS APP DIVERGES: Reset button resets Brightness/Contrast sliders (0,0), not Levels controls. The panel is actually Brightness/Contrast, not Levels.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Levels/Levels.tsx:140',
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
          'Apply the Levels command. Cmd+Option+L re-applies it with the last settings used. Cmd+Shift+L is not a second Levels binding — it is Auto Tone.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/ToolbarsRight/Levels/Levels.tsx:110',
      'src/components/ToolbarsRight/Levels/Levels.tsx:86',
      'src/tools/levels.ts:12',
      'src/tools/functions.ts:160',
      'src/tools/settings.ts:56',
      'src/tools/toolProcessors.ts:133',
      'src/contexts/useLayer.ts:571',
      'src/contexts/useLayer.ts:348',
      'src/contexts/history-replay.ts:352',
      'src/contexts/layer-renderer.ts:18',
      'src/contexts/materialization.ts:84',
      'src/test/setup.ts:320',
      'toolbar-mapping.ts:189',
    ],
    appNotes:
      "FUNDAMENTAL MISMATCH: The app exposes Brightness/Contrast at Image > Adjustments > Brightness/Contrast; its internal tool id is `levels`, but it is NOT Photoshop's Levels command. Photoshop's Levels item is disabled in the app, and the app has no Levels histogram, channel selector, input or output controls, gamma control, Auto command, or eyedroppers. The app's Brightness/Contrast sliders use Adobe's documented ranges: Brightness -150 to +150 and Contrast -50 to +100. The neutral values emit `brightness(100%)` and `contrast(100%)`; the minimum Brightness value emits `brightness(0%)`, which maps normalized channel values to black. The implementation uses CSS `brightness()` and `contrast()` factors. CSS brightness multiplies normalized channel values, and CSS contrast applies a linear adjustment around mid-grey; filter output is clamped to the allowed color range. Factors above 1 can therefore clamp some channel values to black or white. This is the app's CSS mapping, not verified pixel parity with Photoshop: Adobe's current desktop Help page describes the slider ranges and qualitative effects but does not publish the default-mode transfer formula. A committed adjustment is retained as a layer operation and replayed by the renderer, but it is not re-editable; undo is the way to remove it after commit.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/levels-adjustment.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/color-corrections/apply-brightness-and-contrast-adjustment.html',
      'https://www.w3.org/TR/filter-effects-1/',
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

  invert: {
    photoshopName: 'Invert — the Image > Adjustments command, not a Tools panel Tool',
    summary:
      "Photoshop's Invert replaces every channel value with its inverse on the 256-step scale, turning the layer into its negative.",
    purpose:
      "Invert turns an image into its negative: each pixel's brightness in every channel is replaced by its inverse on the 256-step scale, so 255 becomes 0 and 5 becomes 250. It has no dialog and no settings, which is why it is bound to a single chord, Cmd+I. It is used as a creative effect and as a step in building masks, and it is the command that swaps the hidden and revealed areas of a selected layer mask. Chosen from Image > Adjustments it changes the layer's pixels directly; the non-destructive route is an Invert adjustment layer. With an active selection it inverts only the selected pixels.",
    options: [],
    modifiers: [],
    shortcuts: [
      {
        keys: 'Cmd+I',
        action: 'Apply Invert to the active layer, or to the selected pixels when a selection is active.',
      },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/tools/invert.ts:34',
      'src/tools/invert.ts:46',
      'src/tools/toolProcessors.ts:286',
      'src/hooks/useInvertLayer.ts:29',
      'src/components/Common/AdjustmentShortcuts.tsx:20',
      'src/components/DesktopHeader/DesktopHeader.tsx:258',
      'toolbar-mapping.ts:247',
    ],
    appNotes:
      "Invert is a one-shot command here as in Photoshop: Image > Adjustments > Invert and Cmd+I both call the same command, which commits one raster history state and never becomes the current tool, so it has no options bar and no rail tile. Alpha is left as it is; only the colour channels are inverted. An active selection clips the inversion, and a feathered or anti-aliased edge blends each pixel toward its inverse by its selection coverage rather than stepping. Two differences from Photoshop are deliberate. First, the command refuses the bedrock layer, which is the document's backing image and which no raster edit in this app targets; Photoshop inverts its Background layer. Second, there are no adjustment layers and no layer masks, so the Invert adjustment layer and inverting a selected mask have nothing to act on. While another tool's live preview (Levels, Color, Free Transform) is still uncommitted on the layer, Invert does nothing rather than discard that preview; switching tools commits it.",
    sources: [
      'https://helpx.adobe.com/ca/photoshop/using/applying-special-color-effects-images.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://community.adobe.com/questions-712/where-is-the-invert-command-1172919',
      'https://www.adobe.com/products/photoshop/invert-mask.html',
    ],
  },

  color: {
    photoshopName: 'Black & White — the Image > Adjustments command, not a Tools panel Tool',
    summary:
      "Photoshop's Black & White converts a color image to monochrome with six hue-sextant sliders, optionally tinted with a tone color.",
    purpose:
      'Black & White is not a desaturation — it is a weighted mix, and the six sliders are the weights. Each of the six sextants of the color wheel, Reds, Yellows, Greens, Cyans, Blues and Magentas, gets its own control over how bright that family of hues becomes in the result, so a landscape can have a dark sky and a bright sky in the same conversion, and skin can be lifted without touching the greens. Every slider starts at a value that reproduces a conventional conversion — Photoshop opens the adjustment having already applied "a default grayscale conversion to your image" — and dragging one away from that value is the whole technique. Ticking Tint lays a uniform tone color over the monochrome so it reads as toned rather than neutral, which is how a sepia or a split-tone is made from a color original without going back to it.',
    options: [
      {
        control: 'Preset',
        detail:
          'Menu of predefined grayscale mixes and of any mix the user has saved, with Save Black & White Preset alongside it. THIS APP DIVERGES: No preset menu for Black & White mixes.',
        status: 'missing',
      },
      {
        control: 'On-image adjustment icon',
        detail:
          'The Targeted Adjustment tool, sitting directly under the Preset option at the top of the panel. Adobe states the gesture as a drag of the icon itself: "Select and drag On-image adjustment icon onto the image to adjust tones." It moves the sextant slider for whichever family of hues dominates the pixels under the cursor, and that one slider moves every area containing those hues rather than a mark you place. THIS APP DIVERGES: No targeted adjustment tool.',
        status: 'missing',
      },
      {
        control: 'Auto',
        detail:
          'Sets a grayscale mix based on the values in the image itself — Adobe\'s own words are "Set a grayscale mix based on your image\'s color values" — so it reads the layer rather than asking you to weight six families by hand. THIS APP DIVERGES: No Auto button for automatic grayscale mix.',
        status: 'missing',
      },
      {
        control: 'Tint',
        detail:
          'Checkbox that lays a uniform tone color over the monochrome result, which is what turns a neutral conversion into a toned or sepia one. THIS APP DIVERGES: No Tint checkbox.',
        status: 'missing',
      },
      {
        control: 'Tint Color',
        detail:
          'The color swatch beside the Tint checkbox. Choosing it opens the Color Picker, and the tone applied is called Tint Color. THIS APP DIVERGES: No tint color swatch/picker.',
        status: 'missing',
      },
      {
        control: 'Color sliders',
        detail:
          'Six sliders, one per sextant of the color wheel, in the order Reds, Yellows, Greens, Cyans, Blues, Magentas. Each sets how bright that family of hues renders in the monochrome. Adobe\'s own page names the block and nothing inside it — "Color sliders: Drag sliders to adjust gray tones for specific colors" — so both the six family names and their order are third-party, as are their resting values: the default of 40, 60, 40, 60, 20 and 80 is documented, but the pages that print it print only the first three, "Reds set to 40%, Yellows set to 60%, and so on". THIS APP DIVERGES: No Reds, Yellows, Greens, Cyans, Blues, Magentas sliders. No per-hue weighting anywhere.',
        status: 'missing',
      },
      {
        control: 'Reset',
        detail:
          "The reset icon that returns the sliders to their default values, and more generally the panel control that returns the adjustment to its original settings. THIS APP DIVERGES: Reset button resets Grayscale/Sepia/Saturation, not Black & White sextant sliders. Disabled unless uncommitted preview is live; restores panel's own defaults rather than sextant defaults.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Colors/Color.tsx:185',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'Shift+Cmd+Opt+B',
        action:
          'Open the Black & White command. Printed by Adobe\'s shipped shortcut sheet as "Black & White... Opt+Shift+Cmd+B" on macOS, and Ctrl+Alt+Shift+B on Windows; the app binds no shortcut for it.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/ToolbarsRight/Colors/Color.tsx:134',
      'src/components/ToolbarsRight/Colors/Color.tsx:110',
      'src/tools/colors.ts:12',
      'src/tools/functions.ts:60',
      'src/tools/settings.ts:55',
      'src/tools/toolProcessors.ts:127',
      'src/contexts/useLayer.ts:571',
      'src/contexts/useLayer.ts:348',
      'src/contexts/history-replay.ts:352',
      'src/contexts/layer-renderer.ts:16',
      'src/contexts/materialization.ts:78',
      'src/test/setup.ts:320',
      'toolbar-mapping.ts:189',
    ],
    appNotes:
      "FUNDAMENTAL MISMATCH: Black & White is an Image > Adjustments command, or an adjustment layer — not a toolbar tool — so it has no rail entry, and the app reaches the same three CSS filters from Image > Adjustments > Desaturate, which is the Adobe command the bar's grayscale slider actually computes. That name is a bounded divergence rather than a match: sepia and saturation are controls Desaturate does not have. Adobe's Photo Filter is a separate command in the same submenu and it is a disabled item, because it is a lens filter with a Density slider and a Preserve Luminosity option and this bar reproduces none of those. No control of Photoshop's seven is reproduced, and the three sliders that are rendered are not Black & White controls: there is no sextant weighting anywhere in the app, so no per-hue decision can be made and the conversion is a flat luminance desaturation rather than a mix. The one control whose name the app shares is Reset, and it does not behave as Photoshop's does: it is disabled unless an uncommitted preview is live, and it restores that panel's own defaults rather than the sextant defaults, so a committed conversion can only be undone. The grayscale slider is the nearest thing to the whole panel and it is the one control that cannot stand in for it, because a hue-weighted mix and a luminance average differ the moment any of the six families is pushed. Sepia is not the Tint checkbox either: Tint lays a uniform tone color over a conversion whose mix you still control, and applying sepia is a second filter stage that tints the whole image rather than replacing its channel weights, so the two can be combined and the result is not the same look. Saturation belongs to no part of Black & White; it is a Hue/Saturation control, and the fact that this app has one is a leftover from the identity question this tool's shape was chosen to answer. Presets, Auto, Tint, Tint Color, the on-image adjustment icon and the six sliders are all absent. As with Levels, the engine is CSS filters (grayscale, sepia, saturate) not a per-hue mixer.",
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
      'https://training-nyc.com/legacy/photoshop_cs6_all_keyboard_shortcuts_sheet.pdf',
    ],
  },
};

// The options-bar contract above is Photoshop's. Keep the app-specific Move note precise about
// the shape-layer exception: rotation handles exist for rotatable shapes, not ordinary layers.
transformDescriptions.reposition.appNotes = [
  'The app moves and resizes through a custom surface, not Photoshop’s Move options-bar controls. Auto-Select: Layer is effectively always on; there is no Group/Layer selector, Show Transform Controls checkbox, alignment/distribution group or align target. The overlay is a resize rectangle for ordinary layers; when the active layer is a rotatable shape, `activeLayerSupportsRotation` enables rotation handles through `useRect.rotationEnabled`. Numeric W/H, reference point and Photoshop’s transform-field bar are absent.',
  'Arrow keys nudge the active unlocked non-bedrock layer by one document pixel, or ten with Shift, when no selection is active. Alt-drag duplication, Shift-axis constraint and Shift-click-to-extend are not implemented.',
].join(' ');
