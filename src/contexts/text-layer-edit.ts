import type { Layer, LayerId, ToolLayerSource } from './layer-types.ts';
import type { TextToolArgs } from '../tools/text.ts';
import { layerPresentationKeepsLayerBounds } from './layer-renderer.ts';

export type TextLayerEditTarget = {
  layerId: LayerId;
  args: TextToolArgs;
};

/**
 * Hydrate the layer-local source rect into the canvas space the live editor measures in.
 *
 * **The offset is `layer.pos`, not the layer's canvas position.** Both commit paths store
 * `args.rect` REDUCED — `reduceRect(sortRect(measuredRect), pos)` — which subtracts `pos.x`, because
 * the creator renders into a `pos`-sized canvas and draws the type at the rect's own coordinates. The
 * inverse of that reduction adds `pos` back, and `pos` is DOCUMENT space. Adding
 * `documentToCanvasPos(pos, frame)` instead subtracts the document frame a second time: MEASURED with a
 * frame at x −100, a layer whose canvas rect was (40, 70, 340, 160) re-entered with
 * (140, 120, 440, 210). The extent is untouched, so nothing downstream notices a pure translation —
 * the editor, the caret and the `useRect` boundary all sit away from the type, and committing derives a
 * `pos` from the displaced rect and records the layer MOVED as a `replace-layer-source` entry. It is
 * invisible on an uncropped document, where `frame` is zero and both offsets agree.
 *
 * All four entry routes funnel through here — `TextToolArea`'s pointer-down, `MoveToolArea`'s
 * double-click, `LayersTab`'s select and its `T` control — so this is the one place the conversion has
 * to be right. It takes no document frame, and that is the point rather than an omission: the frame is
 * already accounted for, because the caller will convert the canvas rect back with
 * `canvasToDocumentPos` before it compares positions.
 *
 * ## Why a retained operation is not by itself a refusal
 *
 * This used to carry `layer.operations.length > 0`, on the reasoning that committing "writes a source
 * the operation's own entry no longer reproduces". Neither replay authority does that: legacy
 * `replayHistory` installs the replacement and keeps `operations: [...layer.operations]`, and
 * `replayDurableDocument` keeps the layer's retained list for the same reason — a source edit is an
 * edit of the layer's ARGUMENTS, not of the edits already applied to it, and Photoshop keeps a live
 * filter on a type layer whose text is retyped. Both renderers then re-apply the list to the new
 * source (`drawLayerSource` at draw time, `materializeLayer`'s retained segment), so the pixels agree
 * with the record, and the clause refused a re-entry that was already correct.
 *
 * ## What the remaining refusal actually is
 *
 * A retained AFFINE is a different matter, and the refusal is about geometry rather than about
 * operations. The editor is a contenteditable `div` laid over the type box in CANVAS space, and the
 * box this function hydrates is the layer's own `pos`; a retained transform routes the draw through
 * `ctx.transform`, so the ink is placed by that matrix rather than blitted into `pos`, and an overlay
 * laid over the box would sit away from the type. So the one question asked is
 * `layerPresentationKeepsLayerBounds` — the renderer's own composed matrix, tested for the identity
 * that is exactly `drawEvaluatedPresentation`'s plain-blit branch. A filter keeps the box and edits,
 * a translation or a scale does not and is refused until the edit geometry can be carried
 * (`TEXT_TOOL_REQUIREMENTS.md` §3.1).
 */
export function textLayerEditTarget(layer: Layer): TextLayerEditTarget | null {
  const source = layer.source;
  if (!source || source.kind !== 'tool' || source.args.toolName !== 'text' || !source.args.rect) {
    return null;
  }
  // A hidden layer's text is not on the canvas, so an editor over it would show content the user just
  // hid and let them edit ink that commits straight back out of view. `getLayerIdByPoint` filters
  // invisible layers for the pointer route; this makes the panel routes agree with it.
  if (!layer.visible) return null;
  if (!layerPresentationKeepsLayerBounds(layer)) return null;

  const rect = source.args.rect;
  return {
    layerId: layer.id,
    args: {
      ...source.args,
      editingLayerId: layer.id,
      rect: {
        x1: rect.x1 + layer.pos.x,
        y1: rect.y1 + layer.pos.y,
        x2: rect.x2 + layer.pos.x,
        y2: rect.y2 + layer.pos.y,
      },
    },
  };
}

export function isTextLayerSource(source: Layer['source']): source is ToolLayerSource & { args: TextToolArgs } {
  return Boolean(source && source.kind === 'tool' && source.args.toolName === 'text');
}
