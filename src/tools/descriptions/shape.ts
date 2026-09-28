import type { ToolControl, ToolDescription, ToolModifier, ToolShortcut } from './types.ts';

const modeControl: ToolControl = {
  control: 'Mode',
  detail:
    'The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.',
  status: 'partial',
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:129',
};

const fillControl: ToolControl = {
  control: 'Fill',
  detail:
    'The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.',
  status: 'partial',
  appRef: 'src/tools/shape.ts:144',
};

const strokeControl: ToolControl = {
  control: 'Stroke',
  detail:
    'The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.',
  status: 'partial',
  appRef: 'src/tools/shape.ts:143',
};

const strokeWidthControl: ToolControl = {
  control: 'Stroke width',
  detail: 'Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.',
  status: 'partial',
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:153',
};

const strokeTypeControl: ToolControl = {
  control: 'Stroke type',
  detail:
    'Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.',
  status: 'partial',
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:219',
};

const weightControl: ToolControl = {
  control: 'Weight',
  detail:
    'Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.',
  status: 'missing',
};

const opacityControl: ToolControl = {
  control: 'Opacity',
  detail:
    'Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.',
  status: 'partial',
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:284',
};

const pixelBlendModeControl: ToolControl = {
  control: 'Mode',
  detail:
    'Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.',
  status: 'missing',
};

const antiAliasControl: ToolControl = {
  control: 'Anti-alias',
  detail:
    'Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.',
  status: 'missing',
};

const pathOperationsControl: ToolControl = {
  control: 'Path Operations',
  detail:
    'How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set.',
  status: 'missing',
};

const pathArrangementControl: ToolControl = {
  control: 'Path Arrangement',
  detail: 'Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.',
  status: 'missing',
};

const pathAlignmentControl: ToolControl = {
  control: 'Path Alignment',
  detail: 'Align and distribute the path components of the selected vector mask against one another.',
  status: 'missing',
};

const gearControl: ToolControl = {
  control: 'Set additional shape and path options',
  detail:
    'The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.',
  status: 'missing',
};

const shapeWHControl: ToolControl = {
  control: 'Shape W&H',
  detail:
    'Exact width and height for the next shape. Clicking the canvas without dragging opens a Create <Shape> dialog offering the same Width, Height and Corner Radius fields plus From Center.',
  status: 'partial',
  appRef: 'src/components/Main/ShapeToolArea.tsx:181',
};

const sharedFigureOptions: readonly ToolControl[] = [
  modeControl,
  fillControl,
  strokeControl,
  strokeWidthControl,
  strokeTypeControl,
  weightControl,
  opacityControl,
  pixelBlendModeControl,
  antiAliasControl,
  pathOperationsControl,
  pathArrangementControl,
  pathAlignmentControl,
  gearControl,
  shapeWHControl,
];

const radiusDetail =
  'Rounds the shape corners in pixels, default 0 px. Adobe documents the control on the Rectangle tool ("Radius of rounded corners: Manually set the radius…") and on the Triangle tool ("specify Width, Height, and Corner Radius"); the Ellipse and Line tools have no rounded corners. The Rectangle tool keeps four independent radii and the Triangle tool a single value that rounds every corner at once. Whether the Polygon tool offers it is third-party only — no Adobe page listing the Polygon tool’s bar was found — so the polygon half of that gap is a judgment, not a match.';

const radiusControl: ToolControl = {
  control: 'Radius',
  detail: radiusDetail,
  status: 'present',
  appRef: 'src/tools/shape.ts:216',
};

const missingRadiusControl: ToolControl = {
  control: 'Radius',
  detail: radiusDetail,
  status: 'missing',
};

const shiftSquareModifier: ToolModifier = {
  keys: 'Shift',
  action:
    'Constrains the drag to a square drag box, which is a square for the Rectangle tool and a circle for the Ellipse tool.',
};

const altFromCenterModifier: ToolModifier = {
  keys: 'Alt',
  action: 'Draws from the centre outward, so the press point is the middle of the shape rather than one corner.',
};

const spaceRepositionModifier: ToolModifier = {
  keys: 'Space',
  action: 'Repositions the shape while the drag is still in progress, without changing its size.',
};

const shapeToolShortcuts: readonly ToolShortcut[] = [
  { keys: 'U', action: 'Selects the shapes tool group.' },
  { keys: 'Shift+U', action: 'Cycles to the next tool in the shapes tool group.' },
];

export const shapeDescriptions: Record<
  'shape' | 'rectangle' | 'ellipse' | 'line' | 'triangle' | 'polygon' | 'custom-shape',
  ToolDescription
> = {
  shape: {
    photoshopName: 'Shape Tool',
    summary: 'Draws a vector shape, a path, or a filled pixel region, and stamps it onto its own shape layer.',
    purpose:
      'The Shape tool is the group every geometric figure hangs off in the Tools panel: press U and you get the rectangle, hold U and the fly-out offers the triangle, ellipse, line, polygon and custom shape — and, in the current release, a separate star. Whichever figure is active, the three-button Mode group at the left of the options bar decides what a drag commits — a filled shape layer with a vector mask, a work path with no pixels at all, or a rasterized region painted straight into the active layer. Fill and Stroke are set independently of each other and of the drawing mode, so the same rectangle can be a solid block, a hairline outline, or an outline over a gradient. The drawn shape stays a Live Shape, so its fill, stroke, corner radius and dimensions remain editable from the Properties panel long after the drag.',
    options: sharedFigureOptions,
    modifiers: [shiftSquareModifier, altFromCenterModifier, spaceRepositionModifier],
    shortcuts: shapeToolShortcuts,
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:158',
      'src/tools/shape.ts:239',
      'src/tools/shape.ts:71',
      'src/components/ToolbarsRight/Figures/Shape.tsx:20',
      'src/tools/toolsMap.ts:62',
    ],
    appNotes:
      'The processor is live and every drag commits a layer, so nothing here is a placeholder, but the group diverges from Photoshop in three ways worth naming. Path mode does not create a path: the mode only suppresses the fill inside the rasterizer, so a Path-mode shape still rasterizes to a layer with a stroke. Pixels mode is byte-identical to Shape mode, because everything is already a raster. And the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://helpx.adobe.com/photoshop/using/modify-shapes.html',
      'https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html',
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/',
    ],
  },

  rectangle: {
    photoshopName: 'Rectangle Tool',
    summary:
      'Drag-defined rectangle or square with an optional corner radius, drawn as a shape layer, path, or filled pixels.',
    purpose:
      'The Rectangle tool draws a four-sided figure from two drag corners, and Shift holds it square while Alt/Option draws it from its centre outward. Radius rounds the corners before you draw, and the shape it produces is a Live Shape whose four corner radii can afterwards be set independently — Alt/Option-drag the on-canvas radius control to break one corner out of the link. The separate Rounded Rectangle tool was removed in Photoshop 22.3 because the Radius field on this tool subsumes it. Clicking the canvas with no drag opens a Create Rectangle dialog so an exact width, height and corner radius can be typed instead of dragged.',
    options: [...sharedFigureOptions, radiusControl],
    modifiers: [shiftSquareModifier, altFromCenterModifier, spaceRepositionModifier],
    shortcuts: [{ keys: 'U', action: 'Selects the shapes tool group.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:325',
      'src/tools/shape.ts:201',
      'src/tools/shape.ts:71',
      'src/components/ToolbarsRight/Figures/Shape.tsx:165',
      'src/tools/settings.ts:265',
    ],
    appNotes:
      'The drag geometry, Shift, Alt and the corner radius all behave as they do in Photoshop, and the radius is clamped to half the shorter side exactly as a rounded rectangle must be. That is the whole of what is right, and the divergences below are why the verdict is `partial` and not `implemented`. The three the group carries apply to the Rectangle verbatim: Path mode does not create a path, Pixels mode is byte-identical to Shape mode, and the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all. The Rectangle adds two divergences of its own, and the first is a default rather than a gap: it seeds a 5 px stroke where Photoshop seeds 1 px, so an untouched rectangle is drawn five times as heavy as Photoshop would draw it. The Radius slider runs 0–250 px with no numeric entry, and only the rectangle gets a radius — the app gates the whole control on this figure. Everything else on the Rectangle bar, from the separate Fill and Stroke swatches down to the path-operation icons, is absent.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/modify-shapes.html',
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/',
      'https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html',
    ],
  },

  ellipse: {
    photoshopName: 'Ellipse Tool',
    summary: 'Drag-defined ellipse or circle drawn as a shape layer, a work path, or a filled pixel region.',
    purpose:
      'The Ellipse tool inscribes an ellipse in the drag box; Shift holds it a circle, and Alt/Option draws it from its centre outward. It has no Corner Radius, because an ellipse has no corners, and the field does not appear in the bar. No desktop Adobe page enumerating the Ellipse tool’s bar was found, so that this matches Photoshop is a judgment rather than a documented match. The result is a Live Shape whose width, height and angle stay editable in the Properties panel. Clicking without dragging opens a Create Ellipse dialog for exact dimensions.',
    options: sharedFigureOptions,
    modifiers: [shiftSquareModifier, altFromCenterModifier, spaceRepositionModifier],
    shortcuts: [{ keys: 'U', action: 'Selects the shapes tool group.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:326',
      'src/tools/shape.ts:225',
      'src/tools/shape.ts:71',
      'src/components/ToolbarsRight/Figures/Shape.tsx:17',
      'src/tools/settings.ts:272',
    ],
    appNotes:
      'The geometry matches: the ellipse is drawn as a real ctx.ellipse from the half-extents of the drag box, and Shift produces a true circle rather than a square-boxed oval. That is the whole of what is right, and the divergences below are why the verdict is `partial` and not `implemented`. The three the group carries apply to the Ellipse verbatim: Path mode does not create a path, Pixels mode is byte-identical to Shape mode, and the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all. The Ellipse then carries the same wrong default as every other figure, a 5 px stroke where Photoshop seeds 1 px, and keeps a cornerRadius: 0 key in its persisted defaults for a control its own bar withholds. Withholding Radius is the app’s rectangle-only gate, and that is a judgment about Photoshop rather than a documented match, since the only evidence for it is a third-party page and no desktop Adobe page enumerating the Ellipse tool’s bar was found. Everything the bar offers beyond the tool mode, thickness, dash and opacity is missing.',
    sources: [
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/',
    ],
  },

  line: {
    photoshopName: 'Line Tool',
    summary: 'Drag-defined straight line or arrow, drawn as a shape layer, a work path, or a filled pixel region.',
    purpose:
      'The Line tool drags a single straight segment between two points, and Shift snaps the segment to the nearest multiple of 45 degrees so it lands on a compass bearing. Its colour is the Stroke, not the Fill, because a line is an open path with a stroke and no interior to fill. The Arrowheads panel adds Start and End toggles, with Width, Length and Concavity to size them; Adobe documents it as a section of the Contextual Task Bar (Window > Contextual Task Bar), not a field in the options bar. The end caps are Butt, Round or Square.',
    options: [
      ...sharedFigureOptions,
      {
        control: 'Caps',
        detail:
          'Appearance of the two ends of the segment: Butt, Round or Square. Offered for any stroked path, and prominent for the Line tool.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:189',
      },
      {
        control: 'Arrowheads',
        detail:
          'Start and End toggles that put an arrowhead on either or both ends of the line, sized by Width, Length and Concavity. Adobe places the panel in the Arrowheads section of the Contextual Task Bar (Window > Contextual Task Bar) with the tool selected; it is never a field in the options bar, and the Concavity default could not be sourced to a current Adobe page.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action: 'Constrains the segment to a multiple of 45 degrees, so it lands on a compass bearing.',
      },
      altFromCenterModifier,
      spaceRepositionModifier,
    ],
    shortcuts: [{ keys: 'U', action: 'Selects the shapes tool group.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:329',
      'src/tools/shape.ts:176',
      'src/tools/shape.ts:79',
      'src/components/ToolbarsRight/Figures/Shape.tsx:186',
      'src/tools/settings.ts:293',
    ],
    appNotes:
      'The segment itself is correct, and the app is right not to square a line, but the one modifier that defines this tool is the one it declines to implement: normalizeShapeGeometry explicitly skips the Shift constraint for the line figure, so a Shift-drag keeps its free angle and can never snap to 45 degrees. Arrowheads are absent outright — drawShape strokes a bare moveTo/lineTo pair, with no start or end cap geometry — which is why a line here can never become an arrow. The Cap select the app renders for this figure offers Photoshop’s three cap styles but only the Line figure gets one, where Photoshop offers caps for any stroked path.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/line-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/',
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
    ],
  },

  triangle: {
    photoshopName: 'Triangle Tool',
    summary:
      'Drag-defined triangle with its apex at the top-centre of the drag box; hold Shift while dragging to constrain it to an equilateral triangle.',
    purpose:
      'The Triangle tool, added in Photoshop 2021 (v22), draws a three-sided figure whose apex sits at the top-centre of the drag box and whose base spans its bottom. Adobe states the drag and the Shift constraint but never the resulting geometry, so reading that box as an isosceles triangle rather than a regular one is this description’s inference, not Adobe’s wording. Shift while dragging is the equilateral constraint — it forces the height to √3⁄2 of the width — and it is not a square-drag aspect snap. Alt/Option draws from the centre, and a single Radius control rounds all three corners together, because this tool has no per-corner radius handles. The tool is a shortcut for the Polygon tool at three sides, not a separate shape vocabulary.',
    options: [...sharedFigureOptions, missingRadiusControl],
    modifiers: [
      {
        keys: 'Shift',
        action: 'Constrains the triangle to equilateral, forcing the height to √3⁄2 of the width.',
      },
      altFromCenterModifier,
      spaceRepositionModifier,
    ],
    shortcuts: [{ keys: 'U', action: 'Selects the shapes tool group.' }],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:327',
      'src/tools/shape.ts:181',
      'src/tools/shape.ts:186',
      'src/tools/shape.ts:79',
      'src/tools/settings.ts:279',
    ],
    appNotes:
      'The geometry is wrong in the specific way the premise correction warns about. The app inscribes a regular three-sided polygon in the drag box, so a wide drag yields a squat isosceles-looking triangle only by accident, and Shift squares the drag box instead of forcing equilateral — for a 3-gon inscribed in a square box, that is not h = √3⁄2 · w. Because the figure is built by the shared triangle/polygon branch, its Radius field is both absent from the bar and unimplemented in the renderer, so its corners can never be rounded. The Shift behaviour is version-dependent in wording only: the equilateral constraint has been the tool’s Shift since 2021 (v22), and later versions add the persistent Equilateral checkbox to the gear menu.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/triangle-tool.html',
      'https://jkost.com/blog/2020/10/adobe-announces-updates-to-photoshop-2021-v22.html',
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/',
      'https://helpx.adobe.com/photoshop/using/modify-shapes.html',
    ],
  },

  polygon: {
    photoshopName: 'Polygon Tool',
    summary:
      'Drag-defined polygon of any number of sides, with the side count set before the draw; the star of a given point count is a separate tool.',
    purpose:
      'The Polygon tool is drag-defined, not a click-to-place-vertices tool: Adobe says to click and drag on the canvas, and the ordinary reading of that is a regular n-gon inscribed in the drag box — the regularity is this description’s inference, not Adobe’s wording. Sides sets the n before the draw and defaults to 5. The star is not this tool’s to draw in the current release: Adobe’s tools list puts a separate Star tool in the same shapes group, and the star attributes — the number of points, the Inner Radius that sets the depth of the indents and the Outer Radius that sets the length of the spikes — are documented on that tool, in the Contextual Task Bar and the Properties panel. Shift constrains proportions, Alt/Option draws from the centre — though a polygon is already centred in its drag box — and Control/Cmd while dragging rotates it. A single Radius control rounds every corner at once. The result is a Live Shape whose side count stays editable in the Properties panel.',
    options: [
      ...sharedFigureOptions,
      {
        control: 'Sides',
        detail:
          'Number of sides the drag produces, default 5. The star’s indent control is not on this tool’s bar in the current release: Adobe lists a separate Star tool in the same group, and carries the point count and the inner and outer radii there.',
        status: 'missing',
      },
      missingRadiusControl,
    ],
    modifiers: [
      {
        keys: 'Shift',
        action: 'Constrains proportions while the shape is drawn; the constraint is off by default in the gear menu.',
      },
      altFromCenterModifier,
      {
        keys: 'Control',
        action: 'Changes the angle of the polygon, rotating it, while drawing.',
      },
      spaceRepositionModifier,
    ],
    shortcuts: [
      { keys: 'U', action: 'Selects the shapes tool group.' },
      { keys: '[', action: 'Decreases the number of sides by one; hold Shift to step by ten.' },
      { keys: ']', action: 'Increases the number of sides by one; hold Shift to step by ten.' },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:328',
      'src/tools/shape.ts:186',
      'src/tools/shape.ts:189',
      'src/components/ToolbarsRight/Figures/Shape.tsx:165',
      'src/tools/settings.ts:286',
    ],
    appNotes:
      "The load-bearing premise is right here: the app builds a regular n-gon in the drag box, so the drag-defined model is already correct and the side count is 5 by default, matching Photoshop — though the regularity itself is an inference from Adobe's drag instruction rather than something Adobe states. Everything after that is missing. The side count is a hardcoded three-way ternary — figure === 'triangle' ? 3 : 5 — so there is no Sides field and no way to draw a hexagon; and the star is not this tool's to draw in the current release, so there is nothing here to compare a star Ratio against. The Radius field is withheld from the bar for this figure, matching the app's rectangle-only gate but not Photoshop, which third-party sources say offers it. Shift squares the drag box rather than constraining the polygon's own proportions, and the Control-drag rotation the Polygon tool has over every other figure is not implemented.",
    sources: [
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html',
      'https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
    ],
  },

  'custom-shape': {
    photoshopName: 'Custom Shape Tool',
    summary: "Draws a preset vector graphic from Photoshop's shape library, or one you define from a path.",
    purpose:
      'The Custom Shape tool draws any of the vector presets in Photoshop’s shape library — a library that includes the Leaf Trees, Wild Animals, Boats and Flowers groups, with the full set reached through Legacy Shapes and More in the Shapes panel. Those four were the default loaded groups in a 2020 account, and Adobe Community threads from 2019–2021 report that the picker changed and moved them behind Legacy Shapes and More, so what a current install shows on first launch is not established here. Third-party accounts, not Adobe’s own documentation, say this is the only shape tool whose Shift constraint preserves the drawn shape’s own aspect ratio rather than squaring the drag box, so a recognisable graphic comes out undistorted. Its Path Operations menu is where the boolean work happens: New Shape Layer, Combine Shapes, Subtract Front Shape — which Adobe’s 2022 wording calls Subtract From Shape Area — Intersect Shape Areas, Exclude Overlapping Shapes, and Merge Shape Components, which converts the live shape into a plain path and warns you that it can no longer be edited component by component. No single Adobe page enumerates that whole set. Any path — drawn with the Pen tool, made from a shape layer, or produced by converting text to a path — becomes a new preset through Edit ▸ Define Custom Shape, and Preset Manager saves and loads the result as a `.csh` file.',
    options: [
      modeControl,
      {
        control: 'Fill',
        detail:
          'The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.',
        status: 'missing',
      },
      strokeControl,
      strokeWidthControl,
      strokeTypeControl,
      weightControl,
      opacityControl,
      pixelBlendModeControl,
      antiAliasControl,
      {
        control: 'Shape Picker',
        detail:
          'Opens the shape library as a grid of thumbnails, grouped by theme, with a fly-out that reaches Preset Manager, the Reset Shapes command and the Legacy Shapes and More set. Shift while dragging is reported to draw the preset at its own aspect ratio, on third-party authority.',
        status: 'missing',
      },
      shapeWHControl,
      pathOperationsControl,
      pathArrangementControl,
      pathAlignmentControl,
      gearControl,
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Draws the preset at its own original width-to-height ratio instead of filling the drag box — a third-party account, not a sentence from Adobe’s current documentation.',
      },
      altFromCenterModifier,
      spaceRepositionModifier,
    ],
    shortcuts: [{ keys: 'U', action: 'Selects the shapes tool group.' }],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:330',
      'src/tools/toolsMap.ts:158',
      'src/tools/settings.ts:300',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28',
    ],
    appNotes:
      "Registered, selectable, and a dead button. The processor row declares commit: 'unimplemented' and wires the shared unimplemented rasterizer, the tools map renders PlaceholderTool with a TODO badge, and the only state the settings hold is the tool name — no shape preset, no fill, no geometry. The placeholder panel does list Photoshop’s real control names for this bar, so the six chips a user sees are the genuine Photoshop set rather than placeholders for placeholders: Tool Mode, Fill, Stroke, W/H, Shape Picker, Path Operations. Subtract needs a multi-subpath model with a fill rule, which a single convex outline cannot express, so the boolean operations are not a bar toggle away; they are a data-model decision first.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html',
      'https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/',
      'https://www.adobe.com/products/photoshop/shapes.html',
      'https://tonton-pixel.codeberg.page/photoshop-file-formats/custom-shapes-file-format.html',
      'https://www.makeuseof.com/photoshop-path-operations-add-subtract-intersect-exclude/',
      'https://www.pcworld.com/article/399355/photoshop-shapes-what-they-are-and-how-to-use-them.html',
      'https://community.adobe.com/questions-712/where-do-i-get-photoshop-custom-shapes-it-needs-csh-files-1137992',
      'https://glensmith.co.uk/photoshop/custom-shape-tool',
    ],
  },
};
