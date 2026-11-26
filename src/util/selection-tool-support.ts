import type { ToolName } from '../contexts/tool-types.ts';

/**
 * Tools that keep an active pixel selection available after they are chosen.
 *
 * Selection tools keep it for follow-on operations; selection-aware pixel tools read its mask or
 * use it as their target geometry. Patch currently uses the selection bounds as a rectangle rather
 * than clipping to non-rectangular contour coverage. View, sampling, text and vector tools do not
 * paint into the selected raster. Pixel tools that do not yet apply selection coverage are omitted:
 * switching to one clears the selection instead of showing a constraint it would ignore.
 */
export const SELECTION_PRESERVING_TOOL_NAMES: ReadonlySet<ToolName> = new Set([
  'polygonal-lasso',
  'freehand-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'quick-selection',
  'rectangular-selection',
  'elliptical-selection',
  'single-row-marquee',
  'single-column-marquee',
  'brush',
  'pencil',
  'paint-bucket',
  'magic-eraser',
  'eraser',
  'clone-stamp',
  'patch',
  'eyedropper',
  'color-sampler',
  'ruler',
  'hand',
  'zoom',
  'rotate-view',
  'text',
  'pen',
  'freeform-pen',
  'curvature-pen',
  'add-anchor-point',
  'delete-anchor-point',
  'convert-point',
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'line',
  'custom-shape',
]);

export function preservesSelectionOnToolSwitch(toolName: ToolName): boolean {
  return SELECTION_PRESERVING_TOOL_NAMES.has(toolName);
}
