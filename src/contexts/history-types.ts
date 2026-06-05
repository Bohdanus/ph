import type { ToolArgs } from './tool-types.ts';
import type { LayerId, LayerSource } from './layer-types.ts';
import type { ActionType } from '../util/constants.ts';

export type NewHistoryItem = {
  actionName: ActionType;

  layerId: LayerId;
  layerSource?: LayerSource;
  args?: ToolArgs | object;
};

export type HistoryItem = NewHistoryItem & {
  id: string; // uuid

  disabled?: boolean;
  imagePromise: Promise<ImageBitmap | null>;
};
