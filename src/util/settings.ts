import type { ToolArgs, ToolName } from '../contexts/ImageContext.tsx';
import { defaultSettings, type SavedSettings } from '../tools/settings.ts';
import type { TextToolArgs } from '../tools/text.ts';
import type { DrawToolArgs } from '../tools/draw.ts';
import type { ShapeToolArgs } from '../tools/shape.ts';
import type { CropToolArgs } from '../tools/crop.ts';

export function saveSettings(toolName: ToolName, args: ToolArgs | SavedSettings) {
  if (toolName === 'draw') {
    const { points, ...rest } = args as DrawToolArgs;
    defaultSettings.draw = rest;
  } else if (toolName === 'text') {
    const { text, rect, ...rest } = args as TextToolArgs;
    defaultSettings.text = rest;
  } else if (toolName === 'shape') {
    const { start, end, ...rest } = args as ShapeToolArgs;
    defaultSettings.shape = rest;
  } else if (toolName === 'crop') {
    const { rect, ...rest } = args as CropToolArgs;
    defaultSettings.crop = rest;
  } else {
    defaultSettings[toolName] = args;
  }
}
