import { describe, expect, it } from 'vitest';

import type { DocumentFrame } from '../document-frame.ts';
import { IDENTITY_AFFINE_TRANSFORM, type AffineTransform } from '../affine-transform.ts';
import type { Layer } from '../layer-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import type { RectXY } from '../general-types.ts';
import { textLayerEditTarget } from '../text-layer-edit.ts';

const frame: DocumentFrame = { x: 0, y: 0, width: 800, height: 600 };

function makeTextLayer(id: string, overrides: Partial<Layer> = {}): Layer {
  const textArgs: TextToolArgs = {
    toolName: 'text',
    align: 'left',
    bold: false,
    color: '#000000',
    fontFamily: 'Arial',
    fontSize: 64,
    italic: false,
    lineHeight: 1.2,
    text: 'Hello',
    rect: { x1: 0, y1: 0, x2: 100, y2: 50 },
  };
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: 100, height: 50 } as ImageBitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 1,
    pos: { x: 100, y: 100, width: 100, height: 50 },
    presentationBounds: null,
    operations: [],
    source: { kind: 'tool', args: textArgs, pos: { x: 100, y: 100, width: 100, height: 50 } },
    ...overrides,
  };
}

function makeAffineLayer(
  id: string,
  affine: AffineTransform,
  rect: RectXY = { x1: 0, y1: 0, x2: 100, y2: 50 },
  layerPos = { x: 100, y: 100 },
  disabled = false
): Layer {
  const textArgs: TextToolArgs = {
    toolName: 'text',
    align: 'left',
    bold: false,
    color: '#000000',
    fontFamily: 'Arial',
    fontSize: 64,
    italic: false,
    lineHeight: 1.2,
    text: 'Hello',
    rect,
  };
  return makeTextLayer(id, {
    pos: { ...layerPos, width: 100, height: 50 },
    source: { kind: 'tool', args: textArgs, pos: { ...layerPos, width: 100, height: 50 } },
    operations: [
      {
        id: 'affine-1',
        kind: 'affine-transform',
        transform: affine,
        enabled: !disabled,
      },
    ],
  });
}

function makeFilterLayer(id: string, enabled = true): Layer {
  const textArgs: TextToolArgs = {
    toolName: 'text',
    align: 'left',
    bold: false,
    color: '#000000',
    fontFamily: 'Arial',
    fontSize: 64,
    italic: false,
    lineHeight: 1.2,
    text: 'Hello',
    rect: { x1: 0, y1: 0, x2: 100, y2: 50 },
  };
  return makeTextLayer(id, {
    operations: [{ id: 'blur-1', kind: 'filter', args: { toolName: 'blur', radius: 4 }, enabled }],
    source: { kind: 'tool', args: textArgs, pos: { x: 100, y: 100, width: 100, height: 50 } },
  });
}

describe('textLayerEditTarget gate', () => {
  it('returns non-null for a text layer with no operations', () => {
    const layer = makeTextLayer('layer-1');
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    expect(target!.layerId).toBe('layer-1');
    expect(target!.affine).toBe(IDENTITY_AFFINE_TRANSFORM);
  });

  it('returns null for a non-text layer source', () => {
    const layer = makeTextLayer('layer-1', {
      source: { kind: 'blank', color: '#fff', opacity: 1, pos: { x: 0, y: 0, width: 10, height: 10 } },
    });
    expect(textLayerEditTarget(layer, frame)).toBeNull();
  });

  it('returns null for a locked text layer', () => {
    expect(textLayerEditTarget(makeTextLayer('locked-text', { locked: true }), frame)).toBeNull();
  });

  it('returns null for a text layer with a filter operation', () => {
    const layer = makeFilterLayer('layer-1');
    expect(textLayerEditTarget(layer, frame)).toBeNull();
  });

  it('returns non-null for a text layer with a disabled filter operation', () => {
    const layer = makeFilterLayer('layer-1', false);
    expect(textLayerEditTarget(layer, frame)).not.toBeNull();
  });

  it('returns null for a degenerate source rect or invalid layer position', () => {
    const layer = makeTextLayer('layer-1');
    if (layer.source?.kind !== 'tool' || layer.source.args.toolName !== 'text') {
      throw new Error('created source was not a text layer');
    }
    const degenerateRect = {
      ...layer,
      source: { ...layer.source, args: { ...layer.source.args, rect: { x1: 0, y1: 0, x2: 0, y2: 50 } } },
    };
    const invalidPosition = makeTextLayer('layer-2', { pos: { x: 100, y: 100, width: 0, height: 50 } });

    expect(textLayerEditTarget(degenerateRect, frame)).toBeNull();
    expect(textLayerEditTarget(invalidPosition, frame)).toBeNull();
  });

  it('returns null for a text layer with mixed affine + filter operations', () => {
    const layer = makeAffineLayer('layer-1', { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    layer.operations = [
      ...layer.operations,
      { id: 'blur-1', kind: 'filter', args: { toolName: 'blur', radius: 4 }, enabled: true },
    ];
    expect(textLayerEditTarget(layer, frame)).toBeNull();
  });

  it('returns null when source has no rect', () => {
    const layer = makeTextLayer('layer-1', {
      source: {
        kind: 'tool',
        args: {
          toolName: 'text',
          align: 'left',
          bold: false,
          color: '#000',
          fontFamily: 'Arial',
          fontSize: 64,
          italic: false,
          lineHeight: 1.2,
          text: 'Hello',
          rect: null,
        },
        pos: { x: 100, y: 100, width: 100, height: 50 },
      },
    });
    expect(textLayerEditTarget(layer, frame)).toBeNull();
  });

  it('returns null when layer has no source', () => {
    const layer = makeTextLayer('layer-1', { source: undefined });
    expect(textLayerEditTarget(layer, frame)).toBeNull();
  });
});

describe('textLayerEditTarget affine', () => {
  it('returns IDENTITY for a layer with only disabled affine operations', () => {
    const layer = makeAffineLayer(
      'layer-1',
      { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 },
      undefined,
      undefined,
      true // disabled
    );
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    expect(target!.affine).toBe(IDENTITY_AFFINE_TRANSFORM);
  });

  it('returns the composed affine for a layer with scale 2x', () => {
    const layer = makeAffineLayer('layer-1', { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    expect(target!.affine).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  });

  it('returns the composed affine for a layer with 90deg rotation', () => {
    // cos(90°)=0, sin(90°)=1 → a=0, b=1, c=-1, d=0
    const rotate90: AffineTransform = { a: 0, b: 1, c: -1, d: 0, e: 50, f: 50 };
    const layer = makeAffineLayer('layer-1', rotate90);
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    expect(target!.affine).toEqual(rotate90);
  });

  it('returns the composed affine for two stacked affine operations', () => {
    const layer = makeAffineLayer('layer-1', { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    layer.operations = [
      ...layer.operations,
      { id: 'affine-2', kind: 'affine-transform', transform: { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }, enabled: true },
    ];
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    // First op is scale 2x, second is 90° rotation.
    // getLayerAffineTransform composes: multiplyAffineTransforms(rotation, scale) —
    // it prepends each operation, so the second op (rotation) ends up outer.
    // Expected: rotation ∘ scale = {a: 0*2, b: 1*2, c: -1*2, d: 0*2, e: 0, f: 0} = {a:0, b:2, c:-2, d:0, e:0, f:0}
    expect(target!.affine).toEqual({ a: 0, b: 2, c: -2, d: 0, e: 0, f: 0 });
  });
});

describe('textLayerEditTarget rect placement', () => {
  it('places the original rect offset by canvasPos for identity affine', () => {
    const layer = makeTextLayer('layer-1');
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    // layer.pos = {x:100, y:100, w:100, h:50}, source rect = {0,0,100,50}
    // canvasPos = {x:100, y:100, w:100, h:50} (identity frame)
    // rect should be {100,100,200,150}
    expect(target!.args.rect).toEqual({ x1: 100, y1: 100, x2: 200, y2: 150 });
  });

  it('places the original rect offset by canvasPos for a scaled layer, NOT pre-scaled', () => {
    const layer = makeAffineLayer('layer-1', { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    // The rect stays as the ORIGINAL layer-local rect, offset by canvasPos.
    // The affine is applied separately as CSS, not baked into the rect.
    expect(target!.args.rect).toEqual({ x1: 100, y1: 100, x2: 200, y2: 150 });
    expect(target!.affine).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  });

  it('includes editingLayerId in the returned args', () => {
    const layer = makeTextLayer('layer-1');
    const target = textLayerEditTarget(layer, frame);
    expect(target).not.toBeNull();
    expect(target!.args.editingLayerId).toBe('layer-1');
  });

  it('respects a non-zero document frame origin', () => {
    const offsetFrame: DocumentFrame = { x: 50, y: 25, width: 800, height: 600 };
    const tmpLayer = makeTextLayer('tmp');
    const layer = makeTextLayer('layer-1', {
      pos: { x: 200, y: 150, width: 100, height: 50 },
      source: {
        kind: 'tool',
        args: (tmpLayer.source as { kind: 'tool'; args: TextToolArgs }).args,
        pos: { x: 200, y: 150, width: 100, height: 50 },
      },
    });
    const target = textLayerEditTarget(layer, offsetFrame);
    expect(target).not.toBeNull();
    expect(target!.args.rect).toEqual({ x1: 150, y1: 125, x2: 250, y2: 175 });
  });
});
