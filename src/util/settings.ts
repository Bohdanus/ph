import { cloneDeep } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import type { ToolArgs, ToolName } from '../contexts/tool-types.ts';

import type { TextToolArgs } from '../tools/text.ts';
import type { ShapeToolArgs } from '../tools/shape.ts';
import type { CropToolArgs } from '../tools/crop.ts';

export function saveSettings(toolName: ToolName, args: ToolArgs) {
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
  } else if (toolName !== 'blur' && toolName !== 'levels' && toolName !== 'color') {
    lastSavedSettings[toolName] = cloneDeep(args);
  }
}
