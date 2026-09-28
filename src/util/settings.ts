import { cloneDeep, omit } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';

import type { TextToolArgs } from '../tools/text.ts';
import { normalizeFigure, type ShapeToolArgs } from '../tools/shape.ts';
import type { CropToolArgs } from '../tools/crop.ts';
import type { BlurToolArgs } from '../tools/blur.ts';
import type { ColorsToolArgs } from '../tools/colors.ts';
import type { LevelsToolArgs } from '../tools/levels.ts';

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
  } else if (toolName === 'blur') {
    lastSavedSettings.blur = cloneDeep(args as BlurToolArgs);
  } else if (toolName === 'color') {
    lastSavedSettings.color = cloneDeep(args as ColorsToolArgs);
  } else if (toolName === 'levels') {
    lastSavedSettings.levels = cloneDeep(args as LevelsToolArgs);
  } else {
    // Every `ToolName` is persisted above by design. Without this trap a tool added to
    // `ToolArgsByName` falls off the end of the chain, its settings are dropped, and its sliders
    // silently reset on the next switch. Adding a tool without adding an arm here is a typecheck error.
    const _exhaustive: never = toolName;
    void _exhaustive;
  }
}
