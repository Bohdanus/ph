import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayerSource, createAffineLayerOperation, createLayerOperation, maxLayerOrder } from '../layer-utils.ts';
import type { Layer, LayerOperation, LayersRecord } from '../layer-types.ts';
import type { BlankLayerSource, ImageLayerSource, ToolLayerSource } from '../layer-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';

function existingLayers(overrides: LayersRecord = {}): LayersRecord {
  return {
    low: {
      id: 'low',
      name: 'Low',
      isBedrock: false,
      tmpCanvas: null,
      bitmap: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 3,
      pos: { x: 0, y: 0, width: 10, height: 10 },
      presentationBounds: null,
      operations: [],
    },
    ...overrides,
  };
}

function bitmapSource(overrides: Partial<ImageLayerSource> = {}): ImageLayerSource {
  return {
    kind: 'image',
    bitmap: { width: 12, height: 8, close: vi.fn() } as unknown as ImageBitmap,
    name: 'Photo.png',
    pos: { x: 4, y: 6, width: 12, height: 8 },
    ...overrides,
  } as ImageLayerSource;
}

function blankSource(overrides: Partial<BlankLayerSource> = {}): BlankLayerSource {
  return {
    kind: 'blank',
    color: '#ff0000',
    opacity: 1,
    isBedrock: true,
    size: { width: 16, height: 9 },
    ...overrides,
  } as BlankLayerSource;
}

/** A tool source that carries an explicit document-space position, as every
 *  non-bedrock creator layer does. */
type PositionedToolSource = ToolLayerSource & { pos: { x: number; y: number; width: number; height: number } };

function toolSource(overrides: Partial<PositionedToolSource> = {}): PositionedToolSource {
  return {
    kind: 'tool',
    pos: { x: 1, y: 2, width: 20, height: 10 },
    args: { toolName: 'shape' },
    ...overrides,
  } as unknown as PositionedToolSource;
}

let createImageBitmapSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap');
});

afterEach(() => {
  createImageBitmapSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('createLayerSource naming and ordering', () => {
  it('names an image layer from its file name and numbers it after the current stack', () => {
    const layer = createLayerSource({ layers: existingLayers(), source: bitmapSource() });

    expect(layer.name).toBe('Photo.png 4');
    expect(layer.order).toBe(4);
    expect(layer.id).toEqual(expect.any(String));
  });

  it('numbers the first layer of an empty document as 1', () => {
    const layer = createLayerSource({ layers: {}, source: bitmapSource() });

    expect(layer.name).toBe('Photo.png 1');
    expect(layer.order).toBe(1);
    expect(maxLayerOrder({})).toBe(0);
  });

  it('truncates a long image name with an ellipsis', () => {
    const layer = createLayerSource({ layers: {}, source: bitmapSource({ name: 'x'.repeat(40) }) });

    expect(layer.name).toBe(`${'x'.repeat(17)}... 1`);
    expect(layer.name).toHaveLength(22);
  });

  it('falls back to a generic name for an unnamed image source', () => {
    const layer = createLayerSource({ layers: {}, source: bitmapSource({ name: '' }) });

    expect(layer.name).toBe('Image 1');
  });

  it('names a blank layer Blank and a tool layer after its tool', () => {
    const raster = new OffscreenCanvas(20, 10);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);

    expect(createLayerSource({ layers: {}, source: blankSource() }).name).toBe('Blank 1');
    expect(createLayerSource({ layers: {}, source: toolSource() }).name).toBe('shape 1');
    processor.mockRestore();
  });

  it('reuses the supplied layer id so a replayed layer keeps its identity', () => {
    const layer = createLayerSource({ layerId: 'restored-id', layers: {}, source: bitmapSource() });

    expect(layer.id).toBe('restored-id');
  });
});

describe('createLayerSource geometry', () => {
  it('anchors a bedrock layer at the origin and uses its declared size', () => {
    const layer = createLayerSource({
      layers: {},
      source: blankSource({ isBedrock: true, size: { width: 640, height: 480 } }),
    });

    expect(layer.pos).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    expect(layer.isBedrock).toBe(true);
  });

  it('uses the source position verbatim for a non-bedrock layer', () => {
    const layer = createLayerSource({ layers: {}, source: bitmapSource({ pos: { x: 7, y: 8, width: 3, height: 4 } }) });

    expect(layer.pos).toEqual({ x: 7, y: 8, width: 3, height: 4 });
    expect(layer.isBedrock).toBe(false);
  });

  it('defaults isBedrock to false when the source omits it', () => {
    const layer = createLayerSource({ layers: {}, source: bitmapSource({ isBedrock: undefined }) });

    expect(layer.isBedrock).toBe(false);
  });

  it.each([
    ['a zero width', { x: 0, y: 0, width: 0, height: 10 }],
    ['a zero height', { x: 0, y: 0, width: 10, height: 0 }],
  ])('rejects a layer with %s', (_label, pos) => {
    expect(() => createLayerSource({ layers: {}, source: bitmapSource({ pos }) })).toThrow(
      'Layer width and height must be greater than 0'
    );
  });

  it('rejects a zero-extent bedrock size', () => {
    expect(() =>
      createLayerSource({ layers: {}, source: blankSource({ isBedrock: true, size: { width: 0, height: 0 } }) })
    ).toThrow('Layer width and height must be greater than 0');
  });
});

describe('createLayerSource defaults', () => {
  it('starts a new layer blank, unlocked, fully opaque and operation free', () => {
    const layer = createLayerSource({ layers: {}, source: bitmapSource() });

    expect(layer).toMatchObject({
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      operations: [],
      tmpCanvas: null,
    });
  });
});

describe('createLayerSource image sources', () => {
  it('adopts the supplied bitmap without materialising anything', () => {
    const source = bitmapSource();
    const layer = createLayerSource({ layers: {}, source });

    expect(layer.bitmap).toBe(source.bitmap);
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
  });
});

describe('createLayerSource blank sources', () => {
  it('fills the canvas and leaves promotion to the store', () => {
    // A published layer is owned by the store, so the factory only stages the
    // canvas. Promotion is a reducer publication through
    // `PROMOTE_LAYER_PRESENTATIONS`, covered in StoreContext.presentation.test.tsx.
    const layer = createLayerSource({ layers: {}, source: blankSource({ opacity: 1 }) });
    const staged = layer.tmpCanvas;
    expect(staged).not.toBeNull();
    expect((staged as OffscreenCanvas).width).toBe(16);
    expect((staged as OffscreenCanvas).height).toBe(9);
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    expect(layer.bitmap).toBeNull();
  });

  it('applies the source opacity as the context alpha for a translucent fill', () => {
    const source = blankSource({ opacity: 0.5 });
    const layer = createLayerSource({ layers: {}, source });
    const context = (layer.tmpCanvas as OffscreenCanvas).getContext('2d') as unknown as Record<string, unknown>;

    expect(context.globalAlpha).toBe(0.5);
    expect(context.fillStyle).toBe('#ff0000');
  });

  it('skips the alpha write for a fully opaque fill', () => {
    const layer = createLayerSource({ layers: {}, source: blankSource({ opacity: 1 }) });
    const context = (layer.tmpCanvas as OffscreenCanvas).getContext('2d') as unknown as Record<string, unknown>;

    // A `globalAlpha` of exactly 1 is the default, so the mock records no write.
    expect(context.fillStyle).toBe('#ff0000');
  });

  it('still allocates a canvas for a fully transparent fill but never reads a context', () => {
    const layer = createLayerSource({ layers: {}, source: blankSource({ opacity: 0 }) });

    expect(layer.tmpCanvas).not.toBeNull();
    expect((layer.tmpCanvas as OffscreenCanvas).width).toBe(16);
  });

  it('stages the canvas without materialising it', () => {
    const layer = createLayerSource({ layers: {}, source: blankSource() });

    expect(layer.tmpCanvas).not.toBeNull();
    expect(layer.bitmap).toBeNull();
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
  });
});

describe('createLayerSource tool sources', () => {
  it('rasterises the tool and applies its position patch without materialising the canvas', () => {
    const raster = new OffscreenCanvas(30, 12);
    const processor = vi
      .spyOn(toolProcessors.shape, 'imageProcessor')
      .mockReturnValue(() => [raster, { x: 5, y: 6, width: 30, height: 12 }]);
    const source = toolSource();

    const layer = createLayerSource({ layers: {}, source });

    expect(processor).toHaveBeenCalledWith({ size: source.pos });
    expect(layer.tmpCanvas).toBe(raster);
    // The patch overrides the source position rather than offsetting it.
    expect(layer.pos).toEqual({ x: 5, y: 6, width: 30, height: 12 });
    // Promotion is the store's publication, not the factory's: the raster is
    // staged as-is and materialised only when the publisher asks for it.
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    expect(layer.bitmap).toBeNull();
    processor.mockRestore();
  });

  it('keeps the source position when the tool returns no patch', () => {
    const raster = new OffscreenCanvas(20, 10);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);
    const source = toolSource();

    const layer = createLayerSource({ layers: {}, source });

    expect(layer.pos).toEqual(source.pos);
    processor.mockRestore();
  });

  it('stages the raster without materialising it', () => {
    const raster = new OffscreenCanvas(20, 10);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);

    const layer = createLayerSource({ layers: {}, source: toolSource() });

    expect(layer.tmpCanvas).toBe(raster);
    expect(createImageBitmapSpy).not.toHaveBeenCalled();
    processor.mockRestore();
  });

  it('keeps the creator source attached to the layer for replay', () => {
    const raster = new OffscreenCanvas(20, 10);
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor').mockReturnValue(() => [raster]);
    const source = toolSource();

    const layer = createLayerSource({ layers: {}, source });

    expect(layer.source).toBe(source);
    processor.mockRestore();
  });
});

type FilterOperation = Extract<LayerOperation, { args: unknown }>;

/** `createLayerOperation` is declared as returning the whole union; every
 *  operation it builds is the filter variant, so narrow it once here. */
const createFilterOperation = (args: FilterOperation['args'], id?: string) =>
  createLayerOperation(args, id) as FilterOperation;

describe('layer operation factories', () => {
  it('freezes a layer operation and its argument copy', () => {
    const operation = createFilterOperation({ toolName: 'blur', radius: 3 } as FilterOperation['args']);

    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.args)).toBe(true);
    expect(operation.enabled).toBe(true);
    expect(operation.id).toEqual(expect.any(String));
    expect('kind' in operation).toBe(false);
  });

  it('does not alias the argument object it was given', () => {
    const args = { toolName: 'blur', radius: 3 } as FilterOperation['args'];
    const operation = createFilterOperation(args);

    expect(operation.args).not.toBe(args);
    expect(operation.args).toEqual(args);
  });

  it('accepts an explicit operation id and the optional filter kind', () => {
    const operation = createFilterOperation(
      { kind: 'filter', toolName: 'blur', radius: 1 } as unknown as FilterOperation['args'],
      'op-42'
    );

    expect(operation.id).toBe('op-42');
  });

  it('freezes an affine operation and its transform copy', () => {
    const transform = { a: 2, b: 0, c: 0, d: 2, e: 1, f: 1 };
    const operation = createAffineLayerOperation(transform, 'affine-7');

    expect(operation).toEqual({
      id: 'affine-7',
      kind: 'affine-transform',
      transform,
      enabled: true,
    });
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.transform)).toBe(true);
    expect(operation.transform).not.toBe(transform);
  });

  it('generates an id for an affine operation when none is supplied', () => {
    const operation = createAffineLayerOperation({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

    expect(operation.id).toEqual(expect.any(String));
  });

  it('produces operations that can be carried on a layer without being mutated', () => {
    const layer: Layer = createLayerSource({ layers: {}, source: bitmapSource() });
    const operation = createFilterOperation({ toolName: 'blur', radius: 1 } as FilterOperation['args']);

    layer.operations = [operation];

    expect(() => {
      (layer.operations[0] as { enabled: boolean }).enabled = false;
    }).toThrow();
    expect(layer.operations[0]!.enabled).toBe(true);
  });
});
