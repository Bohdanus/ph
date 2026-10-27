import type { ToolArgs } from './tool-types.ts';
import type { LayerId, LayerSource, LayersRecord } from './layer-types.ts';
import type { Size } from './general-types.ts';
import type { ActionType } from '../util/constants.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { AffineTransform } from './affine-transform.ts';

export type DocumentFrameHistoryArgs = {
  previousFrame?: DocumentFrame;
  nextFrame: DocumentFrame;
  transform?: AffineTransform;
};

export type NewHistoryItem = {
  actionName: ActionType;

  layerId: LayerId;
  layerSource?: LayerSource;
  documentSource?: { layers: LayersRecord; size: Size; frame?: DocumentFrame };
  args?: ToolArgs | object;
};

export type HistoryItem = NewHistoryItem & {
  id: string; // uuid

  disabled?: boolean;
};
