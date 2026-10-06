import { documentToCanvasPos, type DocumentFrame } from './document-frame.ts';
import type { Layer, LayerId, ToolLayerSource } from './layer-types.ts';
import type { Pos } from './general-types.ts';
import type { TextToolArgs } from '../tools/text.ts';

export type TextLayerEditTarget = {
  layerId: LayerId;
  args: TextToolArgs;
  pos: Pos;
};

/** Hydrate the layer-local source rect into the canvas space used by the live editor. */
export function textLayerEditTarget(layer: Layer, frame: DocumentFrame): TextLayerEditTarget | null {
  const source = layer.source;
  if (
    !source ||
    source.kind !== 'tool' ||
    source.args.toolName !== 'text' ||
    !source.args.rect ||
    layer.operations.length > 0
  ) {
    return null;
  }

  const rect = source.args.rect;
  const canvasPos = documentToCanvasPos(layer.pos, frame);
  return {
    layerId: layer.id,
    pos: layer.pos,
    args: {
      ...source.args,
      editingLayerId: layer.id,
      rect: {
        x1: rect.x1 + canvasPos.x,
        y1: rect.y1 + canvasPos.y,
        x2: rect.x2 + canvasPos.x,
        y2: rect.y2 + canvasPos.y,
      },
    },
  };
}

export function isTextLayerSource(source: Layer['source']): source is ToolLayerSource & { args: TextToolArgs } {
  return Boolean(source && source.kind === 'tool' && source.args.toolName === 'text');
}
