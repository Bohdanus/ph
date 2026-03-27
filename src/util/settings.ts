import { cloneDeep } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import type { ToolArgs, ToolName } from '../contexts/tool-types.ts';

export type Colors = {
  color: string;
  backgroundColor: string;
};

export function saveSettings(toolName: ToolName, args: ToolArgs) {
  if (toolName === 'draw') {
    lastSavedSettings.draw = cloneDeep({ ...args, points: [] });
    // deliberately not storing for those three because they have a different philosophy, unfortunately
  } else if (toolName !== 'blur' && toolName !== 'levels' && toolName !== 'color') {
    lastSavedSettings[toolName] = cloneDeep(args);
  }
}
