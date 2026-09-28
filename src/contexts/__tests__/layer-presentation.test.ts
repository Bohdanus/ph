import { describe, expect, it, vi } from 'vitest';

import { createMockImageBitmap, createMockOffscreenCanvas } from '../../__tests__/fixtures/canvas.ts';
import { createMockLayer, createMockLayers } from '../../__tests__/fixtures/layer.ts';
import type { ImageLayerSource, Layer, LayerId, LayersRecord } from '../layer-types.ts';
import type { BitmapSource } from '../general-types.ts';
import {
  closePresentationBitmap,
  DocumentPresentationScope,
  isSamePresentationCanvas,
  layersDifferOnlyByPresentation,
  materializePresentationBitmap,
} from '../layer-presentation.ts';

function staged(): BitmapSource {
  return createMockOffscreenCanvas(20, 10) as unknown as BitmapSource;
}

describe('isSamePresentationCanvas', () => {
  it('matches only the exact canvas the layer still holds', () => {
    const canvas = staged();
    const layer = createMockLayer({ tmpCanvas: canvas });

    expect(isSamePresentationCanvas(layer, canvas)).toBe(true);
    expect(isSamePresentationCanvas(layer, staged())).toBe(false);
    expect(isSamePresentationCanvas(createMockLayer({ tmpCanvas: null }), canvas)).toBe(false);
    expect(isSamePresentationCanvas(undefined, canvas)).toBe(false);
    expect(isSamePresentationCanvas(layer, null)).toBe(false);
  });
});

describe('layersDifferOnlyByPresentation', () => {
  it('accepts a record that only swaps a promoted cache', () => {
    const canvas = staged();
    const bitmap = createMockImageBitmap();
    const current = { a: createMockLayer({ id: 'a', tmpCanvas: canvas }) };

    const next = { a: { ...current.a, bitmap, tmpCanvas: null } };

    expect(layersDifferOnlyByPresentation(current, next)).toBe(true);
  });

  it('accepts an untouched layer that was republished by reference', () => {
    const current = createMockLayers(3);

    expect(layersDifferOnlyByPresentation(current, { ...current })).toBe(true);
  });

  it.each([
    ['pos', { pos: { x: 5, y: 5, width: 100, height: 100 } }],
    ['name', { name: 'Renamed' }],
    ['visible', { visible: false }],
    ['opacity', { opacity: 0.5 }],
    ['locked', { locked: true }],
    ['order', { order: 9 }],
    ['blendMode', { blendMode: 'multiply' as const }],
    ['operations', { operations: [{ id: 'op-1', args: { toolName: 'blur', radius: 2 } }] }],
  ])('refuses a publication that also changes %s', (_field, patch) => {
    const current = { a: createMockLayer({ id: 'a', tmpCanvas: staged() }) };
    const next = { a: { ...current.a, ...patch, bitmap: createMockImageBitmap() } as Layer };

    expect(layersDifferOnlyByPresentation(current, next)).toBe(false);
  });

  it('refuses a publication that adds or removes a layer', () => {
    const current = createMockLayers(2);

    expect(layersDifferOnlyByPresentation(current, { ...current, extra: createMockLayer({ id: 'extra' }) })).toBe(
      false
    );

    const missing: LayersRecord = { ...current };
    delete missing[Object.keys(current)[0]];
    expect(layersDifferOnlyByPresentation(current, missing)).toBe(false);
  });

  it('refuses a publication that swaps a raster source for a different bitmap', () => {
    const source: ImageLayerSource = {
      kind: 'image',
      bitmap: createMockImageBitmap(10, 10),
      name: 'imported',
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isBedrock: false,
    };
    const current = { a: createMockLayer({ id: 'a', source }) };

    expect(layersDifferOnlyByPresentation(current, { a: { ...current.a, bitmap: createMockImageBitmap() } })).toBe(
      true
    );

    const swapped: LayersRecord = {
      a: { ...current.a, source: { ...source, bitmap: createMockImageBitmap(10, 10) } },
    };
    expect(layersDifferOnlyByPresentation(current, swapped)).toBe(false);
  });

  it('fails closed on an unexpected value shape instead of treating it as presentation', () => {
    const current = { a: createMockLayer({ id: 'a' }) };
    // Two distinct keyless objects compare equal to a naive key-count comparator.
    // A durable field holding one must be reported as a difference.
    const next = {
      a: {
        ...current.a,
        operations: [{ id: 'op-1', args: new Uint8Array([1, 2]) }] as unknown as Layer['operations'],
      },
    };

    expect(layersDifferOnlyByPresentation(current, next)).toBe(false);
  });
});

describe('closePresentationBitmap', () => {
  it('closes a bitmap it owns and ignores anything else', () => {
    const bitmap = createMockImageBitmap();
    closePresentationBitmap(bitmap);
    expect(bitmap.close).toHaveBeenCalledTimes(1);

    const canvas = staged();
    expect(() => closePresentationBitmap(canvas)).not.toThrow();
  });
});

describe('materializePresentationBitmap', () => {
  it('contains a materialization failure and resolves undefined', async () => {
    const failure = new Error('materialization failed');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw failure;
      })
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(materializePresentationBitmap(staged())).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('Unable to materialize layer presentation cache', failure);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects when the platform has no createImageBitmap', async () => {
    const original = globalThis.createImageBitmap;
    // @ts-expect-error deliberately removing the global for the negative path
    delete globalThis.createImageBitmap;
    try {
      await expect(materializePresentationBitmap(staged())).rejects.toThrow(/createImageBitmap/);
    } finally {
      globalThis.createImageBitmap = original;
    }
  });
});

describe('DocumentPresentationScope ownership', () => {
  // `deliver`/`deliverBatch` hand a materialized value to the store, which then
  // owns it. A delivery is settled by yielding one microtask: the scope's handler
  // is registered before the test's continuation, so it always runs first.
  const settle = () => Promise.resolve();

  it('hands a live publication to the store, which then owns it', async () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    const publish = vi.fn((published: BitmapSource) => scope.trackPublished('doc-1', published));

    scope.deliver(Promise.resolve(bitmap), publish);
    await settle();

    expect(publish).toHaveBeenCalledWith(bitmap);
    expect(bitmap.close).not.toHaveBeenCalled();

    scope.dispose();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes a bitmap that arrives after the provider is torn down', async () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    const publish = vi.fn();
    scope.dispose();

    scope.deliver(Promise.resolve(bitmap), publish);
    await settle();

    expect(publish).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('retires a cache only when this boundary created it AND nothing names it', () => {
    // The single-retirement form was deleted rather than kept as a second route. It
    // had no production caller once `retireUnreferenced` existed, and it is exactly
    // the API that caused the use-after-close: it closed by name with no liveness
    // question, so a raster an adopted raster's history entry still named was
    // closed on the promotion path. Two ways to retire, one of them unsafe, is a
    // defect waiting for the next caller.
    const scope = new DocumentPresentationScope();
    const owned = createMockImageBitmap();
    const alsoNamed = createMockImageBitmap(20, 20);
    scope.trackPublished('doc-1', owned);
    scope.trackPublished('doc-1', alsoNamed);
    // Never published: a raster borrowed from an import, a replay, or an
    // in-flight materialization is not a candidate at all, so ownership still
    // decides before liveness is even consulted.
    const borrowed = createMockImageBitmap(10, 10);
    const stranger = createMockImageBitmap(30, 30);

    scope.retireUnreferenced('doc-1', () => new Set([alsoNamed, stranger, borrowed]));
    expect(stranger.close).not.toHaveBeenCalled();
    expect(borrowed.close).not.toHaveBeenCalled();
    // `alsoNamed` is published AND named, so liveness has to veto it — that is the
    // case the deleted method got wrong.
    expect(alsoNamed.close).not.toHaveBeenCalled();
    expect(owned.close).toHaveBeenCalledTimes(1);
    // A second call must not close the same raster twice.
    scope.retireUnreferenced('doc-1', () => new Set());
    expect(owned.close).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('never asks for the liveness set when it owns nothing for the document', () => {
    // The liveness question is the store's, and answering it is O(history) over an
    // array that grows for the life of a session. It is passed as a thunk precisely
    // so the ownership check above can refuse it: a document this scope has
    // published nothing for has nothing to retire, whatever the answer says.
    const scope = new DocumentPresentationScope();
    const walk = vi.fn<() => ReadonlySet<BitmapSource>>(() => new Set());
    const ownedElsewhere = createMockImageBitmap();
    scope.trackPublished('doc-2', ownedElsewhere);

    scope.retireUnreferenced('doc-1', walk);

    expect(walk).not.toHaveBeenCalled();
    expect(ownedElsewhere.close).not.toHaveBeenCalled();

    // The control, so the assertion above cannot pass for the wrong reason: a
    // document it DOES own asks exactly once, and the empty answer is honoured.
    scope.retireUnreferenced('doc-2', walk);

    expect(walk).toHaveBeenCalledTimes(1);
    expect(ownedElsewhere.close).toHaveBeenCalledTimes(1);

    scope.dispose();
  });

  it('releases every published cache of a departing document and keeps the live one', () => {
    const scope = new DocumentPresentationScope();
    const leaving = createMockImageBitmap();
    const staying = createMockImageBitmap();
    scope.trackPublished('doc-old', leaving);
    scope.trackPublished('doc-new', staying);

    scope.releaseDocument('doc-old');
    expect(leaving.close).toHaveBeenCalledTimes(1);
    expect(staying.close).not.toHaveBeenCalled();

    scope.releaseDocument('doc-old');
    expect(leaving.close).toHaveBeenCalledTimes(1);

    scope.dispose();
    expect(staying.close).toHaveBeenCalledTimes(1);
  });

  it('disposes each published bitmap exactly once', () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    scope.trackPublished('doc-1', bitmap);

    scope.dispose();
    scope.dispose();

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('closes a bitmap that is tracked after teardown', () => {
    const scope = new DocumentPresentationScope();
    const bitmap = createMockImageBitmap();
    scope.dispose();

    scope.trackPublished('doc-1', bitmap);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('publishes a whole batch in one handoff while the provider is live', async () => {
    const scope = new DocumentPresentationScope();
    const bitmaps = [createMockImageBitmap(), createMockImageBitmap(20, 20)];
    const publish = vi.fn((published: readonly (BitmapSource | undefined)[]) => {
      for (const bitmap of published) {
        if (bitmap) scope.trackPublished('doc-1', bitmap);
      }
    });

    scope.deliverBatch(Promise.resolve(bitmaps), publish);
    await settle();

    expect(publish).toHaveBeenCalledWith(bitmaps);
    expect(bitmaps[0].close).not.toHaveBeenCalled();

    scope.dispose();
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    expect(bitmaps[1].close).toHaveBeenCalledTimes(1);
  });

  it('closes every materialized bitmap of a batch that arrives after teardown', async () => {
    const scope = new DocumentPresentationScope();
    const first = createMockImageBitmap();
    const second = createMockImageBitmap(20, 20);
    const publish = vi.fn();
    scope.dispose();

    scope.deliverBatch(Promise.resolve([first, undefined, second]), publish);
    await settle();

    expect(publish).not.toHaveBeenCalled();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });
});

describe('LayerPresentationRequest identity', () => {
  it('keeps the layer id and canvas it was created with', () => {
    const layerId: LayerId = 'layer-1';
    const canvas = staged();
    const request = { layerId, canvas };

    expect(request.layerId).toBe(layerId);
    expect(request.canvas).toBe(canvas);
  });
});
