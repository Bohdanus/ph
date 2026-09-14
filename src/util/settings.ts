import { cloneDeep } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';

import type { TextToolArgs } from '../tools/text.ts';
import type { ShapeToolArgs } from '../tools/shape.ts';
import type { CropToolArgs } from '../tools/crop.ts';

export function saveLastSettings(args: ToolArgs) {
  const { toolName } = args;
  if (!toolName) {
    throw new Error('Tool name required');
  }

  if (toolName === 'draw') {
    lastSavedSettings.draw = cloneDeep({ ...args, points: [] });
  } else if (toolName === 'text') {
    const { text, rect, ...rest } = args as TextToolArgs;
    lastSavedSettings.text = cloneDeep(rest);
  } else if (toolName === 'shape') {
    const { start, end, ...rest } = args as ShapeToolArgs;
    lastSavedSettings.shape = cloneDeep(rest);
  } else if (toolName === 'crop') {
    const { rect, ...rest } = args as CropToolArgs;
    lastSavedSettings.crop = cloneDeep(rest);
    // deliberately not storing for those three because they have a different philosophy, unfortunately
  } else if (toolName === 'transform') {
    lastSavedSettings.transform = cloneDeep(args);
  } else if (toolName === 'reposition') {
    lastSavedSettings.reposition = cloneDeep(args);
  } else if (toolName === 'polygonal-lasso') {
    lastSavedSettings['polygonal-lasso'] = cloneDeep(args);
  } else if (toolName === 'freehand-lasso') {
    lastSavedSettings['freehand-lasso'] = cloneDeep(args);
  } else if (toolName === 'rectangular-selection') {
    lastSavedSettings['rectangular-selection'] = cloneDeep(args);
  }
}
