import { describe, expect, it } from 'vitest';
import type { DocumentFrame } from '../document-frame.ts';
import type { ImageLayerSource, Layer, ToolLayerSource } from '../layer-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import type { CropToolArgs } from '../../tools/crop.ts';
import { textLayerEditTarget } from '../text-layer-edit.ts';

/**
 * The one conversion every re-entry route funnels through.
 *
 * All four callers — `TextToolArea`'s pointer-down, `MoveToolArea`'s double-click and
 * `LayersTab`'s select and its `T` control — hydrate through `textLayerEditTarget`, so the five
 * refusals and the one offset below are each worth exactly one test here: a component test can only
 * see the arm its own component reaches, and the panel routes disagree with each other about which
 * layers are re-enterable.
 *
 * `pos` is DOCUMENT space and the stored `args.rect` is LAYER-LOCAL, because both commit paths store
 * `reduceRect(sortRect(measuredRect), pos)` and the creator renders into a `pos`-sized canvas. The
 * inverse of that reduction is `+ pos` and nothing else.
 */

const textArgs = (overrides: Partial<TextToolArgs> = {}): TextToolArgs => ({
  toolName: 'text',
  text: 'hello',
  fontSize: 16,
  lineHeight: 1.2,
  rect: { x1: 0, y1: 0, x2: 100, y2: 60 },
  bold: false,
  italic: false,
  fontFamily: 'Arial',
  color: '#000000',
  align: 'left',
  ...overrides,
});

function textLayer(overrides: Partial<Layer> = {}, args: Partial<TextToolArgs> = {}): Layer {
  return {
    id: 'text-layer',
    name: 'Text layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 120, y: 80, width: 100, height: 60 },
    operations: [],
    source: { kind: 'tool', args: textArgs(args) } as ToolLayerSource,
    ...overrides,
  };
}

describe('textLayerEditTarget', () => {
  it('hydrates the stored rect by the layer position alone, so no document frame can shift it', () => {
    // The mutation this kills is the frame-subtraction one: plumbing a document frame into
    // `textLayerEditTarget` and offsetting by `documentToCanvasPos(layer.pos, frame)` instead of
    // `layer.pos`. The real signature takes no frame, so the call below goes through a permissive
    // one — the extra argument is ignored by the production function and consumed by the mutated
    // one, which is what lets one assertion be red under the mutation and green without it.
    //
    // The frame is deliberately NEGATIVE: on an uncropped document the two offsets agree, so only a
    // frame away from the origin separates them. What the mutation displaces is a pure translation,
    // so the extent is untouched and nothing downstream complains — the editor, the caret and the
    // `useRect` boundary all sit away from the type, and the commit derives a `pos` from the
    // displaced rect and records the layer MOVED as a `replace-layer-source` entry.
    const hydrate = textLayerEditTarget as (
      layer: Layer,
      frame?: DocumentFrame
    ) => ReturnType<typeof textLayerEditTarget>;
    const frame: DocumentFrame = { x: -100, y: -50, width: 800, height: 600 };

    const target = hydrate(textLayer(), frame);

    expect(target?.args.rect).toEqual({ x1: 120, y1: 80, x2: 220, y2: 140 });
    // The extent is the layer's own, so a wrong origin can only ever be observed as a displacement
    // of these four numbers — which is why the assertion is the whole rect rather than a width.
    expect(target?.args.rect && target.args.rect.x2 - target.args.rect.x1).toBe(100);
  });

  it('names the layer it hydrates and carries the rest of the source args through', () => {
    const layer = textLayer({}, { text: 'Re-entry', fontSize: 48 });

    const target = textLayerEditTarget(layer);

    // `editingLayerId` is what tells the commit this is an in-place edit of a NAMED layer, so its
    // absence is how a re-entry silently becomes a second layer stacked on the first.
    expect(target).toEqual({
      layerId: layer.id,
      args: {
        ...textArgs({ text: 'Re-entry', fontSize: 48 }),
        editingLayerId: layer.id,
        rect: { x1: 120, y1: 80, x2: 220, y2: 140 },
      },
    });
  });

  it('refuses to re-enter a hidden text layer', () => {
    // Mutation killed: deleting the `if (!layer.visible) return null;` guard. A hidden layer's text
    // is not on the canvas, so an editor over it shows content the user just hid and commits ink
    // straight back out of view. `getLayerIdByPoint` filters invisible layers for the pointer
    // route, so without this the two panel routes would disagree with it.
    expect(textLayerEditTarget(textLayer({ visible: false }))).toBeNull();
  });

  it('re-enters a text layer whose retained operations leave its own box where it is', () => {
    // Mutation killed: reinstating `layer.operations.length > 0`. The clause it replaced claimed
    // that committing "writes a source the operation's own entry no longer reproduces", and neither
    // replay authority does that — legacy `replayHistory` keeps `operations: [...layer.operations]`
    // across a `REPLACE_LAYER_SOURCE_ACTION`, and `replayDurableDocument` keeps the retained list
    // for the same reason (`durable-replay.source-edit.test.ts` — `retains the operations already
    // applied to the layer`). Both renderers re-apply it to the new source, so the pixels agree with
    // the record and a blur is exactly the layer Photoshop still lets you retype.
    //
    // A filter is the discriminating fixture because it is the operation that provably cannot move
    // anything: `ctx.filter` is assigned inside the same `drawImage`, so the composed extent is
    // `layer.pos` and the hydrated rect is the box the ink is in.
    const layer = textLayer({
      operations: [{ id: 'op-1', args: { toolName: 'blur', radius: 4 }, enabled: true }],
    });

    const target = textLayerEditTarget(layer);

    expect(target?.layerId).toBe(layer.id);
    expect(target?.args.rect).toEqual({ x1: 120, y1: 80, x2: 220, y2: 140 });
    // The re-entry marker is what makes the commit an in-place edit rather than a second layer
    // stacked over the first, so a target without it is a different bug than a missing target.
    expect(target?.args.editingLayerId).toBe(layer.id);
  });

  it.each([
    { label: 'a translation', transform: { a: 1, b: 0, c: 0, d: 1, e: 40, f: 25 } },
    { label: 'a scale', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } },
    { label: 'a rotation', transform: { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 } },
  ])('refuses to re-enter a text layer carrying $label that moves its drawn box', ({ transform }) => {
    // Mutation killed: dropping the `layerPresentationKeepsLayerBounds` clause, which is the whole
    // of what remains of the operations guard. A retained affine is a geometry fact rather than a
    // record-keeping one: the editor is a contenteditable `div` over the box `pos` names, and the
    // ink is drawn somewhere else. The extent is what discriminates — a translation keeps the
    // width, so an assertion on the size alone would pass under the mutation.
    const layer = textLayer({
      operations: [{ id: 'op-1', kind: 'affine-transform', transform, enabled: true }],
    });

    expect(textLayerEditTarget(layer)).toBeNull();
  });

  it('re-enters a text layer whose only retained transform leaves the box where it is', () => {
    // The control for the pair above, and the other half of "does the box move": a disabled
    // operation and an IDENTITY one both leave the composed extent equal to `layer.pos`, so neither
    // may be refused. `drawLayerSource` skips a disabled operation and `drawEvaluatedPresentation`
    // skips an identity matrix, so the drawn ink and the hydrated rect are the same box.
    const disabled = textLayer({
      operations: [
        { id: 'op-1', kind: 'affine-transform', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, enabled: false },
      ],
    });
    const identity = textLayer({
      operations: [
        { id: 'op-2', kind: 'affine-transform', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, enabled: true },
      ],
    });

    expect(textLayerEditTarget(disabled)?.args.rect).toEqual({ x1: 120, y1: 80, x2: 220, y2: 140 });
    expect(textLayerEditTarget(identity)?.args.rect).toEqual({ x1: 120, y1: 80, x2: 220, y2: 140 });
  });

  it('refuses a source that is not a tool source at all', () => {
    // Mutation killed: deleting the `source.kind !== 'tool'` clause, which then reads `args` off an
    // image source — or off nothing at all — instead of declining.
    const imageLayer = textLayer({
      source: {
        kind: 'image',
        bitmap: {} as ImageLayerSource['bitmap'],
        pos: { x: 120, y: 80, width: 100, height: 60 },
      },
    });
    const bareLayer = textLayer({ source: undefined });

    expect(textLayerEditTarget(imageLayer)).toBeNull();
    expect(textLayerEditTarget(bareLayer)).toBeNull();
  });

  it('refuses a tool source that is not the text tool, even when it carries a rect', () => {
    // Mutation killed: deleting the `source.args.toolName !== 'text'` clause. The crop source is
    // the discriminating fixture because it CARRIES a `rect` of its own, so the neighbouring
    // `!source.args.rect` clause cannot refuse it and the test measures this clause alone — a shape
    // source with no rect would stay green under the mutation, which is what the first attempt at
    // this fixture proved.
    const cropLayer = textLayer({
      source: {
        kind: 'tool',
        args: { toolName: 'crop', rect: { x1: 0, y1: 0, x2: 100, y2: 60 } } satisfies CropToolArgs,
        pos: { x: 120, y: 80, width: 100, height: 60 },
      } as ToolLayerSource,
    });

    expect(textLayerEditTarget(cropLayer)).toBeNull();
  });

  it('refuses a text source whose stored rect is missing', () => {
    // Mutation killed: deleting the `!source.args.rect` clause, which then reads `rect.x1` off
    // nothing. The stored rect is the only thing this function converts, so its absence is a
    // refusal and not a zero-rect to translate.
    const layer = textLayer({}, { rect: null });

    expect(textLayerEditTarget(layer)).toBeNull();
  });
});
