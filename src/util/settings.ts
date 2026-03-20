import { lastSavedSettings, type SavedSettings } from '../tools/settings.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import type { ShapeToolArgs } from '../tools/shape.ts';
import type { CropToolArgs } from '../tools/crop.ts';
import type { ToolArgs, ToolName } from '../contexts/tool-types.ts';

export function saveSettings(toolName: ToolName, args: ToolArgs | SavedSettings) {
  if (toolName === 'draw') {
    const { points, ...rest } = args as DrawToolArgs;
    lastSavedSettings.draw = rest;
  } else if (toolName === 'text') {
    const { text, rect, ...rest } = args as TextToolArgs;
    lastSavedSettings.text = rest;
  } else if (toolName === 'shape') {
    const { start, end, ...rest } = args as ShapeToolArgs;
    lastSavedSettings.shape = rest;
  } else if (toolName === 'crop') {
    const { rect, ...rest } = args as CropToolArgs;
    lastSavedSettings.crop = rest;
    // deliberately not storing for those three, because they have a different philosophy, unfortunately
  } else if (toolName !== 'blur' && toolName !== 'levels' && toolName !== 'color') {
    lastSavedSettings[toolName] = args;
  }
}
