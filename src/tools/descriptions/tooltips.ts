// GENERATED FILE - DO NOT EDIT. Source: src/tools/descriptions/*.ts
// Regenerate with `npm run docs:tools`; a test fails if this file is stale.

import type { ToolName } from '../../contexts/tool-types.ts';
import type { FigureType } from '../shape.ts';
import type { ToolImplementationStatus } from './types.ts';

/**
 * The two fields the toolbar tooltip reads, and the only part of the description record that
 * reaches the browser. Everything else — the purpose prose, the options tables, the
 * modifiers, the citations — exists for `docs/TOOLS.md` and for the tests, and importing it
 * here cost 215 kB raw / 58 kB gzipped for one line of text per tool.
 */
export type ToolTooltipProjection = {
  /** One sentence, what the tooltip shows under the tool's name. */
  summary: string;
  /** How much of the tool this editor implements. Drives the tooltip's status line. */
  implementation: ToolImplementationStatus;
};

export const toolTooltips: Record<ToolName, ToolTooltipProjection> = {
  'rectangular-selection': {
    summary: 'Drag a rectangular selection; Shift makes it a square, Alt grows it outward from the press point.',
    implementation: 'partial',
  },
  'elliptical-selection': {
    summary:
      'Drag an elliptical selection; Shift makes a circle, Alt draws from the center, Style locks ratio or size.',
    implementation: 'implemented',
  },
  'single-row-marquee': {
    summary: 'Click or drag to select one document row, one pixel tall and as wide as the image.',
    implementation: 'implemented',
  },
  'single-column-marquee': {
    summary: 'Click or drag to select one document column, one pixel wide and as tall as the image.',
    implementation: 'implemented',
  },
  'freehand-lasso': {
    summary: 'Drag a freehand selection border that goes exactly where the cursor goes and closes itself on release.',
    implementation: 'partial',
  },
  'polygonal-lasso': {
    summary:
      'Click to lay straight-edged anchors around a shape, then click the first anchor, double-click, or press Enter to close.',
    implementation: 'partial',
  },
  'feather-magnetic-lasso': {
    summary:
      'Click a starting point and the border snaps to the strongest image edge within Width as you move the pointer.',
    implementation: 'partial',
  },
  'magic-wand': {
    summary:
      'Click a color to select every pixel within Tolerance of it — only the adjacent ones, or the whole image if Contiguous is off.',
    implementation: 'partial',
  },
  'quick-selection': {
    summary: 'Brush over an object and the selection grows along the image edges you cross; brush again to add.',
    implementation: 'partial',
  },
  brush: {
    summary:
      'Paints the foreground color onto the layer in strokes: Opacity caps a single stroke, Flow builds it up, and the tip is stamped at Spacing intervals.',
    implementation: 'partial',
  },
  pencil: {
    summary:
      'Paints hard-edged, non-antialiased foreground lines, with an Auto Erase option that paints background over foreground at the stroke’s start.',
    implementation: 'partial',
  },
  'color-replacement': {
    summary:
      'Recolors the pixels it paints over with the foreground color while keeping their luminosity and texture, rather than covering them.',
    implementation: 'partial',
  },
  eraser: {
    summary:
      'Removes pixels to transparency along a stroke, in Brush, Pencil or Block mode, with per-stroke Opacity, per-dab Flow and Erase to History.',
    implementation: 'partial',
  },
  'magic-eraser': {
    summary:
      'Erases every pixel similar to the one you click, to transparency, in a single click, bounded by Tolerance, Anti-alias and Contiguous.',
    implementation: 'partial',
  },
  'paint-bucket': {
    summary:
      'Fills the contiguous area of similar color you click with the foreground color or a pattern, in one click, at a chosen Mode and Opacity.',
    implementation: 'partial',
  },
  'clone-stamp': {
    summary:
      'Copies pixels from an Alt-clicked source point and paints them under the cursor, in Aligned or Independent mode, with a soft or hard tip.',
    implementation: 'partial',
  },
  blur: {
    summary:
      'Paints blur under the brush, softening hard edges and reducing detail wherever you drag; the effect builds up pass by pass.',
    implementation: 'partial',
  },
  sharpen: {
    summary:
      'Paints extra edge contrast where you drag, so a soft area reads sharper without sharpening the rest of the image at all.',
    implementation: 'partial',
  },
  smudge: {
    summary:
      'Drags the pixels under the brush along the stroke, picking up colour where the stroke begins and pushing it where you pull.',
    implementation: 'partial',
  },
  dodge: {
    summary:
      'Lightens the tonal range you choose as you paint, the way holding back paper under a finger brightens a print.',
    implementation: 'partial',
  },
  burn: {
    summary:
      'Darkens the tonal range you choose as you paint, the way letting more light onto a print deepens its shadows.',
    implementation: 'partial',
  },
  sponge: {
    summary:
      'Raises or lowers the colour saturation under the brush, so a flat area gains colour or a loud one loses it, and the lightness underneath is untouched.',
    implementation: 'partial',
  },
  gradient: {
    summary:
      'Fills a selection or layer with a gradient you define by dragging: the click sets the first colour stop, the release the second.',
    implementation: 'partial',
  },
  shape: {
    summary: 'Draws a vector shape, a path, or a filled pixel region, and stamps it onto its own shape layer.',
    implementation: 'partial',
  },
  rectangle: {
    summary:
      'Drag-defined rectangle or square with an optional corner radius, drawn as a shape layer, path, or filled pixels.',
    implementation: 'partial',
  },
  ellipse: {
    summary: 'Drag-defined ellipse or circle drawn as a shape layer, a work path, or a filled pixel region.',
    implementation: 'partial',
  },
  line: {
    summary: 'Drag-defined straight line or arrow, drawn as a shape layer, a work path, or a filled pixel region.',
    implementation: 'partial',
  },
  triangle: {
    summary:
      'Drag-defined triangle with its apex at the top-centre of the drag box; hold Shift while dragging to constrain it to an equilateral triangle.',
    implementation: 'partial',
  },
  polygon: {
    summary:
      'Drag-defined polygon of any number of sides, with the side count set before the draw; the star of a given point count is a separate tool.',
    implementation: 'partial',
  },
  'custom-shape': {
    summary: "Draws a preset vector graphic from Photoshop's shape library, or one you define from a path.",
    implementation: 'placeholder',
  },
  pen: {
    summary:
      'Draws precise vector paths from click-placed anchor points, with draggable direction handles for the curves between them.',
    implementation: 'placeholder',
  },
  'freeform-pen': {
    summary:
      'Draws a path freehand, placing anchor points and fitting bezier handles to the stroke as you drag instead of clicking them one at a time.',
    implementation: 'placeholder',
  },
  'curvature-pen': {
    summary:
      'Draws smooth curved paths from plain clicks, computing the curve for you so there are no direction handles to manage at all.',
    implementation: 'placeholder',
  },
  'add-anchor-point': {
    summary: 'Inserts an anchor point into an existing path exactly where you click on a segment.',
    implementation: 'placeholder',
  },
  'delete-anchor-point': {
    summary: 'Removes the anchor point you click from an existing path, and the two segments around it re-solve.',
    implementation: 'placeholder',
  },
  'convert-point': {
    summary: 'Converts an anchor point between corner and smooth, with or without independent direction lines.',
    implementation: 'placeholder',
  },
  text: {
    summary:
      'Sets a typed string into the document as a raster text layer, with font, size, leading, tracking and caps controls.',
    implementation: 'partial',
  },
  crop: {
    summary:
      'Frames a new boundary for the photo; nothing is committed until you confirm, and Esc restores the old framing.',
    implementation: 'partial',
  },
  reposition: {
    summary:
      "Photoshop's Move tool (V) drags layers, selections and artboards around the document, and hosts the transform box Free Transform hangs off.",
    implementation: 'partial',
  },
  transform: {
    summary:
      "Photoshop's Free Transform (Cmd+T) scales, rotates, skews, distorts, adds perspective or warps a layer in one continuous operation.",
    implementation: 'partial',
  },
  levels: {
    summary:
      "Photoshop's Levels remaps an image's tonal range through a histogram, a gamma pivot and per-channel black, white and output points.",
    implementation: 'partial',
  },
  color: {
    summary:
      "Photoshop's Black & White converts a color image to monochrome with six hue-sextant sliders, optionally tinted with a tone color.",
    implementation: 'partial',
  },
  eyedropper: {
    summary:
      'Samples a color from anywhere in the image and makes it the foreground color, previewing as you drag and confirming on release.',
    implementation: 'partial',
  },
  'color-sampler': {
    summary:
      'Drops numbered markers on the image and reports each one’s color, up to four at a time. Sample Size sets the footprint each marker reads.',
    implementation: 'partial',
  },
  draw: {
    summary:
      'This app’s own freehand stroke tool, not a Photoshop tool: a drag becomes a new layer of ink, drawn with a pen, a dashed pen or a spray.',
    implementation: 'implemented',
  },
  ruler: {
    summary:
      'Measures a distance on the canvas: drag a nonprinting line and the options bar reports X, Y, W, H, the angle and the length, with Shift snapping to 45 degrees.',
    implementation: 'partial',
  },
};

/**
 * The five shape figures, each of which is a `ToolName` in its own right.
 *
 * `satisfies` is load-bearing in the other direction from the merge in `index.ts`.
 * `toolbarMap` registers all five figures under the single name `shape` and carries the figure
 * separately, so a figure added there with no entry here resolves to `undefined` at runtime
 * and renders a tooltip with no description; this turns that into a compile error instead.
 */
const FIGURE_TOOL_NAMES = {
  rectangle: 'rectangle',
  oval: 'ellipse',
  line: 'line',
  triangle: 'triangle',
  polygon: 'polygon',
} satisfies Record<FigureType, ToolName>;

/**
 * Which description a toolbar entry shows.
 *
 * `ToolbarTool.name` is `'shape'` for all five shape tiles, so the name alone would put the
 * generic Shape Tool's summary under the Rectangle Tool. The `figure` is what distinguishes
 * them, and the app's own naming disagrees with Photoshop's in exactly one place —
 * `FigureType` calls it `oval` and `ToolName` calls it `ellipse` — which is what this
 * indirection exists to absorb, so the caller never spells a figure-specific name out.
 */
export const descriptionKeyFor = (name: ToolName, figure?: FigureType): ToolName =>
  figure === undefined ? name : FIGURE_TOOL_NAMES[figure];
