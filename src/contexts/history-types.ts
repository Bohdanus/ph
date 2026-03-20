import type { ToolArgs, ToolName } from './tool-types.ts';
import type { LayerId, LayerSource } from './layer-types.ts';
import type { CustomTool } from '../util/constants.ts';

export type HistoryItem = {
  id: string;
  disabled?: boolean;
  layerId: LayerId;
  toolName: ToolName | CustomTool;
  args: ToolArgs | LayerSource | object;
  imagePromise: Promise<ImageBitmap | null>;
};
