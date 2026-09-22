import type { ToolArgs } from './tool-types.ts';
import type { LayerId, LayerSource, LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import type { ActionType } from '../util/constants.ts';

export type NewHistoryItem = {
  actionName: ActionType;

  layerId: LayerId;
  layerSource?: LayerSource;
  documentSource?: { layers: LayersRecord; size: Size };
  args?: ToolArgs | object;
};

export type HistoryItem = NewHistoryItem & {
  id: string; // uuid

  disabled?: boolean;
};
