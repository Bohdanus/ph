import type { ToolControl, ToolDescription, ToolModifier, ToolShortcut } from './types.ts';

/**
 * The FIRST of the two rows in this file whose `control` is `Mode`.
 *
 * `types.ts:39-42` makes `control` the name Photoshop's options bar prints, verbatim, and
 * Adobe prints `Mode` twice on this bar: once for the three-button drawing-mode group at
 * its left end, and once for the blend mode it adds in Pixel mode. Renaming either row
 * would break the one rule that field exists to enforce, so the collision is resolved in
 * `detail` instead — each row says which `Mode` it is and where the control sits. This is
 * the same move `pathModeOperationControl` makes below for `Operation` against `Path
 * Operations`, and the same one the `Path Operations` row already makes.
 */
const modeControl: ToolControl = {
  control: 'Mode',
  detail:
    'The first of the two controls Adobe names Mode, and the one at the left of the bar: the three-button drawing-mode group, where Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.',
  status: 'partial',
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:137',
};

const fillControl: ToolControl = {
  control: 'Fill',
  detail:
    'The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.',
  status: 'partial',
  // The bar's one `Filled` checkbox, which is this control's whole rendering here. The
  // processor lines it used to cite (`setShapeCtx`) read `hasFill`; they are where the
  // value is consumed, not where the control is drawn.
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:212',
};

const strokeControl: ToolControl = {
  control: 'Stroke',
  detail:
    'The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.',
  status: 'partial',
  // The same checkbox as `Fill`, which is the point: one rendering backs both rows, and
  // what it cannot express is either swatch's own menu.
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:212',
};

const strokeWidthControl: ToolControl = {
  control: 'Stroke width',
  detail: 'Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.',
  status: 'partial',
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:161',
};

const strokeTypeControl: ToolControl = {
  control: 'Stroke type',
  detail:
    'Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel), which Adobe qualifies as "not applicable to the Line tool" because a line has no corners. Centered alignment, a solid line and a Butt cap are the defaults.',
  status: 'partial',
  // The app's own line-style rendering, not a Stroke Options panel: the `Dashed`
  // checkbox and the Dash and Gap sliders it reveals.
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:227',
};

const weightControl: ToolControl = {
  control: 'Weight',
  detail:
    'Thickness of the path, and it means two different things by mode. In Path mode — and in Shape mode for every figure except the Line tool — Adobe documents it as "Set the width of the path in pixels (visual reference only)": a display aid for the on-screen outline, which never prints and never appears in a saved image. In Pixel mode it is the width that actually paints, "Set the width of the line or shape edge in pixels". The Line tool is the exception in Shape mode, where Adobe\'s own instruction is to "choose Shape mode in the Options bar and then set the Stroke and Weight": a line has no filled area, so there the weight is the stroke itself.',
  status: 'missing',
};

const opacityControl: ToolControl = {
  control: 'Opacity',
  detail:
    'Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.',
  status: 'partial',
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:292',
};

/**
 * The SECOND of the two rows whose `control` is `Mode`, and a different control.
 *
 * Adobe's Pixel-mode bar really does label a blend-mode control `Mode`, which is why
 * `types.ts:39-42` cannot be satisfied by inventing a name here. The `detail` therefore
 * opens by saying which of the two `Mode` rows this is and names the other one by its
 * position, so a reader of the generated table — where both rows print as `Mode` — can
 * tell them apart without leaving the row.
 */
const pixelBlendModeControl: ToolControl = {
  control: 'Mode',
  detail:
    'The second of the two controls Adobe names Mode, and a different control from the three-button drawing-mode group at the left of the bar: the blend mode the rasterized shape composites with, chosen from the full layer blend-mode list. Pixel mode only, and it sits at the right-hand end of the bar in the group with Opacity and Anti-alias, which Shape and Path modes do not have either.',
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

/**
 * Path mode's own row, and it is not the Shape-mode Path Operations control.
 *
 * Adobe names the two differently and gives them different jobs: the bar icon is the
 * "Path Operations icon: Show or hide path operation buttons", while `Operation` is a
 * Path-mode setting on the same page — "Select how new paths interact with existing
 * paths (Add, Subtract, Intersect, or Exclude)". Folding the two together would lose
 * one of them, so this is a separate row and the `detail` says which is which.
 */
const pathModeOperationControl: ToolControl = {
  control: 'Operation',
  detail:
    'Path mode only: how a new path interacts with the paths already there — Add, Subtract, Intersect or Exclude. This is the Path-mode setting, not the Path Operations control, which is the separate show/hide for the Shape-mode operation buttons.',
  status: 'missing',
};

const gearControl: ToolControl = {
  control: 'Set additional shape and path options',
  detail:
    'The gear at the right of the bar, which Adobe describes as setting "additional Path options, Live Shapes Controls, Arrowheads, and more". Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Arrowheads, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral.',
  status: 'missing',
};

const shapeWHControl: ToolControl = {
  control: 'Shape W&H',
  detail:
    'Exact width and height for the next shape, set on the bar before the draw. A click with no drag opens a Create <Shape> dialog, which Adobe documents for two of the figures: the rectangle, where you manually set "the dimensions, corner radii of your rectangle, and choose to align from centre", and the triangle, which adds Corner Radius, Equilateral and From Center — so exact geometry can be typed instead of dragged. The Line tool has no click dialog; Adobe documents the drag and the release only.',
  status: 'partial',
  // The app reaches the same geometry, but not through this control: its bar carries no W/H
  // entry at all, and the size is entered from a bare click that opens the `CreateShapeDialog`
  // modal. So the appRef is the click that opens the dialog rather than one of the dialog's
  // fields, because the divergence this row is filed `partial` for is the entry point — the
  // fields are the Adobe `detail` above, and the field-by-field comparison is in each figure's
  // `appNotes`.
  appRef: 'src/components/Main/ShapeToolArea.tsx:205',
};

/**
 * Bar order, and the order is two enumerations composed rather than one list.
 *
 * `modify-shapes.html` walks the Rectangle bar as Mode, Fill, Stroke, Stroke width,
 * Stroke type, Shape W&H, path operations, path alignment, path arrangement, the gear,
 * Radius — which is where `Shape W&H` sits, and it is NOT last. The mode-by-mode page
 * then adds `Weight` after the stroke settings and puts the gear after it. The three
 * Pixel-mode-only rows have no place on that bar at all, so they come last.
 */
const sharedFigureOptions: readonly ToolControl[] = [
  modeControl,
  fillControl,
  strokeControl,
  strokeWidthControl,
  strokeTypeControl,
  shapeWHControl,
  pathOperationsControl,
  pathAlignmentControl,
  pathArrangementControl,
  pathModeOperationControl,
  weightControl,
  gearControl,
  pixelBlendModeControl,
  opacityControl,
  antiAliasControl,
];

const radiusDetail =
  'Rounds the shape corners in pixels, default 0 px. Adobe documents the control on the Rectangle tool ("Radius of rounded corners: Manually set the radius…") and on the Triangle tool ("specify Width, Height, and Corner Radius"); the Ellipse and Line tools have no rounded corners. The Rectangle tool keeps four independent radii and the Triangle tool a single value that rounds every corner at once. Whether the Polygon tool offers it is third-party only — no Adobe page listing the Polygon tool’s bar was found — so the polygon half of that gap is a judgment, not a match.';

const radiusControl: ToolControl = {
  control: 'Radius',
  detail: radiusDetail,
  status: 'present',
  // Where the control is DRAWN, per the rule the Fill and Stroke rows above state:
  // this is the `figure === 'rectangle'` gate and the Radius slider it wraps. The
  // processor line `src/tools/shape.ts:240` is `const radius = args.cornerRadius ?? 0`,
  // which is where the value is consumed, not where the control is drawn.
  appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:182',
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

const lineShiftModifier: ToolModifier = {
  keys: 'Shift',
  action: 'Constrains the line angle to a multiple of 45 degrees, so the segment lands on a compass bearing.',
};

const spaceRepositionModifier: ToolModifier = {
  keys: 'Space',
  action: 'Repositions the shape while the drag is still in progress, without changing its size.',
};

/**
 * `U` and `Shift+U` are the group's own bindings, and both are narrower than the group.
 *
 * Plain `U` has a deliberate quirk worth stating rather than smoothing over: the five
 * geometric figures all resolve to ONE app tool name and differ only by a `figure` field,
 * so U from any of them keeps the figure it is already on. The Custom Shape tool is the
 * exception, because it carries its own tool name, and U from there falls back to the
 * rectangle. `Shift+U` cycles the four entries the app actually holds against a six-entry
 * flyout, and an unlisted figure does not skip forward — it indexes to `-1` and comes back
 * as the first entry, so the Triangle and the Polygon restart the cycle rather than
 * advancing it.
 */
const shapeGroupShortcut: ToolShortcut = {
  keys: 'U',
  action:
    'Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.',
};

const shapeCycleShortcut: ToolShortcut = {
  keys: 'Shift+U',
  action:
    'Cycles to the next tool in the shapes tool group, through the four the app’s cycle holds: rectangle, ellipse, line and Custom Shape. The Triangle and the Polygon are in the rail’s flyout but not in the cycle, and an unlisted figure does not skip ahead — Shift+U from either of them restarts at the rectangle instead of advancing.',
};

const shapeToolShortcuts: readonly ToolShortcut[] = [shapeGroupShortcut, shapeCycleShortcut];

/**
 * The Custom Shape bar is the placeholder panel, so every control whose name is in this
 * chip list renders as a static `<span>` on a panel with a TODO badge and nothing reads it.
 * That is `inert` under the contract, not `missing` — the control name is on screen, which
 * is exactly what makes it dangerous, and `missing` would deny a fact a screenshot shows.
 * The controls with no chip in the list are `missing` and carry no `appRef` at all.
 */
const CUSTOM_SHAPE_CHIPS = 'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:37';

/**
 * Drop the `appRef` key rather than blanking it.
 *
 * `{ ...shared, appRef: undefined }` satisfies the type and puts a present, value-less
 * key on the row, which is the opposite of what the contract asks for: `appRef` is required
 * for every status except `missing` and must be absent from a `missing` row. Rest-destructuring
 * is the only form that makes the property genuinely not exist, so `'appRef' in row` is false
 * and the generated table and the `Object.keys` walk both agree with the contract.
 */
const withoutAppRef = ({ appRef: _appRef, ...control }: ToolControl): ToolControl => control;

export const shapeDescriptions: Record<
  'shape' | 'rectangle' | 'ellipse' | 'line' | 'triangle' | 'polygon' | 'custom-shape',
  ToolDescription
> = {
  shape: {
    photoshopName: 'Shape Tool (the Tools panel group; no entry by that name)',
    summary: 'Draws a vector shape, a path, or a filled pixel region, and stamps it onto its own shape layer.',
    purpose:
      'Adobe’s Tools panel has no entry named “Shape Tool”, so there is no Photoshop tool behind this one: the panel groups seven separate tools — Rectangle, Ellipse, Triangle, Polygon, Star, Line and Custom Shape — behind a single group icon, and the Star arrived as a tool of its own in 26.10. Whichever of the seven is active, the three-button Mode group at the left of the options bar decides what a drag commits — a filled shape layer with a vector mask, a work path with no pixels at all, or a rasterized region painted straight into the active layer. Fill and Stroke are set independently of each other and of the drawing mode, so the same rectangle can be a solid block, a hairline outline, or an outline over a gradient. The drawn shape stays a Live Shape, so its fill, stroke, corner radius and dimensions remain editable from the Properties panel long after the drag.',
    options: sharedFigureOptions,
    modifiers: [shiftSquareModifier, altFromCenterModifier, spaceRepositionModifier],
    shortcuts: shapeToolShortcuts,
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:159',
      'src/tools/shape.ts:194',
      'src/tools/shape.ts:93',
      'src/components/ToolbarsRight/Figures/Shape.tsx:21',
      'src/tools/toolsMap.ts:63',
    ],
    appNotes:
      'The largest gap in the group is a tool the app does not have at all: Photoshop’s shapes group is seven entries and this app’s fly-out is six — Rectangle, Ellipse, Line, Triangle, Polygon and Custom Shape (`toolbar-mapping.ts:128-135`) — so there is no Star here, and the `shape` registry entry this description hangs off is the group container rather than a tool the rail ever displays. The processor is live and every drag commits a layer, so nothing here is a placeholder, but the group diverges from Photoshop in three further ways worth naming. Path mode does not create a path: the mode only suppresses the fill inside the rasterizer, so a Path-mode shape still rasterizes to a layer with a stroke. Pixels mode is not a mode of its own: the figure is rasterized and put on a new layer exactly as in Shape mode, where Photoshop paints straight into the active layer and leaves nothing new in the Layers panel. And the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all. A click with no drag is the group’s one place where the app meets Adobe head-on: Adobe documents the click dialog in a single sentence, for the rectangle — "Click on the canvas to bring up the Create Rectangle dialog" — and the app opens a `CreateShapeDialog` modal for every figure except the Line, titled per figure, offering Width, Height and From Center, plus a Corner Radius field on the rectangle that is seeded from that figure’s live Radius slider and applied to the layer being created rather than to the bar. The click itself commits nothing: OK is the only commit, Cancel, the backdrop, the header × and Escape all close without one, and OK is disabled outright while a dimension is under 1 px. The Line is the exception and is excluded by contract rather than by taste — Adobe documents the drag and the release for it and never names a Create Line dialog, so a click there refuses on the console instead of inventing a dialog Adobe has not got. What the dialog still leaves out is per-figure rather than shared, and the triangle and polygon entries below each name their own figure’s gaps against what this renderer can honour.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207',
      'https://helpx.adobe.com/photoshop/using/modify-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html',
      'https://community.adobe.com/questions-712/photoshop-v26-10-create-the-perfect-star-shape-for-your-designs-and-multiple-enhancements-1181840',
      'https://www.cgchannel.com/2025/08/adobe-releases-photoshop-26-10/',
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
    shortcuts: [shapeGroupShortcut],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:326',
      'src/tools/shape.ts:225',
      'src/tools/shape.ts:240',
      'src/components/ToolbarsRight/Figures/Shape.tsx:182',
      'src/tools/settings.ts:278',
    ],
    appNotes:
      'The drag geometry, Shift, Alt and the corner radius all behave as they do in Photoshop, and the radius is clamped to half the shorter side exactly as a rounded rectangle must be. That is the whole of what is right, and the divergences below are why the verdict is `partial` and not `implemented`. The three the group carries apply to the Rectangle verbatim: Path mode does not create a path, Pixels mode rasterizes onto a new layer exactly as Shape mode does rather than painting into the active one, and the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all. The Rectangle adds two divergences of its own, and the first is a default rather than a gap: it seeds a 5 px stroke where Photoshop seeds 1 px, so an untouched rectangle is drawn five times as heavy as Photoshop would draw it. The Radius slider runs 0–250 px with no numeric entry on the bar, and only the rectangle gets a radius — the app gates the whole control on this figure. Fill and Stroke are on the bar, then, and `partial` in the table above is the honest reading of them: what the app renders is a single wired `Filled` checkbox over its one shared colour, and it is the separate swatches with their None / Solid / Gradient / Pattern menu that are missing, not the controls. The mode group, the stroke width, the stroke type and the opacity each diverge from Photoshop’s control in the same way, and the path weight, the pixel-mode blend mode, the anti-alias control, the three path-operation rows and the gear are absent outright. A bare click is where this figure is at its closest: Adobe’s one documented sentence is this figure’s own, and all four of the fields it names — Width, Height, corner radii and align from centre — are in the app’s Create Rectangle dialog, so nothing is left over on this figure. The corner radius is seeded from the bar’s live slider and applied to the layer being created, so a radius typed in the dialog does not rewrite the slider behind the user’s back. What diverges is the entry point rather than the fields: `Shape W&H` is a control on Photoshop’s bar and this app’s bar has none, so here the exact geometry is reachable only by opening the dialog with a click.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/modify-shapes.html',
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207',
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
    shortcuts: [shapeGroupShortcut],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:327',
      'src/tools/shape.ts:249',
      'src/tools/shape.ts:93',
      'src/components/ToolbarsRight/Figures/Shape.tsx:14',
      'src/tools/settings.ts:285',
    ],
    appNotes:
      'The geometry matches: the ellipse is drawn as a real ctx.ellipse from the half-extents of the drag box, and Shift produces a true circle rather than a square-boxed oval. That is the whole of what is right, and the divergences below are why the verdict is `partial` and not `implemented`. The three the group carries apply to the Ellipse verbatim: Path mode does not create a path, Pixels mode rasterizes onto a new layer exactly as Shape mode does rather than painting into the active one, and the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all. The Ellipse then carries the same wrong default as every other figure, a 5 px stroke where Photoshop seeds 1 px, and keeps a cornerRadius: 0 key in its persisted defaults for a control its own bar withholds. Withholding Radius is the app’s rectangle-only gate, and that is a judgment about Photoshop rather than a documented match, since the only evidence for it is a third-party page and no desktop Adobe page enumerating the Ellipse tool’s bar was found. The bar itself is the shared one — the Ellipse gets no control of its own, so the options bar names it and shows the same controls every figure gets: the tool-mode select, the thickness slider, the Filled checkbox, the dashed toggle with its dash and gap sliders, the opacity slider and the live preview. That is the same set the rectangle has minus the radius, so the same reading applies to each: fill and stroke are on the bar as a wired Filled checkbox over one shared colour rather than as Photoshop’s two swatches, the mode group, the stroke type and the opacity each diverge from Photoshop’s control, and the path weight, the pixel-mode blend mode, the anti-alias control, the three path-operation rows and the gear are absent outright. A bare click opens the app’s Create Ellipse dialog, titled per figure, with Width, Height and From Center and no corner radius — the same gate as the bar’s, on a figure whose corners are not rounded anywhere on either side. Adobe’s own documentation of a click dialog is the rectangle’s, so this figure’s dialog is the app’s field set rather than a documented one.',
    sources: [
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/create-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207',
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
        appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:197',
      },
      {
        control: 'Arrowheads',
        detail:
          'Start and End toggles that put an arrowhead on either or both ends of the line, sized by Width and Length and shaped by Concavity, which Adobe documents as a value "between -50% and +50%" controlling "the curve where the arrowhead meets the line". Adobe places the panel in the Arrowheads section of the Contextual Task Bar (Window > Contextual Task Bar) with the tool selected; it is never a field in the options bar, and the Concavity default could not be sourced to a current Adobe page.',
        status: 'missing',
      },
    ],
    modifiers: [lineShiftModifier, altFromCenterModifier, spaceRepositionModifier],
    shortcuts: [shapeGroupShortcut],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:330',
      'src/tools/shape.ts:200',
      'src/tools/shape.ts:101',
      'src/components/ToolbarsRight/Figures/Shape.tsx:197',
      'src/tools/settings.ts:306',
    ],
    appNotes:
      'The drag is the tool, and the drag is right: `normalizeShapeGeometry` routes the line figure to `snapLineGeometry`, which quantizes the drag angle to `LINE_ANGLE_STEP` — `Math.PI / 4` — so a Shift-drag snaps to a multiple of 45 degrees exactly as Adobe specifies, and unlike every other figure the line is not squared by Shift. The two things that are missing are the arrowheads and the shape of the bar. Arrowheads are absent outright — `drawShape` strokes a bare moveTo/lineTo pair, with no start or end cap geometry — which is why a line here can never become an arrow, and that is what keeps the verdict at `partial` rather than `implemented`: the tool that draws arrows does not draw them. The Cap select the app renders for this figure offers Photoshop’s three cap styles but only the Line figure gets one, where Photoshop offers caps for any stroked path, through the Stroke Options panel rather than a bar-level select. A bare click gets no dialog at all on this figure, and that is the contract rather than a gap: Adobe documents the Line tool as a drag and a release and never names a Create Line dialog, so the click refuses on the console instead of opening a dialog Adobe has not got. A line has no Width and Height on Adobe’s side either, so the drag is the only place either can give it a length.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207',
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
    shortcuts: [shapeGroupShortcut],
    implementation: 'partial',
    implementationRefs: [
      'src/tools/toolProcessors.ts:328',
      'src/tools/shape.ts:205',
      'src/tools/shape.ts:210',
      'src/tools/shape.ts:103',
      'src/tools/settings.ts:292',
    ],
    appNotes:
      'The geometry is wrong in the specific way the premise correction warns about. The app inscribes a regular three-sided polygon in the drag box, so a wide drag yields a squat isosceles-looking triangle only by accident, and Shift squares the drag box instead of forcing equilateral — for a 3-gon inscribed in a square box, that is not h = √3⁄2 · w. Because the figure is built by the shared triangle/polygon branch, its Radius field is both absent from the bar and unimplemented in the renderer, so its corners can never be rounded. The Shift behaviour is version-dependent in wording only: the equilateral constraint has been the tool’s Shift since 2021 (v22), and later versions add the persistent Equilateral checkbox to the gear menu. A bare click opens the app’s Create Triangle dialog with Width, Height and From Center, so of the five things Adobe documents for this figure’s click dialog — Width, Height, Corner Radius, Equilateral and From Center — three can be typed here and two are gaps. Equilateral is absent outright, and it is the same gap the Shift row above reaches from the other direction. Corner Radius is withheld rather than absent: `drawShape` reads `cornerRadius` in its rectangle branch only, so a triangle field would take a value and round nothing, and this figure’s corners cannot be rounded here either way.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/triangle-tool.html',
      'https://jkost.com/blog/2020/10/adobe-announces-updates-to-photoshop-2021-v22.html',
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/',
      'https://helpx.adobe.com/photoshop/using/modify-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207',
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
        status: 'present',
        // Required by toolDescriptions.test.ts for every status but `missing`, and it is
        // the point of the field: the gate that keeps it off the other four figures is
        // the line above this one, and the input itself is the control.
        appRef: 'src/components/ToolbarsRight/Figures/Shape.tsx:252',
      },
      missingRadiusControl,
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Constrains the drag to a box whose sides match, so the polygon comes out symmetrical; reported to be off by default in the gear menu, which is a third-party account rather than an Adobe sentence.',
      },
      altFromCenterModifier,
      spaceRepositionModifier,
    ],
    shortcuts: [shapeGroupShortcut],
    implementation: 'partial',
    implementationRefs: [
      // Re-derived from the sentences, not shifted: `toolProcessors.ts:329` was the
      // ERASER entry's `commit: 'raster'`, and `shape.ts:205`/`:210` pointed at
      // `if (figure === 'line')` and the `} else if` that follows it. Nothing
      // checked the line's content, so every one of them still read plausibly.
      'src/tools/toolProcessors.ts:372',
      'src/tools/shape.ts:216',
      'src/tools/shape.ts:245',
      'src/components/ToolbarsRight/Figures/Shape.tsx:250',
      'src/tools/settings.ts:58',
    ],
    appNotes:
      "The load-bearing premise is right here: the app builds a regular n-gon in the drag box, so the drag-defined model is already correct, and the side count is a real setting seeded at 5, matching Photoshop — though the regularity itself is an inference from Adobe's drag instruction rather than something Adobe states. Sides is on the bar for this figure, takes the integers 3 through 100 — Adobe's own floor and ceiling — and persists per figure. What is still missing is the Star tool the same group carries, so a star Ratio has nothing here to compare against. The `[` and `]` rows Photoshop gives this tool are still absent from the table above, but the reason has changed and the old one would now be a falsehood: the side count does exist at runtime, and the gap is that the app's bracket keys reach only the eight tools that carry a tip Size, so they have nothing to act on. The Radius field is withheld from the bar for this figure, matching the app's rectangle-only gate but not Photoshop, which third-party sources say offers it. Shift squares the drag box rather than constraining the polygon's own proportions, and the Control-drag rotation the Polygon tool has over every other figure is not implemented — which is why `Control` is absent from the `modifiers` table above: in this app holding it while drawing a polygon changes nothing. A bare click opens the app's Create Polygon dialog with Width, Height and From Center, and no field of this figure's own geometry is in it: the dialog commits the bar's current Sides rather than taking one of its own. The polygon is the one figure whose full click-dialog list Adobe published and then stopped publishing: a January 2021 archive of `drawing-shapes.html` names Symmetric, Number of Sides, Corner Radius, Star Ratio and Smooth Star Indents beside Width & Height and From Center, and the current page carries none of them — and of those the renderer reads only Number of Sides, from the bar rather than from the dialog, because no star or indent argument is read at all. Those are gaps rather than withheld fields, and the dialog is not where any of them can be closed.",
    sources: [
      'https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/',
      'https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html',
      'https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207',
    ],
  },

  'custom-shape': {
    photoshopName: 'Custom Shape Tool',
    summary: "Draws a preset vector graphic from Photoshop's shape library, or one you define from a path.",
    purpose:
      'The Custom Shape tool draws any of the vector presets in Photoshop’s shape library — a library that includes the Leaf Trees, Wild Animals, Boats and Flowers groups, with the full set reached through Legacy Shapes and More in the Shapes panel. Those four were the default loaded groups in a 2020 account, and Adobe Community threads from 2019–2021 report that the picker changed and moved them behind Legacy Shapes and More, so what a current install shows on first launch is not established here. Third-party accounts, not Adobe’s own documentation, say this is the only shape tool whose Shift constraint preserves the drawn shape’s own aspect ratio rather than squaring the drag box, so a recognisable graphic comes out undistorted. Its Path Operations menu is where the boolean work happens: New Shape Layer, Combine Shapes, Subtract Front Shape — which Adobe’s 2022 wording calls Subtract From Shape Area — Intersect Shape Areas, Exclude Overlapping Shapes, and Merge Shape Components, which converts the live shape into a plain path and warns you that it can no longer be edited component by component. No single Adobe page enumerates that whole set. Any path — drawn with the Pen tool, made from a shape layer, or produced by converting text to a path — becomes a new preset through Edit ▸ Define Custom Shape, and Preset Manager saves and loads the result as a `.csh` file.',
    /**
     * The same bar in the same order, with one row this tool adds.
     *
     * The sequence is `sharedFigureOptions` verbatim — the family's declared bar order,
     * which the comment above that list derives from `modify-shapes.html` and the
     * mode-by-mode page — with `Shape Picker` at its head. The rows that differ from the
     * shared list are the `status` and the `appRef`, and only those: they are the chip
     * list's doing, not a claim about Photoshop's order. Nothing in the earlier version
     * of this list was sourced as a different order — it simply ran the shared rows out in
     * a different sequence, which contradicted the order the same file declares two
     * hundred lines above it, so the list is aligned rather than defended.
     *
     * The picker's position is the one judgment here, and it is recorded rather than
     * hidden: no Adobe page opened in this pass enumerates the Custom Shape bar in bar
     * order (`draw-custom-shapes.html` documents the tool and the picker, not the order
     * of the bar), so this row leads the bar on the same reasoning the rest of the list
     * runs on — it is the only control that chooses which shape is drawn, and every row
     * after it modifies that choice.
     */
    options: [
      {
        control: 'Shape Picker',
        detail:
          'Opens the shape library as a grid of thumbnails, grouped by theme, with a fly-out that reaches Preset Manager, the Reset Shapes command and the Legacy Shapes and More set. Shift while dragging is reported to draw the preset at its own aspect ratio, on third-party authority.',
        status: 'inert',
        appRef: CUSTOM_SHAPE_CHIPS,
      },
      { ...modeControl, status: 'inert', appRef: CUSTOM_SHAPE_CHIPS },
      { ...fillControl, status: 'inert', appRef: CUSTOM_SHAPE_CHIPS },
      { ...strokeControl, status: 'inert', appRef: CUSTOM_SHAPE_CHIPS },
      withoutAppRef({ ...strokeWidthControl, status: 'missing' }),
      withoutAppRef({ ...strokeTypeControl, status: 'missing' }),
      {
        ...shapeWHControl,
        status: 'inert',
        appRef: CUSTOM_SHAPE_CHIPS,
      },
      { ...pathOperationsControl, status: 'inert', appRef: CUSTOM_SHAPE_CHIPS },
      withoutAppRef({ ...pathAlignmentControl, status: 'missing' }),
      withoutAppRef({ ...pathArrangementControl, status: 'missing' }),
      withoutAppRef({ ...pathModeOperationControl, status: 'missing' }),
      withoutAppRef({ ...weightControl, status: 'missing' }),
      withoutAppRef({ ...gearControl, status: 'missing' }),
      withoutAppRef({ ...pixelBlendModeControl, status: 'missing' }),
      withoutAppRef({ ...opacityControl, status: 'missing' }),
      withoutAppRef({ ...antiAliasControl, status: 'missing' }),
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Draws the preset at its own original width-to-height ratio instead of filling the drag box — a third-party account, echoed by an Adobe training partner’s modifier cheat sheet and stated in no Adobe help page.',
      },
      altFromCenterModifier,
      spaceRepositionModifier,
    ],
    shortcuts: [shapeGroupShortcut],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:331',
      'src/tools/toolProcessors.ts:110',
      'src/tools/toolsMap.ts:159',
      'src/components/Main/Main.tsx:82',
      'src/tools/settings.ts:313',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:37',
    ],
    appNotes:
      "Registered, selectable, and a dead button. The processor row declares commit: 'unimplemented' and wires the shared unimplemented rasterizer, the tools map renders PlaceholderTool with a TODO badge, and the only state the settings hold is the tool name — no shape preset, no fill, no geometry. The placeholder panel does list Photoshop’s real control names for this bar, so the six chips a user sees are the genuine Photoshop set rather than placeholders for placeholders: Tool Mode, Fill, Stroke, W/H, Shape Picker, Path Operations. That is why those six rows read `inert` and not `missing` — the names are on screen and nothing is wired behind any of them, which is the exact shape the `inert` status exists for. The three rows that were `partial` above are also `missing` rather than partial, but for the opposite reason: Stroke width, Stroke type and Opacity have no chip in this tool's list at all, and the real shape bar that carries them never renders here, because this tool is absent from the canvas dispatch that gives the other five figures their gesture surface. It is a `display: none` area, so the three modifiers named above — Shift, Alt and Space — are bound to nothing either, and the app’s Shift constraint, which squares the drag box for every figure except the line, has no drag to apply to. That is also the whole of the app side of the Shape W&H row: a bare click opens a Create <Figure> dialog on the five figures that mount `ShapeToolArea`, and this tool mounts `DummyToolArea` instead, so none of that runs here and a click with no drag does nothing rather than opening a sized dialog. Subtract needs a multi-subpath model with a fill rule, which a single convex outline cannot express, so the boolean operations are not a bar toggle away; they are a data-model decision first.",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://community.adobe.com/questions-712/how-to-change-shape-tool-options-1181207',
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
