import { cloneDeep, omit } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';

import type { TextToolArgs } from '../tools/text.ts';
import { normalizeFigure, type ShapeToolArgs } from '../tools/shape.ts';
import type { CropToolArgs } from '../tools/crop.ts';

/**
 * Tool args may arrive from an older build that still had dedicated Circle and
 * Square tools. Map those figures onto their Photoshop base tool so a saved
 * shape style is never dropped on the floor.
 */
const withNormalizedFigure = <T extends ShapeToolArgs>(args: ShapeToolArgs): T =>
  ({ ...args, figure: normalizeFigure(args.figure) }) as T;

export function saveLastSettings(args: ToolArgs) {
  const { toolName } = args;
  if (!toolName) {
    throw new Error('Tool name required');
  }

  if (toolName === 'draw') {
    lastSavedSettings.draw = cloneDeep({ ...args, points: [] });
  } else if (toolName === 'text') {
    lastSavedSettings.text = cloneDeep(omit(args as TextToolArgs, 'text', 'rect'));
  } else if (toolName === 'shape') {
    lastSavedSettings.shape = cloneDeep(withNormalizedFigure(omit(args as ShapeToolArgs, 'start', 'end')));
  } else if (toolName === 'crop') {
    lastSavedSettings.crop = cloneDeep(omit(args as CropToolArgs, 'rect'));
    // deliberately not storing for those three because they have a different philosophy, unfortunately
  } else if (toolName === 'transform') {
    lastSavedSettings.transform = cloneDeep(args);
  } else if (toolName === 'reposition') {
    lastSavedSettings.reposition = cloneDeep(args);
  } else if (toolName === 'polygonal-lasso') {
    lastSavedSettings['polygonal-lasso'] = cloneDeep(args);
  } else if (toolName === 'freehand-lasso') {
    lastSavedSettings['freehand-lasso'] = cloneDeep(args);
  } else if (toolName === 'feather-magnetic-lasso') {
    lastSavedSettings['feather-magnetic-lasso'] = cloneDeep({ ...args, points: [] });
  } else if (toolName === 'magic-wand') {
    lastSavedSettings['magic-wand'] = cloneDeep(args);
  } else if (toolName === 'rectangular-selection') {
    lastSavedSettings['rectangular-selection'] = cloneDeep({ toolName: 'rectangular-selection' });
  } else if (toolName === 'triangle' || toolName === 'polygon') {
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(
      withNormalizedFigure(omit(args as unknown as ShapeToolArgs, 'start', 'end'))
    ) as ToolArgs;
  } else if (
    toolName === 'brush' ||
    toolName === 'pencil' ||
    toolName === 'color-replacement' ||
    toolName === 'pen' ||
    toolName === 'freeform-pen' ||
    toolName === 'curvature-pen' ||
    toolName === 'add-anchor-point' ||
    toolName === 'delete-anchor-point' ||
    toolName === 'convert-point' ||
    toolName === 'custom-shape'
  ) {
    (lastSavedSettings as Record<string, { toolName: string }>)[toolName] = cloneDeep({ toolName });
  } else if (toolName === 'rectangle' || toolName === 'ellipse' || toolName === 'line') {
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep({
      ...(lastSavedSettings[toolName] ?? {}),
      ...(args as ToolArgs),
    });
  }
}
