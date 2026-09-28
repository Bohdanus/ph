import type { ToolDescription } from './types.ts';

export const selectionDescriptions: Record<
  | 'rectangular-selection'
  | 'elliptical-selection'
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
          'A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
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
          'Selects the marquee tools; repeated presses cycle between the rectangular, elliptical and single-row/column variants.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/rectangularSelection.ts:4',
      'src/tools/settings.ts:124',
      'src/components/ToolbarsRight/RectangularSelection/RectangularSelection.tsx:32',
      'src/hooks/useRect.ts:96',
      'toolbar-mapping.ts:41',
    ],
    appNotes:
      'The tool draws, commits and copies a rectangle, and its options bar renders only a static sentence plus Copy, Paste and Clear. It declares no settings of its own at all, so all three Photoshop controls are absent rather than inert. The Shift square constraint is not read during the drag: useRect reads Shift, Ctrl and Cmd only when a handle of an already-committed rectangle is being resized, and there it locks the aspect ratio to the current one rather than constraining to 1:1. There is no Select-menu surface anywhere in the app, so nothing here can feather an existing selection, inverse it, or grow it.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/rectangular-marquee-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html',
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
        appRef: 'src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:96',
      },
      {
        control: 'Width and Height',
        detail:
          'The two fields behind Fixed Ratio and Fixed Size. Fixed Ratio is a pair of decimal fields, so a box twice as wide as it is high is entered as 2 and 1; Fixed Size takes whole pixels. Both accept document units such as inches or centimetres alongside pixels.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:112',
      },
      {
        control: 'Select and Mask',
        detail:
          'A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
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
          'Selects the marquee tools; repeated presses cycle between the rectangular, elliptical and single-row/column variants.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/ellipticalSelection.ts:155',
      'src/tools/ellipticalSelection.ts:51',
      'src/tools/settings.ts:207',
      'src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:94',
      'src/components/Main/EllipticalSelectionToolArea.tsx:172',
      'toolbar-mapping.ts:42',
    ],
    appNotes:
      'The tool is the most complete of the selection family and the only one whose options bar has any Photoshop control on it, but the Style it renders is not Photoshop’s Style in two ways. Fixed Ratio is a single Ratio field rather than Photoshop’s pair of decimal Width and Height fields, so the app cannot express a ratio the way Photoshop states one and its slider floor is 0.05, not a pair of 1s. Fixed Size renders plain pixel number inputs, so the document-unit entry Photoshop accepts cannot be typed. The three geometry behaviours that matter are correct and shared with the pure helpers: Shift is read as constrainToCircle, Alt as fromCentre, and the committed polygon is a sagitta-bounded inscribed ring rather than a true ellipse. The ellipse commits under a borrowed source-tool identifier because the selection union in the app’s own types has no elliptical member, which is why the committed ellipse carries no draggable anchor handles.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/elliptical-marquee-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html',
      'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/',
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
          'A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
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
          'Selects the lasso tools; repeated presses cycle between the freehand, polygonal and magnetic variants.',
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
      'src/tools/settings.ts:99',
      'src/components/ToolbarsRight/Lasso/FreehandLasso.tsx:46',
      'toolbar-mapping.ts:45',
    ],
    appNotes:
      'The tool traces a closed loop and commits it, and its bar renders Copy, Paste and Clear beside a single toggle. That toggle is the app’s own control and has no Photoshop counterpart: it is labelled Mode in the bar but switches between Outline and Fill, which changes how the committed border is painted rather than how a new gesture combines with the existing selection. The app therefore has no Photoshop control on this bar at all, and no combination modes. The LassoToolArgs type carries alpha, lineWidth, color and fill, none of which Photoshop puts on this tool’s bar.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/lasso-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/web/edit-images/make-selections/create-selections-with-lasso-tool.html',
      'https://www.adobe.com/products/photoshop/lasso-tool.html',
    ],
  },

  'polygonal-lasso': {
    photoshopName: 'Polygonal Lasso Tool',
    summary:
      'Click to lay straight-edged anchors around a shape, then click the first anchor, double-click, or press Enter to close.',
    purpose:
      'The Polygonal Lasso tool draws a selection border out of straight segments, which is the right tool for anything with corners: a building edge, a piece of type, a flat geometric shape. You do not hold the mouse button down; you click to add a corner anchor, move, and click again. Closing the border is explicit and has three ways in: click the starting anchor, double-click, or press Enter or Return, the last of which closes with a segment the tool finds rather than a straight one. Clicking the mouse down and dragging instead of clicking lays a curved segment, and holding Alt/Option while dragging draws a freehand segment between two clicked points. This description is of Photoshop 2023 through 2026.',
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
          'A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
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
      { keys: 'Shift', action: 'Sets the gesture to Add to Selection.' },
      { keys: 'Alt', action: 'Set as the combination mode, sets the gesture to Subtract From Selection.' },
      { keys: 'Shift+Alt', action: 'Sets the gesture to Intersect With Selection.' },
    ],
    shortcuts: [
      {
        keys: 'L',
        action:
          'Selects the lasso tools; repeated presses cycle between the freehand, polygonal and magnetic variants.',
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
      'src/tools/settings.ts:91',
      'src/components/ToolbarsRight/Lasso/PolygonalLasso.tsx:16',
      'src/components/Main/PolygonClickToolArea.tsx:915',
      'toolbar-mapping.ts:46',
    ],
    appNotes:
      'The click-to-add-anchor gesture, the double-click close, the right-click close, the Enter close, the Backspace and Delete anchor removal and the Escape abort are all implemented, which makes this the most faithful of the seven. Its options bar, however, is the thinnest component in the family: forty lines rendering one app-invented Outline/Fill toggle and a hint sentence, and — unlike the freehand and magnetic lasso bars beside it — no Copy, Paste or Clear buttons. It shares LassoToolArgs with the freehand lasso, so neither Photoshop control on this bar has a field to live in. Because the app has no Select > Modify > Feather and no Refine Edge, a feather set on any selection tool is only reachable by re-making the selection with the tool.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/polygonal-lasso-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://www.photoshopessentials.com/basics/selections/polygonal-lasso-tool',
      'https://helpx.adobe.com/photoshop/web/edit-images/make-selections/create-selections-with-lasso-tool.html',
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
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:252',
      },
      {
        control: 'Anti-alias',
        detail: 'On by default. Smooths the traced edge with intermediate coverage values where it is copied out.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:331',
      },
      {
        control: 'Width',
        detail:
          'The detection width in pixels, entered as a value rather than chosen from a list. The tool detects edges only within that distance of the pointer, and Caps Lock swaps the pointer for a circle of exactly that size. The left and right bracket keys change it by one pixel while the tool is tracing.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:265',
      },
      {
        control: 'Contrast',
        detail:
          'The lasso’s sensitivity to edges, entered as a percentage from 1% to 100%. A higher value detects only edges that contrast sharply with their surroundings; a lower value detects lower-contrast edges. The comma and period keys change it while the tool is tracing.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:278',
      },
      {
        control: 'Frequency',
        detail:
          'The rate at which the lasso sets fastening points, from 0 to 100. A higher value lays fastening points down more densely and anchors the border in place more quickly, so moving the slider right adds anchors.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:291',
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
          'A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
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
          'Selects the lasso tools; repeated presses cycle between the freehand, polygonal and magnetic variants.',
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
      'src/tools/settings.ts:107',
      'src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:223',
      'src/components/Main/FeatherMagneticLassoToolArea.tsx:185',
      'src/components/Main/FeatherMagneticLassoToolArea.tsx:467',
      'src/util/selection.ts:729',
      'toolbar-mapping.ts:47',
    ],
    appNotes:
      'The magnetic machinery is real: Width, Contrast and Snap feed a gradient-snapping edge detector, Frequency gates automatic fastening points, Smooth simplifies the traced path, and Feather and Anti-alias reach the copied alpha mask through the selection’s metadata. Three things diverge. Frequency is inverted — the app stores it as a maximum path length in pixels and its own help text says lower values add more anchors, where Photoshop’s 0–100 rate means a higher value lays fastening points down more densely, so the same gesture on the two sliders does opposite things. Contrast allows 0% where Photoshop’s documented range starts at 1%. And Feather means the same thing here as on the marquee tools but is capped at 100 pixels, applies to the copied mask rather than to the selection, and has no Select > Modify > Feather behind it. Three of the app’s controls have no Photoshop counterpart at all: Snap, which the toolbar’s own help text describes as cursor pull toward a detected edge, Smooth, and the Preview feather outline. The bracket and comma/period keys that Photoshop binds live are not bound here, and the app’s toolbar badge for this tool reads Shift+L, which is the app’s own binding for one item in a flyout rather than a Photoshop shortcut — in Photoshop all three lasso tools share L and are cycled by repeated presses.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/magnetic-lasso-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html',
      'https://www.photoshopessentials.com/basics/selections/magnetic-lasso-tool',
      'https://www.lifewire.com/magnetic-lasso-tool-in-adobe-photoshop-4077747',
      'http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf',
    ],
  },

  'magic-wand': {
    photoshopName: 'Magic Wand Tool',
    summary:
      'Click a color to select every pixel within Tolerance of it — only the adjacent ones, or the whole image if Contiguous is off.',
    purpose:
      'The Magic Wand tool selects by color and tone rather than by shape: one click takes every pixel whose value falls within Tolerance of the pixel you clicked. With Contiguous on, that flood is limited to the connected region around the click; with it off, the same color range is taken everywhere in the image, which is how a sky repeated in a reflection is caught in one click. It is at its best on large flat areas such as a plain background, and it is not available on Bitmap or 32-bits-per-channel images. Each click within one tool session adds to or subtracts from the selection, so the same tolerance can be dialled in and re-clicked until the region is right. It shares its keyboard key and its Tools-panel flyout with the Quick Selection tool, and the two are the two ways to take the same contiguous region: the Wand takes it by color similarity from a single click, the Quick Selection takes it by following an image edge with a brush, which is why the Wand is better on a flat area and the brush is better on a soft one. This description is of Photoshop 2025 through 2026.',
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
          'The range of selected color values, from 0 (narrow, exact match only) to 255 (broad), defaulting to 32. A low value selects colors very similar to the pixel you click; a higher value selects a broader range either side of it.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/MagicWand/MagicWand.tsx:54',
      },
      {
        control: 'Anti-alias',
        detail: 'On by default. Smooths the stair-stepped edge a pixel-accurate selection leaves behind.',
        status: 'missing',
      },
      {
        control: 'Contiguous',
        detail:
          'On by default. When selected, only adjacent areas of similar color are taken; when deselected, every pixel using the same colors is selected throughout the entire image.',
        status: 'missing',
      },
      {
        control: 'Sample All Layers',
        detail:
          'Off by default. When selected, colors are sampled from all the visible layers; when deselected, only the active layer is sampled.',
        status: 'missing',
      },
      {
        control: 'Select and Mask',
        detail:
          "A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. The Wand's own page names it as the way to further refine or preview the selection as a mask.",
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
      { keys: 'W', action: 'Selects the quick selection and Magic Wand tools; repeated presses cycle between them.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/magicWand.ts:3',
      'src/tools/settings.ts:119',
      'src/components/ToolbarsRight/MagicWand/MagicWand.tsx:52',
      'src/components/Main/MagicWandToolArea.tsx:55',
      'src/util/magicWand.ts:31',
      'toolbar-mapping.ts:52',
    ],
    appNotes:
      'The click, the flood and the commit all work, and the options bar reports the live selected-pixel count, which Photoshop’s bar does not. But only Tolerance corresponds to a Photoshop control, and it is a different control: a 0–100 slider defaulting to 28 where Photoshop runs 0–255 from 32, so the app cannot reach the top two thirds of Photoshop’s color range and its default is not Photoshop’s. The bar’s second slider, Smooth, has no Photoshop counterpart and is not anti-aliasing — it simplifies the traced boundary polygon, so raising it rounds off the staircase rather than blending it. Contiguous is not merely absent from the bar: the selection util carries the flag and takes the contiguous branch unless it is explicitly false, and the tool area never passes it, so the behaviour is permanently on and cannot be reached. Sample All Layers is absent and effectively always on, because the tool always samples the merged document canvas rather than the active layer. The two follow-ups that make the wand usable in a real workflow, Refine Edge and Select Similar, do not exist in the app at all.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/select-areas-by-color-with-the-magic-wand-tool.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/magic-wand-tool.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html',
      'https://helpx.adobe.com/ph_fil/photoshop/how-to/select-by-color-magic-wand.html',
      'https://helpx.adobe.com/ca/photoshop-elements/using/making-selections.html',
      'https://www.photoshopessentials.com/basics/selections/magic-wand-tool',
      'https://www.adobe.com/products/photoshop/refine-edge.html',
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
        appRef: 'src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:138',
      },
      {
        control: 'Size',
        detail:
          'The brush diameter, taken from the brush preset picker that also carries Hardness, Spacing, Angle and Roundness. The brush is the whole mechanism: the region grows outward from under the cursor and stops where the image edge is, so the brush diameter sets how much of the image the tool is allowed to reason about, and a smaller brush gives a more accurate result — which is why it is the control a user reaches for at a soft edge. Photoshop exposes size and hardness directly in the options bar and lets the left and right bracket keys resize the cursor while the tool is active.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:104',
      },
      {
        control: 'Select and Mask',
        detail:
          'Opens the Select and Mask workspace, where the quick selection is refined: a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document.',
        status: 'missing',
      },
      {
        control: 'Mask',
        detail:
          'Converts the current selection into a layer mask on the active layer instead of leaving it as a selection, so the result can be edited non-destructively. Sits immediately after Select and Mask and before the two checkboxes.',
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
        keys: 'Alt',
        action:
          'Held while dragging horizontally, changes the brush size — the same gesture Photoshop binds on every brush tool.',
      },
    ],
    shortcuts: [
      { keys: 'W', action: 'Selects the quick selection and Magic Wand tools; repeated presses cycle between them.' },
      { keys: '[', action: 'Decreases the brush size; with Shift, drops it to the minimum.' },
      { keys: ']', action: 'Increases the brush size; with Shift, raises it to the maximum.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/quickSelection.ts:8',
      'src/tools/quickSelection.ts:144',
      'src/tools/quickSelection.ts:67',
      'src/tools/settings.ts:214',
      'src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:102',
      'src/components/Main/QuickSelectionToolArea.tsx:123',
      'toolbar-mapping.ts:53',
    ],
    appNotes:
      "The stroke, the re-seeding along the path and the marching-ants preview are all implemented, and the arc-length re-seeding is a better answer than one seed per pointer event. The region grow underneath, though, is not an edge detector: each seed hands the seed pixel to the same flood fill the Magic Wand uses, with Contiguous forced on, so a stroke selects a color range around every dab rather than following the image edge the way Photoshop's does. That is why the bar carries a Tolerance slider at all — Photoshop's Quick Selection has no such control, and the two are the same mechanism under different names. The mode dropdown offers only Add and Subtract, so there is no way to start a fresh selection and no Intersect, and Sample All Layers, Select and Mask, Mask, Auto-Enhance and the tool-preset picker are all absent — Sample All Layers because the stroke reads the merged composite canvas, and the rest because there is no implementation. The committed selection also has no route into Quick Mask mode, which is how Photoshop converts a selection into an editable mask: paint the tool's result, and the only mask the app can produce is the bitmap its Copy button renders. The region is committed as a single traced contour, so a grown region with an enclosed hole is refused rather than committed, and the committed selection carries no brush hardness, spacing, angle or roundness and no live size and opacity keys. On the keyboard, the app badges the Magic Wand with W — the same key Photoshop binds, on the same flyout, because the two tools share it — and the Quick Selection tile carries no badge of its own.",
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
      'https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html',
      'https://www.photoshopessentials.com/basics/selections/quick-selection-tool',
      'https://cod.pressbooks.pub/photoshopmastery1250/chapter/selections',
    ],
  },
};
