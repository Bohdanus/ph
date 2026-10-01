import type { ToolDescription } from './types.ts';

export const selectionDescriptions: Record<
  | 'rectangular-selection'
  | 'elliptical-selection'
  | 'single-row-marquee'
  | 'single-column-marquee'
  | 'freehand-lasso'
  | 'polygonal-lasso'
  | 'feather-magnetic-lasso'
  | 'magic-wand'
  | 'quick-selection',
  ToolDescription
> = {
  'rectangular-selection': {
    photoshopName: 'Rectangular Marquee Tool',
    summary: 'Drag a rectangular selection; Shift makes it a square, Alt grows it outward from the press point.',
    purpose:
      'The Rectangular Marquee tool makes the simplest selection in Photoshop: drag corner to corner and the area inside the animated border is selected. It is the tool for pixel-exact rectangular work — a swatch, a rectangular adjustment region, a crop of flat geometry — and every other selection tool is a variation on it. Its options bar carries the four selection combination modes, a Feather radius, and a Style dropdown that can lock the drag to a fixed ratio or a fixed size. Because a selection is a pixel channel, the combination modes and the feather are properties of the selection itself, not of the shape you drew.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next drag combines with the selection already on the canvas: replace it, union with it, subtract it, or keep only the overlap. They are options-bar state rather than a separate object, and Shift, Alt/Option and Shift+Alt/Option held during the drag set the same four modes.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail:
          'Softens the border over a radius in pixels, default 0, and must be set before the selection is made. The scripting API takes the same value as 0 to 1000 pixels on this tool, and exposes an antiAlias flag defaulting to true for the same call even though the marquee bar does not show an Anti-alias box.',
        status: 'missing',
      },
      {
        control: 'Style',
        detail:
          'Normal, Fixed Ratio or Fixed Size. Normal takes its proportions from the drag; Fixed Ratio locks the drag to a height-to-width ratio entered as two decimal fields; Fixed Size ignores the drag and takes its height and width from two pixel fields. In Normal the numeric fields are greyed out.',
        status: 'missing',
      },
      {
        control: 'Width and Height',
        detail:
          'The two fields behind Fixed Ratio and Fixed Size. Fixed Ratio accepts decimals and is a pair, not a single ratio number, so a 2:1 box is entered as 2 in one field and 1 in the other. Fixed Size takes whole pixels, and both styles accept document units such as inches or centimetres alongside pixels.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Constrains the drag to a square. The mouse button must be released before Shift, or the constraint is lost.',
      },
      { keys: 'Alt', action: 'Draws the marquee outward from the press point instead of between two corners.' },
      { keys: 'Shift+Alt', action: 'Constrains to a square drawn outward from the center.' },
    ],
    shortcuts: [
      {
        keys: 'M',
        action:
          'Selects the Rectangular Marquee. All four marquee tools share M, so pressing it again re-selects this one rather than cycling; Shift+M is the cycling key.',
      },
      {
        keys: 'Shift+M',
        action: 'Switches between the marquee tools, which Adobe lists as "Switch between marquee tools".',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/rectangularSelection.ts:4',
      'src/tools/settings.ts:130',
      'src/components/ToolbarsRight/RectangularSelection/RectangularSelection.tsx:33',
      'src/components/Main/RectangularSelectionToolArea.tsx:74',
      'src/hooks/useRect.ts:400',
      'src/hooks/useRect.ts:314',
      'toolbar-mapping.ts:41',
    ],
    appNotes:
      'The tool draws, commits and copies a rectangle, and its options bar renders only a static sentence plus Copy, Paste and Clear. It declares no settings of its own at all, so all five Photoshop controls in the table above are absent rather than inert. All three modifiers above ARE implemented, and were before this pass — an earlier version of this record said they were not, which was wrong: it read `useRect` as consulting Shift only inside `getEdgeAtPoint`, which is the HANDLE RESIZE path. The fresh-drag path is separate and opt-in. `RectangularSelectionToolArea.tsx:74`-`:75` passes `constrainToSquare: true` and `fromCentre: true`, `sampleFreshDragModifiers` reads `event.shiftKey` and `event.altKey` per pointer event into a ref (`src/hooks/useRect.ts:400`-`:403`), and `adjustFreshPoint` (`:314`-`:329`) applies them, taking the square on the radius per axis BEFORE mirroring the drag so that Shift+Alt is a square centred on the press point. Sampling per event rather than at press time means Shift pressed halfway through a drag takes hold immediately, and the release governs the committed rect (`:502`). A handle RESIZE is deliberately untouched: the modifier that locks a resize is still the aspect ratio `getEdgeAtPoint` captures (`:156`-`:158`). The `M` key and Shift+M reach this tool and cycle all four marquees Adobe documents, which this app now ships; the two 1-pixel members sit behind that same key, in the same flyout this tool leads. Nothing here can feather an existing selection, inverse it, or grow it: there is no Select-menu surface anywhere in the application.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/rectangular-marquee-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/',
    ],
  },

  'elliptical-selection': {
    photoshopName: 'Elliptical Marquee Tool',
    summary:
      'Drag an elliptical selection; Shift makes a circle, Alt draws from the center, Style locks ratio or size.',
    purpose:
      'The Elliptical Marquee tool is the Rectangular Marquee with one addition: an Anti-alias checkbox, which is the only marquee tool that offers it, because a curved edge is the only one that visibly stair-steps. Drag corner to corner for an ellipse, hold Shift for a circle, hold Alt for one that grows from its center. It shares the Rectangular Marquee’s Style dropdown, so a circle of a fixed diameter or an ellipse of a fixed ratio can be stamped with a single click. This description is of Photoshop 2023 through 2026; the control set has not changed in that window.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next drag combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the drag set the same four modes.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail: 'Softens the border over a radius in pixels, default 0, and must be set before the selection is made.',
        status: 'missing',
      },
      {
        control: 'Anti-alias',
        detail:
          'On by default. Smooths the stair-stepped edge of a curve with intermediate coverage values. The scripting API exposes an antiAlias flag defaulting to true on the same call that takes the feather, so the default is the documented one even on a tool whose bar hides the box.',
        status: 'missing',
      },
      {
        control: 'Style',
        detail:
          'Normal, Fixed Ratio or Fixed Size. Normal takes its proportions from the drag; Fixed Ratio locks the drag to a height-to-width ratio; Fixed Size ignores the drag entirely and takes its height and width from two pixel fields, so a single click is a complete gesture.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:98',
      },
      {
        control: 'Width and Height',
        detail:
          'The two fields behind Fixed Ratio and Fixed Size. Fixed Ratio is a pair of decimal fields, so a box twice as wide as it is high is entered as 2 and 1; Fixed Size takes whole pixels. Both accept document units such as inches or centimetres alongside pixels.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:116',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
        status: 'missing',
      },
    ],
    modifiers: [
      { keys: 'Shift', action: 'Constrains the drag to a circle.' },
      { keys: 'Alt', action: 'Draws the marquee outward from the press point instead of between two corners.' },
      { keys: 'Shift+Alt', action: 'Constrains to a circle drawn outward from the center.' },
    ],
    shortcuts: [
      {
        keys: 'M',
        action:
          'Selects the Elliptical Marquee. All four marquee tools share M, so pressing it again re-selects this one rather than cycling; Shift+M is the cycling key.',
      },
      {
        keys: 'Shift+M',
        action: 'Switches between the marquee tools, which Adobe lists as "Switch between marquee tools".',
      },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/tools/ellipticalSelection.ts:155',
      'src/tools/ellipticalSelection.ts:51',
      'src/tools/settings.ts:220',
      'src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:98',
      'src/components/Main/EllipticalSelectionToolArea.tsx:176',
      'src/components/Main/EllipticalSelectionToolArea.tsx:247',
      'toolbar-mapping.ts:42',
    ],
    appNotes:
      'The tool is the most complete of the selection family and the only one whose options bar has any Photoshop control on it, and every geometry behaviour Photoshop defines for it is implemented: Shift is read as constrainToCircle, Alt as fromCentre, and fixed-size ignores the drag and takes the press point only as the centre, so a click is a complete gesture. What it renders that Photoshop’s does not is the shape of the fields. Fixed Ratio is a single Ratio field rather than Photoshop’s pair of decimal Width and Height fields — but the ratio itself is the one Adobe states, because Photoshop’s worked example enters 2 for the width and 1 for the height, which is a width-to-height ratio and exactly what the app computes (`src/tools/ellipticalSelection.ts:121`-`:131`, and the bar’s hint reads `Drag at N:1` at `src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:90`). What that costs is expressiveness, not fidelity: the app’s floor is 0.05, where a pair of decimal fields can go as low as the keyboard allows, and its ceiling is 20. Fixed Size renders plain pixel number inputs, so the document-unit entry Photoshop accepts cannot be typed. The committed polygon is a sagitta-bounded inscribed ring rather than a true ellipse, because the data model holds a point path and cannot hold a curve; the bound is the app’s own choice rather than one Photoshop shares. The ellipse commits under a borrowed source-tool identifier because the selection union in the app’s own types has no elliptical member, which is why the committed ellipse carries no draggable anchor handles. What the app computes is what Photoshop computes, in every case: the two field shapes are recorded as `partial` on the controls themselves rather than here, and the one place the committed document differs from Photoshop’s is the inscribed polygon, whose chord error is bounded to a quarter of a pixel and derived from the radius — several times smaller than the anti-aliased edge this tool does not draw at all, since `Anti-alias` is `missing` above. On that reading the tool is scored `implemented` rather than `partial`; the argument, and the case against it, are in `selection.notes.md`.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/elliptical-marquee-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/',
    ],
  },

  'single-row-marquee': {
    photoshopName: 'Single Row Marquee Tool',
    summary: 'Click or drag to select one document row, one pixel tall and as wide as the image.',
    purpose:
      'The Single Row Marquee tool makes the narrowest selection Photoshop offers: one row of pixels, one pixel tall, spanning the entire width of the image. It is a one-click tool — "click near the area you want to select, and then drag the marquee to the exact location" — so the gesture is a placement rather than a shape, and the drag exists only to position the row that was clicked. Its counterpart is the Single Column Marquee tool, which is the same gesture on the other axis. Together they are how you isolate a scanline for a colour lookup, or seed an adjustment to one row.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next click combines with the selection already on the canvas: replace it, union with it, subtract it, or keep only the overlap. Adobe states the step without scoping it to a tool, so these tools carry the four modes, and Shift, Alt/Option and Shift+Alt/Option held during the click set the same four.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail:
          'Softens the border over a radius in pixels, default 0. Adobe applies the step to the marquee tools generally, but a control that cannot soften a 1-pixel band has no effect, and the scripting API is the sharper evidence: selectRow takes neither a feather nor an antiAlias parameter where selectRectangle takes both.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush, a plain Brush, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Sets the click to Add to Selection. Adobe carves single row and single column out of the marquee geometry modifiers by name — "Any marquee tool (except single column and single row)" — which leaves Shift to the selection mode it is bound to for every other selection tool.',
      },
      {
        keys: 'Alt',
        action: 'Sets the click to Subtract From Selection, for the same reason Shift is Add.',
      },
      {
        keys: 'Shift+Alt',
        action:
          'Sets the click to Intersect With Selection. Adobe lists Shift+Alt twice for marquee tools — once as a geometry constraint and once as Intersect — and only the Quick Selection tool is excluded from the Intersect row, so on a 1-pixel row the selection meaning is the live one and the geometric one is inapplicable.',
      },
    ],
    shortcuts: [
      {
        keys: 'M',
        action:
          'Does not reach this tool directly. Adobe’s default-shortcut table assigns M to the Rectangular and Elliptical Marquees only, and no published source gives either 1-pixel tool a key of its own.',
      },
      {
        keys: 'Shift+M',
        action:
          'Reaches this tool in this application, because the cycle is over the whole marquee group. Adobe publishes "Switch between marquee tools — SHIFT+M" without enumerating which tools the cycle covers, and third-party sources disagree on whether the 1-pixel pair is inside it. See selection.notes.md.',
      },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/tools/singleRowColumnMarquee.ts:81',
      'src/components/Main/SingleRowColumnMarqueeToolArea.tsx:126',
      'src/components/ToolbarsRight/SingleRowColumnMarquee/SingleRowColumnMarquee.tsx:38',
      'src/tools/toolProcessors.ts:228',
      'toolbar-mapping.ts:48',
    ],
    appNotes:
      'The gesture is implemented in full: a click commits the row under the press, a drag positions it, the row is exactly one document pixel tall and spans the full document width, and a press inside the committed row moves it — the press-inside-moves behaviour every other selection tool here has, narrowed to a 1-pixel hit target. The row is chosen by flooring the pointer position and clamping it into the document, which is this application’s documented answer to a case Adobe leaves open: its scripting API requires the coordinate to be within the document height and publishes no GUI behaviour for a press outside the canvas, and rejecting the press would silently do nothing where a marquee flyout neighbour accepts the same press. No option above is rendered, and that is a statement about Photoshop rather than a shortcut: Adobe scopes Anti-alias to the Elliptical Marquee and Style, Fixed Ratio and Fixed Size to the Rectangular and Elliptical Marquees by name, so this bar has no control of its own to render. The four selection modes and Feather are `missing` because they are absent for every selection tool in the application, not because they were skipped here, and adding them to the two newest tools and not to the other five would be a worse inconsistency than the one that exists. The committed selection carries the borrowed source-tool identifier `rectangular-selection` because the app’s `SelectionSourceTool` union has no member for either 1-pixel tool; the geometry really is a rectangle, and widening that union is a separate change with its own blast radius.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/adjust-a-selection-manually.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/selection/',
    ],
  },

  'single-column-marquee': {
    photoshopName: 'Single Column Marquee Tool',
    summary: 'Click or drag to select one document column, one pixel wide and as tall as the image.',
    purpose:
      'The Single Column Marquee tool is the Single Row Marquee tool on the other axis: one column of pixels, one pixel wide, spanning the entire height of the image, placed by a click and positioned by an optional drag. It exists for the same reasons its counterpart does — isolating a scanline in the other direction, or seeding an adjustment to one column — and it shares its options bar, because Adobe gives the two tools the same controls.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next click combines with the selection already on the canvas. Adobe states the step without scoping it to a tool, and Shift, Alt/Option and Shift+Alt/Option held during the click set the same four.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail:
          'Softens the border over a radius in pixels, default 0. A control that cannot soften a 1-pixel band has no effect, and the scripting API is the sharper evidence: selectColumn takes neither a feather nor an antiAlias parameter where selectRectangle takes both.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush, a plain Brush, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Sets the click to Add to Selection. Adobe carves single row and single column out of the marquee geometry modifiers by name — "Any marquee tool (except single column and single row)" — which leaves Shift to the selection mode it is bound to for every other selection tool.',
      },
      {
        keys: 'Alt',
        action: 'Sets the click to Subtract From Selection, for the same reason Shift is Add.',
      },
      {
        keys: 'Shift+Alt',
        action:
          'Sets the click to Intersect With Selection. Adobe lists Shift+Alt twice for marquee tools — once as a geometry constraint and once as Intersect — and only the Quick Selection tool is excluded from the Intersect row.',
      },
    ],
    shortcuts: [
      {
        keys: 'M',
        action:
          'Does not reach this tool directly. Adobe’s default-shortcut table assigns M to the Rectangular and Elliptical Marquees only, and no published source gives either 1-pixel tool a key of its own.',
      },
      {
        keys: 'Shift+M',
        action:
          'Reaches this tool in this application, because the cycle is over the whole marquee group. Adobe publishes "Switch between marquee tools — SHIFT+M" without enumerating which tools the cycle covers, and third-party sources disagree on whether the 1-pixel pair is inside it. See selection.notes.md.',
      },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/tools/singleRowColumnMarquee.ts:94',
      'src/components/Main/SingleRowColumnMarqueeToolArea.tsx:126',
      'src/components/ToolbarsRight/SingleRowColumnMarquee/SingleRowColumnMarquee.tsx:38',
      'src/tools/toolProcessors.ts:235',
      'toolbar-mapping.ts:49',
    ],
    appNotes:
      'The gesture is implemented in full: a click commits the column under the press, a drag positions it, the column is exactly one document pixel wide and spans the full document height, and a press inside the committed column moves it. This tool and its counterpart share one processor, one tool area and one options bar, because their Photoshop option sets are identical to each other and differ from the other marquees only in controls neither of them has; the one visible difference is a word in the bar’s sentence. The column is chosen by flooring the pointer position and clamping it into the document, which is this application’s documented answer to a case Adobe leaves open: its scripting API requires the coordinate to be within the document width and publishes no GUI behaviour for a press outside the canvas, and rejecting the press would silently do nothing. No option above is rendered, and the four selection modes and Feather are `missing` because they are absent for every selection tool in the application rather than skipped here. The committed selection carries the borrowed source-tool identifier `rectangular-selection` because the app’s `SelectionSourceTool` union has no member for either 1-pixel tool; the geometry really is a rectangle.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/adjust-a-selection-manually.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/selection/',
    ],
  },

  'freehand-lasso': {
    photoshopName: 'Lasso Tool',
    summary: 'Drag a freehand selection border that goes exactly where the cursor goes and closes itself on release.',
    purpose:
      'The Lasso tool draws a selection border by following the pointer with no correction of any kind: wherever you drag is where the selection is. That makes it the right tool for cleaning up an edge another tool got roughly right, and the wrong one for a first attempt at a precise boundary. Releasing the mouse closes the border, and Photoshop bridges a small gap between the end point and the start point rather than leaving the region open. It produces a selection only, never a reusable path; converting a selection into a path is a separate command, and the path direction is the other way round.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next drag combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the drag set the same four modes.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail:
          'Softens the border over a radius in pixels, default 0, and must be set before the selection is made. This is the same control the marquee tools carry, and the same feather that Select > Modify > Feather applies afterwards.',
        status: 'missing',
      },
      {
        control: 'Anti-alias',
        detail:
          'On by default, and documented as selected by default on this tool. Smooths the jagged edge a freehand trace leaves behind.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
        status: 'missing',
      },
    ],
    modifiers: [
      { keys: 'Shift', action: 'Sets the drag to Add to Selection for the duration of the gesture.' },
      { keys: 'Alt', action: 'Sets the drag to Subtract From Selection.' },
      {
        keys: 'Alt',
        action:
          'Held after the drag has started, converts the trailing segment to a straight edge between the two points; releasing the mouse while it is held leaves the border open.',
      },
      { keys: 'Shift+Alt', action: 'Sets the drag to Intersect With Selection.' },
      { keys: 'Space', action: 'Temporarily switches to the Hand tool so the image can be panned mid-trace.' },
    ],
    shortcuts: [
      {
        keys: 'L',
        action:
          'Selects the Lasso. All three lasso tools share L, so pressing it again re-selects this one rather than cycling; Shift+L is the cycling key.',
      },
      {
        keys: 'Shift+L',
        action: 'Cycles between the Lasso, Polygonal Lasso and Magnetic Lasso tools.',
      },
      {
        keys: 'Return',
        action:
          'Selects the tool and moves focus to the Feather field in the options bar, so a feather can be typed before the next trace.',
      },
      { keys: 'Delete', action: 'Erases recently drawn straight segments during a trace.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/polygonSelection.ts:3',
      'src/tools/settings.ts:104',
      'src/components/ToolbarsRight/Lasso/FreehandLasso.tsx:50',
      'toolbar-mapping.ts:45',
    ],
    appNotes:
      'The tool traces a closed loop and commits it, and its bar renders Copy, Paste and Clear beside a single toggle. That toggle is the app’s own control and has no Photoshop counterpart: it is labelled Mode in the bar but switches between Outline and Fill, which changes how the committed border is painted rather than how a new gesture combines with the existing selection. The app therefore has no Photoshop control on this bar at all, and no combination modes. The LassoToolArgs type carries alpha, lineWidth, color and fill, none of which Photoshop puts on this tool’s bar. None of the modifiers above is read: the freehand lasso is drawn by the same PolygonClickToolArea as the polygonal one, and neither that component nor anything else on the lasso path consults a modifier key, so the Shift/Alt/Shift+Alt rows describe Photoshop only. The Return row is not bound either — the app registers Escape, Enter, Backspace and Delete on this tool’s own gesture and nothing else (`src/components/Main/PolygonClickToolArea.tsx:922`), so the focus-the-Feather-field binding and the mid-trace Space-to-Hand binding above are Photoshop bindings with no counterpart here, while the Delete row is bound to the same registration that pops the last point of the trace.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/lasso-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/web/edit-images/make-selections/create-selections-with-lasso-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html',
      'https://www.adobe.com/products/photoshop/lasso-tool.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html',
    ],
  },

  'polygonal-lasso': {
    photoshopName: 'Polygonal Lasso Tool',
    summary:
      'Click to lay straight-edged anchors around a shape, then click the first anchor, double-click, or press Enter to close.',
    purpose:
      'The Polygonal Lasso tool draws a selection border out of straight segments, which is the right tool for anything with corners: a building edge, a piece of type, a flat geometric shape. You do not hold the mouse button down; you click to add a corner anchor, move, and click again. Closing the border is explicit and has four ways in: click the starting anchor, Ctrl-click on Windows or Command-click on Mac OS, double-click, or press Enter or Return, the last of which closes with a segment the tool finds rather than a straight one. Clicking the mouse down and dragging instead of clicking lays a curved segment, and holding Alt/Option while dragging draws a freehand segment between two clicked points. This description is of Photoshop 2023 through 2026.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next set of anchors combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the gesture set the same four modes.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail: 'Softens the border over a radius in pixels, default 0, and must be set before the selection is made.',
        status: 'missing',
      },
      {
        control: 'Anti-alias',
        detail:
          'On by default, and documented as selected by default on the lasso tools. Has no visible effect on straight segments, and smooths the freehand segments Alt-drag can insert.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Held while dragging, draws a freehand segment between the last anchor and the next one; releasing Alt and the mouse button returns the tool to straight segments.',
      },
      {
        keys: 'Alt',
        action:
          'Double-clicking while Alt is held closes the border with a straight segment rather than a magnetic one.',
      },
      {
        keys: 'Shift',
        action: 'Draws a straight line at a multiple of 45°, held as you move to select the next segment.',
      },
      { keys: 'Shift', action: 'Sets the gesture to Add to Selection.' },
      { keys: 'Alt', action: 'Set as the combination mode, sets the gesture to Subtract From Selection.' },
      { keys: 'Shift+Alt', action: 'Sets the gesture to Intersect With Selection.' },
    ],
    shortcuts: [
      {
        keys: 'L',
        action:
          'Selects the Polygonal Lasso. All three lasso tools share L, so pressing it again re-selects this one rather than cycling; Shift+L is the cycling key.',
      },
      {
        keys: 'Shift+L',
        action: 'Cycles between the Lasso, Polygonal Lasso and Magnetic Lasso tools.',
      },
      {
        keys: 'Return',
        action:
          'Closes the border with a segment the tool finds, or moves focus to the Feather field when no border is open.',
      },
      { keys: 'Delete', action: 'Erases the most recently drawn straight segments, one at a time.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/polygonSelection.ts:3',
      'src/tools/settings.ts:96',
      'src/components/ToolbarsRight/Lasso/PolygonalLasso.tsx:16',
      'src/components/Main/PolygonClickToolArea.tsx:922',
      'toolbar-mapping.ts:46',
    ],
    appNotes:
      'The click-to-add-anchor gesture, the double-click close, the right-click close, the Enter close, the Delete anchor removal and the Escape abort are all implemented, which makes this the most faithful of the seven. Its options bar, however, is the thinnest component in the family: forty lines rendering one app-invented Outline/Fill toggle and a hint sentence, and — unlike the freehand and magnetic lasso bars beside it — no Copy, Paste or Clear buttons. It shares LassoToolArgs with the freehand lasso, so none of the four Photoshop controls in the table above has a field to live in. None of the modifiers above is read either. The component that draws this tool (`src/components/Main/PolygonClickToolArea.tsx`, which serves the freehand lasso too) consults no modifier key at all, so every one of those rows — the 45° constraint, the Alt-drag freehand segment, the Alt-double-click straight close, and the three combination modes — describes Photoshop and is not implemented here. Of the shortcuts above, `Enter` and `Delete` are bound on this tool’s own gesture (`src/components/Main/PolygonClickToolArea.tsx:931` and `:952`); `Enter` is the key the app registers for the close that the table above calls Return, while the row’s second half, focus moving to a Feather field when no border is open, is not bound, because this bar has no Feather field to focus. Feathering is where the app is narrowest: no selection tool’s bar carries a Feather field except the magnetic lasso’s, re-making a selection with this tool applies no feather of any kind, and with no `Select > Modify > Feather` and no Refine Edge a committed border can never be softened after the fact. The magnetic lasso is the family’s only feathered path, and even there the value is written into the selection’s metadata at commit and read back when the selection is copied (`src/util/selection.ts:836`-`:837`), so it softens the copied mask and not the selection the ants are drawn from.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/polygonal-lasso-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html',
      'https://www.photoshopessentials.com/basics/selections/polygonal-lasso-tool',
      'https://helpx.adobe.com/photoshop/web/edit-images/make-selections/create-selections-with-lasso-tool.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html',
    ],
  },

  'feather-magnetic-lasso': {
    photoshopName: 'Magnetic Lasso Tool',
    summary:
      'Click a starting point and the border snaps to the strongest image edge within Width as you move the pointer.',
    purpose:
      'The Magnetic Lasso tool is an edge detector you drive by hand. You click once to set a fastening point, then move the pointer along the object and the live segment snaps to the strongest edge it can find within the detection Width, laying down extra fastening points at the Frequency interval to anchor what it has already traced. A click adds a manual fastening point where the automatic ones guessed wrong, and closing on the start point finishes the loop. It is the fastest way to select a well-defined object against a high-contrast background, and it is unavailable on 32-bits-per-channel images. This description is of Photoshop 2023 through 2026.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next trace combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the trace set the same four modes.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail: 'Softens the border over a radius in pixels, default 0, and must be set before the selection is made.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:272',
      },
      {
        control: 'Anti-alias',
        detail: 'On by default. Smooths the traced edge with intermediate coverage values where it is copied out.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:351',
      },
      {
        control: 'Width',
        detail:
          'The detection width in pixels, entered as a value rather than chosen from a list. The tool detects edges only within that distance of the pointer, and Caps Lock swaps the pointer for a circle of exactly that size. The left and right bracket keys change it by one pixel while the tool is tracing.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:285',
      },
      {
        control: 'Contrast',
        detail:
          'The lasso’s sensitivity to edges, entered as a percentage from 1% to 100%. A higher value detects only edges that contrast sharply with their surroundings; a lower value detects lower-contrast edges. The comma and period keys change it while the tool is tracing.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:298',
      },
      {
        control: 'Frequency',
        detail:
          'The rate at which the lasso sets fastening points, from 0 to 100. Adobe states it as "A higher value anchors the selection border in place more quickly"; that a higher value also lays fastening points down more densely is the third-party reading this description’s inversion finding rested on, not Adobe’s wording.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:311',
      },
      {
        control: 'Stylus Pressure',
        detail:
          'A checkbox that narrows the detection width as stylus pressure increases, so the tool is more precise where you press harder. Shown only when a tablet is in use.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action: 'Draws a freehand segment instead of a snapping one; released, the tool resumes snapping.',
      },
      {
        keys: 'Alt',
        action:
          'Double-clicking while Alt is held closes the border with a straight segment rather than a magnetic one.',
      },
      { keys: 'Shift', action: 'Sets the trace to Add to Selection.' },
      { keys: 'Alt', action: 'Set as the combination mode, sets the trace to Subtract From Selection.' },
      { keys: 'Shift+Alt', action: 'Sets the trace to Intersect With Selection.' },
    ],
    shortcuts: [
      {
        keys: 'L',
        action:
          'Selects the Magnetic Lasso. All three lasso tools share L, so pressing it again re-selects this one rather than cycling; Shift+L is the cycling key.',
      },
      {
        keys: 'Shift+L',
        action: 'Cycles between the Lasso, Polygonal Lasso and Magnetic Lasso tools.',
      },
      {
        keys: 'Caps Lock',
        action:
          'Replaces the pointer with a circle the width of the detection area, while the tool is selected but not in use.',
      },
      {
        keys: '[',
        action: 'Decreases the detection Width by one pixel while tracing; with Shift, drops it to the minimum.',
      },
      {
        keys: ']',
        action: 'Increases the detection Width by one pixel while tracing; with Shift, raises it to the maximum.',
      },
      { keys: ',', action: 'Decreases Contrast while tracing; with Shift, drops it to the minimum.' },
      { keys: '.', action: 'Increases Contrast while tracing; with Shift, raises it to the maximum.' },
      { keys: 'Return', action: 'Closes the border, or moves focus to the Feather field when no border is open.' },
      { keys: 'Delete', action: 'Removes the most recent fastening point.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/featherMagneticLasso.ts:4',
      'src/tools/featherMagneticLasso.ts:43',
      'src/tools/settings.ts:112',
      'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:272',
      'src/components/Main/FeatherMagneticLassoToolArea.tsx:391',
      'src/components/Main/FeatherMagneticLassoToolArea.tsx:476',
      'src/components/Main/FeatherMagneticLassoToolArea.tsx:458',
      'src/util/selection.ts:834',
      'src/util/selection.ts:837',
      'toolbar-mapping.ts:47',
    ],
    appNotes:
      'The magnetic machinery is real: Width, Contrast and Snap feed a gradient-snapping edge detector, Frequency gates automatic fastening points, Smooth simplifies the traced path, and Feather and Anti-alias reach the copied alpha mask through the selection’s metadata. Three things diverge, and one load-bearing finding of the previous version of this record no longer holds. (1) Frequency was inverted and is no longer. That record said the app stored it as a maximum path length in pixels, so that lower values added more anchors — the exact opposite of Photoshop. The finding was correctly sourced and has been fixed: it is Adobe’s own 0–100 range with a plain-number readout (`MAGNETIC_LASSO_FREQUENCY_MIN`/`_MAX`, `src/tools/featherMagneticLasso.ts:20`-`:21`), and `magneticLassoAnchorSpan` (`:43`-`:54`) is the single place the direction is decided, mapping Frequency 0 to the longest 120px anchor span and Frequency 100 to the shortest 8px one, so a higher value anchors sooner. The gate is `pathLength(segment.path) < magneticLassoAnchorSpan(args.frequency)` (`src/components/Main/FeatherMagneticLassoToolArea.tsx:476`), and the row is `present` because range, direction and the bar’s own readout now agree with Adobe. (2) Contrast allows 0% where Photoshop’s documented range starts at 1%. (3) Feather and Anti-alias are not properties of the selection at all: `args.featherRadius` and `args.antiAlias` are written into the selection’s metadata at commit (`src/components/Main/FeatherMagneticLassoToolArea.tsx:394`-`:396`) and read back in exactly one place, `copySelectionToCanvas` → `copyFeatheredPolygonSelectionToCanvas` (`src/util/selection.ts:836`-`:837`), so both reach only the COPIED alpha mask — un-ticking Anti-alias softens the copy and changes nothing else on the canvas, and the Feather radius is likewise never a feather of the selection the ants are drawn from. Adobe caps its own options-bar box at 0 to 100 pixels, which is the same ceiling the app uses, so that cap was never a divergence; what is missing behind both controls is `Select > Modify > Feather`, which the app has no route to. Width is `partial` for a narrower reason than the others: the app renders a 1–64px slider (`FeatherMagneticLasso.tsx:288`-`:289`) and Adobe states the field only as “a pixel value” with no maximum, so the ceiling is the app’s own. Three of the app’s controls have no Photoshop counterpart at all: Snap, which the toolbar’s own help text describes as cursor pull toward a detected edge, Smooth, and the Preview feather outline. Alt is the one modifier this tool actually reads, and only as `magneticEnabled: !event.altKey` (`src/components/Main/FeatherMagneticLassoToolArea.tsx:458`), so the freehand-segment row above is real while the Alt-double-click straight close, the Shift/Alt/Shift+Alt combination modes and the Caps Lock, bracket, comma and period keys are all absent.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/magnetic-lasso-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html',
      'https://www.adobe.com/products/photoshop/feather-edges.html',
      'https://www.photoshopessentials.com/basics/selections/magnetic-lasso-tool',
      'https://www.lifewire.com/magnetic-lasso-tool-in-adobe-photoshop-4077747',
      'http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html',
    ],
  },

  'magic-wand': {
    photoshopName: 'Magic Wand Tool',
    summary:
      'Click a color to select every pixel within Tolerance of it — only the adjacent ones, or the whole image if Contiguous is off.',
    purpose:
      'The Magic Wand tool selects by color and tone rather than by shape: one click takes every pixel whose value falls within Tolerance of the pixel you clicked. With Contiguous on, that flood is limited to the connected region around the click; with it off, the same color range is taken everywhere in the image, which is how a sky repeated in a reflection is caught in one click. It is at its best on large flat areas such as a plain background, and it is widely reported as unavailable on Bitmap and 32-bits-per-channel images — an exclusion Adobe states for the 32-bit half, listing the Wand by name: "All tools in the toolbox except: Magnetic Lasso, Magic Wand, …". The Bitmap half is the half no Adobe page states. Each click within one tool session adds to or subtracts from the selection, so the same tolerance can be dialled in and re-clicked until the region is right. It shares its keyboard key and its Tools-panel flyout with the Quick Selection tool, and the two are the two ways to take the same contiguous region: the Wand takes it by color similarity from a single click, the Quick Selection takes it by following an image edge with a brush, which is why the Wand is better on a flat area and the brush is better on a soft one. This description is of Photoshop 2025 through 2026.',
    options: [
      {
        control: 'New / Add To / Subtract From / Intersect With',
        detail:
          'Four buttons that set how the next click combines with the selection already on the canvas. Holding Shift/Option or Alt/Option while clicking sets the same modes for that click.',
        status: 'missing',
      },
      {
        control: 'Sample Size',
        detail:
          'Sets how much of the image is sampled to influence selection sensitivity — point sample, or a 3 by 3 or 5 by 5 neighbourhood of the clicked pixel. A wider sample averages out noise in the sampled color at the cost of picking up more of its surroundings.',
        status: 'missing',
      },
      {
        control: 'Tolerance',
        detail:
          'The range of selected color values, from 0 (narrow, exact match only) to 255 (broad). Adobe states the range and no default; the 32 default is a third-party claim, and one of the pages carrying it is Adobe’s Photoshop Elements documentation, which is a different product. A low value selects colors very similar to the pixel you click; a higher value selects a broader range either side of it.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/MagicWand/MagicWand.tsx:63',
      },
      {
        control: 'Anti-alias',
        detail:
          'On by default, per the third-party and Elements pages that state it — Adobe’s current page describes the effect without naming a default. Smooths the stair-stepped edge a pixel-accurate selection leaves behind, and Adobe’s own current page on softening selection edges names this tool among those that can be anti-aliased.',
        status: 'missing',
      },
      {
        control: 'Contiguous',
        detail:
          'On by default, on the same third-party and Elements authority rather than an Adobe desktop sentence. When selected, only adjacent areas of similar color are taken; when deselected, every pixel using the same colors is selected throughout the entire image.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/MagicWand/MagicWand.tsx:77',
      },
      {
        control: 'Sample All Layers',
        detail:
          'Reported off by default, which is a CS5-era third-party claim and not an Adobe sentence. When selected, colors are sampled from all the visible layers; when deselected, only the active layer is sampled.',
        status: 'missing',
      },
      {
        control: 'Feather',
        detail:
          'Pixel radius, default 0, set before the click — but this row is version-dependent and the record says so rather than picking a side. Adobe’s current desktop page on softening selection edges (updated 2026-02-23) lists the tools that can be feathered and the wand is **not** among them, and an Adobe mobile page names Anti-alias, Contiguous and Tolerance for this tool with no Feather, while a third-party tutorial of the Photoshop CS era labels the control "Feather (Lasso Tool Only)". Against that, Adobe’s own **mobile** page for this tool (updated 2025-07-02) says to "access the more menu and adjust the **Feather** slider to define the feathering width as needed", and the UXP `Selection` reference has a `feather` argument defaulting to 0 on the selection-creating calls. The desktop bar as documented in 2025–2026 carries no Feather; whether it did in an earlier release is what the record cannot settle, and the unverified entry in the family notes names the page that came closest.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. This tool\'s own page ends by naming it: "Select Select and Mask to further refine or preview the selection as a mask."',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action: 'Clicking with Shift held adds the clicked region to the current selection for that click.',
      },
      {
        keys: 'Alt',
        action: 'Clicking with Alt held subtracts the clicked region from the current selection for that click.',
      },
      {
        keys: 'Shift+Alt',
        action: 'Clicking with both held keeps only the overlap between the clicked region and the current selection.',
      },
    ],
    shortcuts: [
      {
        keys: 'W',
        action:
          'Selects the Magic Wand. The wand and the Quick Selection share W, so pressing it again re-selects this one rather than cycling; Shift+W is the cycling key.',
      },
      { keys: 'Shift+W', action: 'Switches between the Magic Wand and the Quick Selection tools.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/magicWand.ts:3',
      'src/tools/settings.ts:124',
      'src/components/ToolbarsRight/MagicWand/MagicWand.tsx:63',
      'src/components/Main/MagicWandToolArea.tsx:58',
      'src/util/magicWand.ts:31',
      'toolbar-mapping.ts:52',
    ],
    appNotes:
      'The click, the flood and the commit all work, and the options bar reports the live selected-pixel count, which Photoshop’s bar does not. None of the modifiers above is read: the component that draws this tool (`src/components/Main/MagicWandToolArea.tsx`) takes the click position, `tolerance` and `smoothing` and consults no modifier key, so the Shift-adds, Alt-subtracts and Shift+Alt-intersects rows describe Photoshop and have no implementation here. Tolerance is a different control from Photoshop’s on two axes at once: a 0–100 slider defaulting to 28 where Photoshop runs 0–255 from 32, so the app cannot reach the top two thirds of Photoshop’s color range and its default is not Photoshop’s. The bar’s second slider, Smooth, has no Photoshop counterpart and is not anti-aliasing — it simplifies the traced boundary polygon, so raising it rounds off the staircase rather than blending it. `Contiguous` is `present` as of this pass and was `missing` in the previous version of this record, which said the behaviour was "permanently on and cannot be reached". That was true when written and is not now: `contiguous` is a declared field of `MagicWandToolArgs` (`src/tools/magicWand.ts:12`), seeded `true` in `settings.ts:127`, rendered as a checkbox wired to `patchToolArgs` (`src/components/ToolbarsRight/MagicWand/MagicWand.tsx:77`), and `createMagicWandSelectionFromCanvas` branches on it — so unticking it now takes the non-contiguous path, which is the selection that makes the wand useful on a repeated sky or a duplicated product shot. The commit that made it reachable notes it was left seeded `true` so no default click changes what is selected, which is also Photoshop’s default per the third-party and Elements authority quoted in the row. Sample All Layers is still absent and effectively always on, because the tool always samples the merged document canvas rather than the active layer. The two follow-ups that make the wand usable in a real workflow, Refine Edge and Select Similar, do not exist in the app at all.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/select-areas-by-color-with-the-magic-wand-tool.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/magic-wand-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/select-by-color-magic-wand.html',
      'https://helpx.adobe.com/ca/photoshop-elements/using/making-selections.html',
      'https://www.photoshopessentials.com/basics/selections/magic-wand-tool',
      'https://www.adobe.com/products/photoshop/refine-edge.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html',
      'https://helpx.adobe.com/photoshop/using/high-dynamic-range-images.html',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html',
    ],
  },

  'quick-selection': {
    photoshopName: 'Quick Selection Tool',
    summary:
      'Brush over an object and the selection grows along the image edges you cross; brush again to add, Alt-drag to subtract.',
    purpose:
      'The Quick Selection tool is a brush that paints a selection. You drag over the object and the region grows outward from under the cursor, comparing color, tone and texture, and stops where it finds a defined edge in the image. That is the whole difference from the Magic Wand, which also takes a contiguous region but does it with a single click and no edge following: the Wand selects by color similarity, the Quick Selection selects by following an edge with a brush. Because the brush is the mechanism, its diameter is the accuracy control — the smaller it is, the less the tool is allowed to reason about at once and the tighter the result, which is why a soft edge wants a small brush. Adobe describes it as selecting "based on similar tones and image edges", so it is edge following with a color prior rather than a pure boundary tracer. It carries only three selection modes rather than four — New, Add to and Subtract from, with no Intersect — and it switches itself to Add to Selection after the first stroke so that brushing is cumulative by default. This description is of Photoshop 2025 through 2026.',
    options: [
      {
        control: 'Tool presets',
        detail:
          "The preset picker every Photoshop tool carries, for saving and recalling this tool's whole option-bar state. It is the leftmost item on the bar.",
        status: 'missing',
      },
      {
        control: 'New / Add to / Subtract from',
        detail:
          'Three buttons, and three only. Every other selection tool carries four — New, Add to, Subtract from and Intersect with — but this one stops at Subtract from, so there is no way to intersect a quick selection with an existing one. The tool switches itself to Add to Selection after the first stroke, and holding Alt/Option while brushing temporarily selects Subtract from Selection.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:148',
      },
      {
        control: 'Size',
        detail:
          'The brush diameter, taken from the brush preset picker that also carries Hardness, Spacing, Angle and Roundness. The brush is the whole mechanism: the region grows outward from under the cursor and stops where the image edge is, so the brush diameter sets how much of the image the tool is allowed to reason about, and a smaller brush gives a more accurate result — which is why it is the control a user reaches for at a soft edge. Photoshop exposes size and hardness directly in the options bar and lets the left and right bracket keys resize the cursor while the tool is active.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:111',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. This tool\'s own page ends by naming it: "Select Select and Mask to refine the selection further."',
        status: 'missing',
      },
      {
        control: 'Sample All Layers',
        detail:
          'When selected, the selection is made from all the visible layers instead of only the currently selected layer, so a subject on one layer can be selected against a background on another.',
        status: 'missing',
      },
      {
        control: 'Auto-Enhance',
        detail:
          "Named Enhance Edge in the 2025 documentation and Auto-Enhance in Adobe's 2022 tutorial, which is where the older label appears. It reduces the roughness and blockiness the raw edge detection leaves, flows the selection further toward the image edges, and applies part of the edge refinement that Select and Mask does by hand — at the cost of the tool taking noticeably longer to run.",
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Brushing with Alt held subtracts from the selection for the duration of the stroke; releasing it returns the tool to Add to Selection.',
      },
      {
        keys: 'Ctrl+Alt',
        action:
          'Dragging horizontally with it held changes the brush size, and dragging vertically the hardness. That is the macOS binding, and the Windows one is the same pair with the right mouse button; plain Alt-drag is not bound to brush size in Photoshop at all.',
      },
    ],
    shortcuts: [
      {
        keys: 'W',
        action:
          'Selects the Quick Selection. The wand and the Quick Selection share W, so pressing it again re-selects this one rather than cycling; Shift+W is the cycling key.',
      },
      { keys: 'Shift+W', action: 'Switches between the Magic Wand and the Quick Selection tools.' },
      { keys: '[', action: 'Decreases the brush size; with Shift, drops it to the minimum.' },
      { keys: ']', action: 'Increases the brush size; with Shift, raises it to the maximum.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/quickSelection.ts:8',
      'src/tools/quickSelection.ts:144',
      'src/tools/quickSelection.ts:79',
      'src/tools/settings.ts:227',
      'src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:111',
      'src/components/Main/QuickSelectionToolArea.tsx:125',
      'src/components/Main/QuickSelectionToolArea.tsx:216',
      'toolbar-mapping.ts:53',
    ],
    appNotes:
      "The stroke, the re-seeding along the path and the marching-ants preview are all implemented, and the arc-length re-seeding is a better answer than one seed per pointer event. Neither modifier above is read: the component that draws this tool (`src/components/Main/QuickSelectionToolArea.tsx`) grows the region from the pointer position, the brush size and the mode and consults no modifier key, so neither Alt-subtracts nor the Control+Option-drag brush-size gesture exists here. **The on-screen promise this record used to report as the sharpest defect in the family is gone.** The bar's hint text used to read \"Shift and Alt drag on the canvas\" while the tool area consulted neither key; it now says only what the gesture does (`Drag over an object to grow the selection along the stroke.`, `QuickSelection.tsx:105`), with a comment above it naming Photoshop's Alt-drag tip resize and Shift-drag circular constraint as deliberately unimplemented (`QuickSelection.tsx:99`-`:101`). The promise was removed rather than implemented, and the hint is no longer a false claim. The `[` and `]` rows are Photoshop's Photoshop-wide brush keys and are not bound — the global table in `src/components/Common/AppKeyboardShortcuts.tsx` is the app's complete set and holds no bracket, so the brush size can only be changed from the bar's own slider, which runs 1 to 500px (`QUICK_SELECTION_SIZE_MIN`/`_MAX`, `src/tools/quickSelection.ts:53`-`:54`). The region grow underneath, though, is not an edge detector: each seed hands the seed pixel to the same flood fill the Magic Wand uses, with Contiguous forced on, so a stroke selects a color range around every dab rather than following the image edge the way Photoshop's does. That is why the bar carries a Tolerance slider at all — Photoshop's Quick Selection has no such control, and the two are the same mechanism under different names. The Mode dropdown offers only Add and Subtract (`QUICK_SELECTION_MODES`, `src/tools/quickSelection.ts:45`-`:48`), so there is no way to start a fresh selection and no Intersect, and Sample All Layers, Select and Mask, Auto-Enhance and the tool-preset picker are all absent — Sample All Layers because the stroke reads the merged composite canvas, and the rest because there is no implementation. The committed selection commits under a borrowed `sourceTool: 'magic-wand'` identifier (`QUICK_SELECTION_SOURCE_TOOL`, `src/tools/quickSelection.ts:43`) because the app's own `SelectionSourceTool` union has no `quick-selection` member, which is why the committed region carries no draggable anchors. The region is committed as a single traced contour, so a grown region with an enclosed hole is refused rather than committed, and the committed selection carries no brush hardness, spacing, angle or roundness and no live size and opacity keys. On the keyboard, the app badges the Magic Wand with W — the same key Photoshop binds, on the same flyout, because the two tools share it — and the Quick Selection tile carries no badge of its own.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/quick-selection-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/use-quick-selection-tool.html',
      'https://www.adobe.com/learn/photoshop/web/selection-tools-basics',
      'https://helpx.adobe.com/photoshop/web/edit-images/make-selections/automate-selections-with-quick-selection-tool.html',
      'https://asktimgrey.com/2021/04/07/controlling-the-quick-selection-tool',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/using/create-temporary-quick-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-and-soften-selection-edges.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html',
      'https://www.photoshopessentials.com/basics/selections/quick-selection-tool',
      'https://cod.pressbooks.pub/photoshopmastery1250/chapter/selections',
      'https://helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html',
      'https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html',
      'https://jkost.com/blog/2017/05/brushes-and-painting-tool-shortcuts-in-photoshop-cc.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html',
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/create-brush-set-painting-options.html',
      'https://www.adobe.com/products/photoshop/feather-edges.html',
    ],
  },
};
