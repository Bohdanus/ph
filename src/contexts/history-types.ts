import type { ToolArgs } from './tool-types.ts';
import type { LayerId, LayerSource } from './layer-types.ts';
import type { ActionType } from '../util/constants.ts';

export type HistoryItem = {
  id: string;
  actionName: ActionType;

  layerId: LayerId;
  args: ToolArgs | LayerSource | object;

  disabled?: boolean;
  imagePromise: Promise<ImageBitmap | null>;
};
