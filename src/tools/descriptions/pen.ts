import type { ToolDescription } from './types.ts';

const PEN_PLACEHOLDER_CHIPS = 'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14';

const PEN_SOURCES = [
  'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html',
  'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-paths-with-the-pen-tool.html',
  'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
  'https://helpx.adobe.com/photoshop/using/editing-paths.html',
  'https://helpx.adobe.com/photoshop/using/paths.html',
  'https://helpx.adobe.com/photoshop/using/tool-techniques/pen-tool.html',
  'https://helpx.adobe.com/photoshop/using/drawing.html',
  'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html',
  'https://www.adobe.com/products/photoshop/pen-tool.html',
] as const;

const CURVATURE_SOURCES = [
  'https://helpx.adobe.com/ph_fil/photoshop/how-to/draw-edit-curves-curvature-tool.html',
  'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
  'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html',
  'https://helpx.adobe.com/photoshop/using/editing-paths.html',
  'https://www.photoshopessentials.com/basics/use-curvature-pen-tool-photoshop-cc-2018',
  'https://photoshoptrainingchannel.com/photoshop-cc-2018-tutorials',
  'https://www.creativebloq.com/news/photoshop-to-launch-new-curvature-pen-tool',
  'https://www.adobe.com/products/photoshop/pen-tool.html',
] as const;

const ANCHOR_TOOL_SOURCES = [
  'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html',
  'https://helpx.adobe.com/photoshop/using/editing-paths.html',
] as const;

const NO_APP_OPTIONS =
  'The app registers this tool, but it has no options bar of its own: the panel it renders is the shared amber placeholder with a TODO badge, and every control below is that placeholder chip rather than a working control. The tool carries a single state key, its own name, so there is no setting behind any chip to be out of range. Selecting the tool changes nothing on the canvas — there is no path layer, no anchor point and no stroke to place.';

export const penDescriptions: Record<
  'pen' | 'freeform-pen' | 'curvature-pen' | 'add-anchor-point' | 'delete-anchor-point' | 'convert-point',
  ToolDescription
> = {
  pen: {
    photoshopName: 'Pen Tool',
    summary:
      'Draws precise vector paths from click-placed anchor points, with draggable direction handles for the curves between them.',
    purpose:
      'The Pen tool builds a path of straight and curved segments by clicking to place anchor points and dragging to pull out the direction handles that shape each curve. It draws no pixels: Path mode creates a work path in the Paths panel, which draws nothing on the canvas and can be stroked, filled or loaded as a selection later. The drawing mode group decides which of those you get — Shape makes a filled, stroked shape layer, Path makes the work path, Pixels rasterizes straight onto the current layer. Every path-construction decision the tool makes is a decision about vector geometry, which is why it stays sharp at any zoom and survives scaling that would blur a painted line.',
    options: [
      {
        control: 'Mode',
        detail:
          'The three-button drawing-mode group at the left of the bar, and the control that decides what the rest of the bar shows. The current Pen settings page tabulates the values as Shape, Path and Pixels, and Adobe’s older drawing page names the same three buttons Shape Layers, Paths and Fill Pixels. Shape creates a shape layer with a vector mask; Path creates a work path that can be stroked or filled later; Pixels creates a rasterized shape directly on the current layer. The Fill, Stroke and Stroke width controls exist in Shape mode; the Operation, Path arrangement and Path alignment controls exist in Path mode. The app names this chip "Tool Mode".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Fill',
        detail:
          'Fill color: a swatch that sets the color, pattern or gradient used to fill the shape, and can be set to None. Shape mode only. Double-clicking the swatch opens the color menu.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Stroke',
        detail:
          'Stroke color: a swatch setting the color of the shape outline, with a width and a stroke type (solid, dashed or dotted, with Inside/Center/Outside alignment, Butt/Round/Square caps and a corner treatment). Shape mode only.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Operation',
        detail:
          'Path mode only. The path area option that decides how the component you are about to draw combines with the components already in the path: Add To Path Area, Subtract From Path Area, Intersect Path Areas, or Exclude Overlapping Path Areas. A shape tool may hold Shift to temporarily pick Add and Alt (Windows) or Option (macOS) to temporarily pick Subtract. The app labels this "Path Operations".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Path Operations',
        detail:
          'The Path Selection tool’s drop-down of the same four overlap modes, named Combine Shapes, Subtract From Shape Area, Intersect Shape Areas and Exclude Overlapping Shape Areas, plus Merge Shape Components, which fuses every overlapping component into one. It acts on an existing path component rather than on the one being drawn, so the Pen family shares the vocabulary without owning the control.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Path alignment',
        detail:
          'Align and distribute path components, the same way the alignment controls work for layers: align selected components, or distribute at least three. The app labels this "Alignment".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Path arrangement',
        detail:
          'The stacking order used when several paths are present, so that a later path draws over an earlier one.',
        status: 'missing',
      },
      {
        control: 'Path thickness (Weight)',
        detail:
          'Sets the width in pixels of the on-canvas line that represents the path. A display aid only: it has no effect on a stroke applied later, and on the pen family it lives in the Set additional pen and path options flyout, where newer releases label it Weight.',
        status: 'missing',
      },
      {
        control: 'Selection… / Mask / Shape',
        detail:
          'The group at the right end of the bar that converts the path you have already drawn: Selection… loads it as a selection through the Make Selection dialog (which is where feathering and anti-aliasing are set), Mask turns it into a vector mask, and Shape fills it into a new shape layer. These act on the current path, not on the next one you draw. The app names this chip "Make Selection".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Auto Add/Delete',
        detail:
          'A checkbox, on by default, that makes the Pen tool morph as you move over an existing path: over a segment it becomes the Add Anchor Point tool, over an anchor point it becomes the Delete Anchor Point tool. It also stops selecting an anchor point from changing the shape of the path. Deselect it to start a new path on top of an existing one.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Rubber Band',
        detail:
          'Live preview of the segment you are about to commit, drawn between the pointer and the pending anchor point as you move, so you can see the path before you click. Lives in the Set additional pen and path options flyout at the right of the bar.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action: 'Constrains the segment being placed to 45-degree angles.',
      },
      {
        keys: 'Alt',
        action:
          'Converts a smooth point to a corner point when you click it, and unhinges a direction handle from its opposite so you can set the two independently while dragging a curve.',
      },
    ],
    shortcuts: [
      { keys: 'P', action: 'Selects the Pen tool.' },
      { keys: 'Shift+P', action: 'Cycles through the tools nested in the Pen group.' },
      {
        keys: 'Ctrl+Enter',
        action:
          'Loads the current path as a selection, the same as the Load path as a selection button at the bottom of the Paths panel.',
      },
      {
        keys: 'Ctrl+Alt',
        action:
          'Activates the Convert Point tool temporarily while the Direct Selection tool is selected, when the pointer is over an anchor point.',
      },
    ],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:299',
      'src/tools/toolsMap.ts:127',
      'src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14',
      'src/tools/settings.ts:259',
      'src/contexts/tool-types.ts:57',
      'src/util/settings.ts:80',
      'src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:33',
      'src/tools/__tests__/tool-processors.test.ts:338',
    ],
    appNotes: `Not implemented. The processor exists but is the shared stub that returns a null bitmap, and its commit kind is unimplemented, so a drag over the canvas produces no layer, no history state and no durable operation. ${NO_APP_OPTIONS} The app does bind the letter P and Shift+P cycling for the Pen group, and it has a tool-preset entry for the tool, which is the whole of the Pen's Photoshop chrome here.`,
    sources: PEN_SOURCES,
  },

  'freeform-pen': {
    photoshopName: 'Freeform Pen Tool',
    summary:
      'Draws a path freehand, placing anchor points and fitting bezier handles to the stroke as you drag instead of clicking them one at a time.',
    purpose:
      'The Freeform Pen takes a single drag and turns it into a path, so it is the tool for tracing something by hand rather than plotting it. The raw trail is simplified on release into as few anchor points as fit it, mixing straight corner points with curved ones. Turn on Magnetic and the trail stops following your hand and starts following the image: the live segment snaps to the strongest edge within Width, and fastening points are dropped along the border to anchor what you have already traced. It is the one Pen-family tool you can pick up in a photograph and use immediately, and the one to reach for when the precision of the standard Pen is more than the job needs.',
    options: [
      {
        control: 'Mode',
        detail:
          'The same three-button drawing-mode group as the standard Pen — Shape, Path, Pixels — and the control that decides what the rest of the bar shows. The app names this chip "Tool Mode".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Fill',
        detail: 'Fill color for the shape. Shape mode only.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Stroke',
        detail: 'Stroke color, width and type for the shape outline. Shape mode only.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Curve Fit',
        detail:
          'A single numeric field, 0.5 to 10 pixels, that sets the tolerance the fitted path is simplified to: a low value follows your hand closely and yields a dense, spiky path with many anchor points, a high value yields a coarse one with few. It is one number, not a menu of fit styles. Enter it from the inverted-arrow flyout beside the shape buttons.',
        status: 'missing',
      },
      {
        control: 'Magnetic',
        detail:
          'The checkbox that turns edge snapping on. With it off the tool is a plain freehand pen; with it on, the last active segment snaps to the strongest edge in the image, using the same Width / Contrast / Frequency / Stylus Pressure controls the Magnetic Lasso documents. The cursor carries a magnet while it is active.',
        status: 'missing',
      },
      {
        control: 'Align Edges',
        detail:
          'The neighboring control in the same flyout, which straightens a traced segment against the edge it snapped to. It is unavailable while the Freeform Pen is the active tool.',
        status: 'missing',
      },
      {
        control: 'Selection… / Mask / Shape',
        detail:
          'The group at the right end of the bar that converts the path you have already drawn into a selection, a vector mask or a shape layer. The app names this chip "Make Selection".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Rubber Band',
        detail: 'Live preview of the pending path segment. Lives in the Set additional pen and path options flyout.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [
      { keys: 'P', action: 'Selects the Freeform Pen tool, or the last Pen-family tool that was active.' },
      { keys: 'Shift+P', action: 'Cycles through the tools nested in the Pen group.' },
    ],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:300',
      'src/tools/toolsMap.ts:128',
      'src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:15',
      'src/tools/settings.ts:260',
      'src/contexts/tool-types.ts:58',
      'src/util/settings.ts:82',
      'src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:150',
      'src/components/Common/AppKeyboardShortcuts.tsx:32',
    ],
    appNotes:
      "Not implemented, and the placeholder config is itself wrong for this tool in a way a test pins. The chip list the Freeform Pen actually renders is the standard Pen's — the config entry written for the Freeform Pen, with its Magnetic and Curve Fit chips, is dead configuration that no tool reaches, and a test asserts that it stays dead. So the two controls that are this tool's entire reason for existing are the two it does not even name in its bar. " +
      NO_APP_OPTIONS,
    sources: [
      'https://www.adobe.com/products/photoshop/pen-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html',
      'https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html',
      'https://helpx.adobe.com/photoshop/using/paths.html',
    ],
  },

  'curvature-pen': {
    photoshopName: 'Curvature Pen Tool',
    summary:
      'Draws smooth curved paths from plain clicks, computing the curve for you so there are no direction handles to manage at all.',
    purpose:
      'The Curvature Pen is Illustrator’s Curvature tool ported into Photoshop, and it exists to remove the part of the standard Pen people find hardest. You click to place points; Photoshop fits the curve through them and keeps fitting as you add more, so a path is a sequence of smooth points and you never see, drag or think about a bezier handle. You shape it by pushing and pulling whole segments, and you switch one point between straight and curved with a double-click. Because the fit is continuous it will not give you the deliberately angular corner the standard Pen can, nor the deliberately flat run of a long handle; it is for the organic outline, and the standard Pen for everything else. It arrived in Photoshop CC 2018 (19.0) and is the newest tool in this family.',
    options: [
      {
        control: 'Mode',
        detail:
          'The same three-button drawing-mode group as the standard Pen — Shape, Path, Pixels — and the control that decides what the rest of the bar shows. The app names this chip "Tool Mode".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Fill',
        detail:
          'Fill color for the shape, and it is set to None for the tracing workflow the tool is usually used in. Shape mode only.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Stroke',
        detail:
          'Stroke color, width and type for the shape outline, also set to None for pure path tracing. Shape mode only.',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Path thickness (Weight)',
        detail:
          'The gear icon in the options bar opens the Path Options flyout, where the width and color of the on-canvas line representing the path are set. A display aid only: it changes nothing about the path and has no effect on a stroke applied later.',
        status: 'missing',
      },
      {
        control: 'Align Edges',
        detail:
          'The neighboring control in that flyout, which straightens a segment against the edge it snapped to. It is reported as unavailable while the Curvature Pen is the active tool.',
        status: 'missing',
      },
      {
        control: 'Selection… / Mask / Shape',
        detail:
          'The group at the right end of the bar that converts the path you have already drawn into a selection, a vector mask or a shape layer. The app names this chip "Make Selection".',
        status: 'inert',
        appRef: PEN_PLACEHOLDER_CHIPS,
      },
      {
        control: 'Rubber Band',
        detail: 'Live preview of the pending path, so the curve Photoshop is about to fit is visible before you click.',
        status: 'missing',
      },
    ],
    modifiers: [],
    shortcuts: [
      {
        keys: 'P',
        action: 'Selects the Curvature Pen tool, or the last Pen-family tool that was active.',
      },
      { keys: 'Shift+P', action: 'Cycles through the tools nested in the Pen group.' },
      { keys: 'Esc', action: 'Stops drawing the current path.' },
    ],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:305',
      'src/tools/toolsMap.ts:133',
      'src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:16',
      'src/tools/settings.ts:261',
      'src/contexts/tool-types.ts:59',
      'src/util/settings.ts:83',
      'src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:150',
      'src/components/Common/AppKeyboardShortcuts.tsx:32',
    ],
    appNotes:
      "Not implemented, and the placeholder config is wrong for this tool the same way it is wrong for the Freeform Pen: the chip list this tool renders is the standard Pen's, and the config entry written for the Curvature Pen is dead configuration that no tool reaches. That entry also lists Magnetic and Curve Fit, which are the Freeform Pen's controls and not this tool's. " +
      NO_APP_OPTIONS,
    sources: CURVATURE_SOURCES,
  },

  'add-anchor-point': {
    photoshopName: 'Add Anchor Point Tool',
    summary: 'Inserts an anchor point into an existing path exactly where you click on a segment.',
    purpose:
      'The Add Anchor Point tool subdivides a path. It only means anything against a path that already exists and is selected in the Paths panel, which is why it is a Tools-panel entry rather than a mode of the Pen: the standard Pen reaches the same result on its own when Auto Add/Delete is on, and this tool is the explicit version for when you want to add a point without switching tools mid-drag. Clicking a segment inserts a point there; dragging while you click reshapes the path as you add, so you can bend the line and place the new point in one gesture. The point it adds is a smooth point with direction handles, which is why the segments either side of it can change shape rather than merely being cut in two.',
    options: [],
    modifiers: [],
    shortcuts: [],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:310',
      'src/tools/toolsMap.ts:138',
      'src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14',
      'src/tools/settings.ts:262',
      'src/contexts/tool-types.ts:60',
      'src/util/settings.ts:84',
      'src/components/SidebarLeft/toolIcons.tsx:77',
    ],
    appNotes:
      "Not implemented. Photoshop documents no options-bar control specific to this tool — selecting it shows the Pen group's bar, so every control on it belongs to the Pen and none is the Add Anchor Point tool's own — which is why its options table is empty. What the app does render is the standard Pen's chip list, on a panel with a TODO badge, over a tool that has no processor, no state beyond its own name, and no Paths panel to select a path in. The app's SidebarLeft gives this tool the same pen-nib icon as the Pen itself, so the three anchor-point tools are visually indistinguishable from it.",
    sources: ANCHOR_TOOL_SOURCES,
  },

  'delete-anchor-point': {
    photoshopName: 'Delete Anchor Point Tool',
    summary: 'Removes the anchor point you click from an existing path, and the two segments around it re-solve.',
    purpose:
      'The Delete Anchor Point tool takes a point out of a path that already exists and is selected in the Paths panel. The consequence is the interesting part: the two segments that met at the removed point do not simply join end to end, they are re-fitted across the new span, so deleting a point from a curve usually changes the curve and can smooth out the kink that point was holding. It is the counterpart to the Add Anchor Point tool and, like it, mostly exists so the Pen family is not a three-tool round trip for every edit; the standard Pen reaches it on its own when Auto Add/Delete is on. Note the trap Adobe calls out: the keyboard Delete key is not this tool. It removes the point and the segments joined to it, splitting the path in two.',
    options: [],
    modifiers: [],
    shortcuts: [],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:315',
      'src/tools/toolsMap.ts:143',
      'src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14',
      'src/tools/settings.ts:263',
      'src/contexts/tool-types.ts:61',
      'src/util/settings.ts:85',
      'src/components/SidebarLeft/toolIcons.tsx:78',
    ],
    appNotes:
      "Not implemented. Photoshop documents no options-bar control specific to this tool — selecting it shows the Pen group's bar, so every control on it belongs to the Pen and none is the Delete Anchor Point tool's own — which is why its options table is empty. What the app does render is the standard Pen's chip list, on a panel with a TODO badge, over a tool that has no processor, no state beyond its own name, and no Paths panel to select a path in. The app's SidebarLeft gives this tool the same pen-nib icon as the Pen itself.",
    sources: ANCHOR_TOOL_SOURCES,
  },

  'convert-point': {
    photoshopName: 'Convert Point Tool',
    summary: 'Converts an anchor point between corner and smooth, with or without independent direction lines.',
    purpose:
      'The Convert Point tool changes the type of a point on a path that already exists and is selected in the Paths panel, and a single drag does three different things depending on what you grabbed. Drag away from a corner point and direction lines appear, making it a smooth point whose handles you then shape. Click a smooth point and it becomes a corner point with no direction lines, so the segments either side leave it independently. Drag one of a smooth point’s direction points and the point stays smooth but the two handles are unhinged, so they can point in different directions — which is what produces an S-curve. The Pen reaches all three with Alt held, and with the Direct Selection tool selected, Ctrl+Alt (Windows) or Command+Option (macOS) over an anchor point reaches this tool without leaving that tool.',
    options: [],
    modifiers: [],
    shortcuts: [
      {
        keys: 'Ctrl+Alt',
        action:
          'Activates the Convert Point tool temporarily while the Direct Selection tool is selected and the pointer is over an anchor point.',
      },
    ],
    implementation: 'placeholder',
    implementationRefs: [
      'src/tools/toolProcessors.ts:320',
      'src/tools/toolsMap.ts:148',
      'src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8',
      'src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14',
      'src/tools/settings.ts:264',
      'src/contexts/tool-types.ts:62',
      'src/util/settings.ts:86',
      'src/components/SidebarLeft/toolIcons.tsx:79',
      'src/contexts/__tests__/history-adapter.tool-conversion.test.ts:242',
    ],
    appNotes:
      "Not implemented. Photoshop documents no options-bar control specific to this tool — selecting it shows the Pen group's bar, so every control on it belongs to the Pen and none is the Convert Point tool's own — which is why its options table is empty. What the app does render is the standard Pen's chip list, on a panel with a TODO badge, over a tool that has no processor and no state beyond its own name. This is also one of the tools the durable document refuses: converting a history item that names it is rejected as an unsupported feature rather than silently replayed.",
    sources: [...ANCHOR_TOOL_SOURCES, 'https://helpx.adobe.com/illustrator/using/tool-techniques/pen-tool.html'],
  },
};
