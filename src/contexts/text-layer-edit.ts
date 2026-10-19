import { documentToCanvasPos, type DocumentFrame } from './document-frame.ts';
import { getLayerAffineTransform, type AffineTransform } from './affine-transform.ts';
import type { Layer, LayerId, LayerOperation, ToolLayerSource } from './layer-types.ts';
import type { Pos } from './general-types.ts';
import type { TextToolArgs } from '../tools/text.ts';

export type TextLayerEditTarget = {
  layerId: LayerId;
  args: TextToolArgs;
  pos: Pos;
  /**
   * The layer's composed affine transform, for the DOM overlay to mirror at draw time.
   * Identity when the layer has no affine operations. Never includes filter operations
   * (those are refused by the gate above).
   */
  affine: AffineTransform;
};

/**
 * Whether a layer's operations include a filter (non-affine) operation.
 *
 * Only pure affine transforms (scale/rotate/skew/mirror) are allowed — they are
 * composable matrices applied at draw time, never baked. Any filter operation
 * makes the draft uneditable in-place, because those alter geometry or pixels
 * in ways that cannot be round-tripped through the DOM overlay.
 */
function hasFilterOperation(operations: readonly LayerOperation[]): boolean {
  return operations.some((op) => op.kind !== 'affine-transform');
}

/**
 * Hydrate the layer-local source rect into the canvas space used by the live editor.
 *
 * The returned `args.rect` stays in the layer's ORIGINAL local coordinate frame
 * (offset by the canvas position), so `calculateNewRect` measures text against the
 * un-transformed box. The `affine` field carries the layer's composed transform so
 * `TextEditOverlay` can apply a matching CSS matrix on top.
 */
export function textLayerEditTarget(layer: Layer, frame: DocumentFrame): TextLayerEditTarget | null {
  if (layer.locked) return null;

  const source = layer.source;
  if (!source || source.kind !== 'tool' || source.args.toolName !== 'text' || !source.args.rect) {
    return null;
  }

  const operations = layer.operations ?? [];
  if (hasFilterOperation(operations)) return null;

  const rect = source.args.rect;
  const affine = getLayerAffineTransform(layer);
  const canvasPos = documentToCanvasPos(layer.pos, frame);

  return {
    layerId: layer.id,
    pos: layer.pos,
    affine,
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
