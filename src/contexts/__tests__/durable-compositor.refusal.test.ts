import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { composeDurableDocument } from '../durable-compositor.ts';
import { documentFrameSize, type DocumentFrame } from '../document-frame.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { DurableLayerSnapshot, DurableLayerSource, DurableOperation } from '../history-model.ts';
import { materializeDocument, type MaterializationRequest } from '../materialization.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';

const frame: DocumentFrame = { x: 0, y: 0, width: 120, height: 80 };

type RecordingContext = CanvasRenderingContext2D & {
  alphaValues: number[];
  compositeValues: GlobalCompositeOperation[];
  /**
   * The `vi.fn()` below, re-declared as a mock. `CanvasRenderingContext2D` types
   * `drawImage` as three overloaded plain functions, so on the base type `.mock` does not
   * exist and the recorded geometry — the cheapest witness of ASCENDING layer order, since
   * it carries each layer's own position — was unreadable without it.
   */
  drawImage: Mock;
};

const recordingContexts: RecordingContext[] = [];

class RecordingCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context: RecordingContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const alphaValues: number[] = [];
    const compositeValues: GlobalCompositeOperation[] = [];
    const state = {
      alpha: 1,
      composite: 'source-over' as GlobalCompositeOperation,
    };
    const context = {
      alphaValues,
      compositeValues,
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      translate: vi.fn(),
      transform: vi.fn(),
      filter: 'none',
    } as unknown as RecordingContext;
    Object.defineProperties(context, {
      globalAlpha: {
        get: () => state.alpha,
        set: (value: number) => {
          state.alpha = value;
          alphaValues.push(value);
        },
      },
      globalCompositeOperation: {
        get: () => state.composite,
        set: (value: GlobalCompositeOperation) => {
          state.composite = value;
          compositeValues.push(value);
        },
      },
    });
    this.context = context;
    recordingContexts.push(context);
  }

  getContext(): RecordingContext {
    return this.context;
  }
}

/**
 * Hands out a working context for the first `workingContexts` requests and refuses
 * every later one, which is how the compositor's OWN surface is made to fail while the
 * per-layer materializations that precede it still succeed. One blank layer with no
 * operations consumes two surfaces before composition begins — the synthesized blank
 * (`materialization.ts`) and its retained-segment presentation — so `refuseAfter(2)`
 * fails exactly the frame surface the compositor allocates afterwards.
 */
class RefusingRecordingCanvas extends RecordingCanvas {
  private static remaining = Number.POSITIVE_INFINITY;

  static refuseAfter(workingContexts: number): void {
    RefusingRecordingCanvas.remaining = workingContexts;
  }

  override getContext(): RecordingContext {
    if (RefusingRecordingCanvas.remaining <= 0) throw new Error('compositor surface refused');
    RefusingRecordingCanvas.remaining -= 1;
    return super.getContext();
  }
}

function source(width = 20, height = 20): DurableLayerSource {
  return Object.freeze({
    kind: 'blank' as const,
    color: '#ffffff',
    opacity: 1,
    size: { width, height },
    isBedrock: false,
  });
}

function layer(
  id: string,
  order: number,
  options: Readonly<{
    visible?: boolean;
    opacity?: number;
    blendMode?: GlobalCompositeOperation;
    operations?: readonly DurableOperation[];
    pos?: { x: number; y: number; width: number; height: number };
  }> = {}
): DurableReplayLayer {
  const pos = options.pos ?? { x: 0, y: 0, width: 20, height: 20 };
  const snapshot: DurableLayerSnapshot = Object.freeze({
    id,
    name: id,
    isBedrock: false,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    locked: false,
    blendMode: options.blendMode ?? 'source-over',
    order,
    pos,
    source: source(pos.width, pos.height),
  });
  return Object.freeze({ snapshot, operations: Object.freeze(options.operations ?? []) });
}

function refusedFilter(layerId: string): DurableOperation {
  return Object.freeze({
    kind: 'apply-filter',
    layerId,
    filter: Object.freeze({ toolName: 'blur', version: 1, args: Object.freeze({ radius: 3 }) }),
  });
}

function replay(layers: Record<string, DurableReplayLayer>): DurableReplayResult {
  return Object.freeze({
    documentId: 'test-document',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 1,
    cursor: 0,
    frame,
    totalSize: documentFrameSize(frame),
    layers: Object.freeze(layers),
    selections: Object.freeze({ selections: Object.freeze([]), activeSelectionId: null }),
    activeLayerId: Object.keys(layers)[0] ?? null,
  });
}

function request(registry: AssetRegistry): MaterializationRequest {
  return {
    documentId: 'test-document',
    baselineAssetGeneration: 0,
    operationSetRevision: 0,
    assetRegistry: registry,
  };
}

afterEach(() => {
  overrideCanvasFilterSupport(null);
  vi.unstubAllGlobals();
  recordingContexts.length = 0;
});

describe('durable document refusal and composition', () => {
  it('omits only a refused layer, logs its id and error, and releases successful leases', async () => {
    overrideCanvasFilterSupport(false);
    const registry = new AssetRegistry();
    const releaseSpies: ReturnType<typeof vi.fn>[] = [];
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const release = vi.fn(lease.release);
      releaseSpies.push(release);
      return { ...lease, release };
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layers = {
      'layer-good-a': layer('layer-good-a', 0),
      'layer-bad': layer('layer-bad', 1, { operations: [refusedFilter('layer-bad')] }),
      'layer-good-c': layer('layer-good-c', 2),
    };

    const result = await materializeDocument(replay(layers), request(registry));

    expect(Object.keys(result.layers)).toEqual(['layer-good-a', 'layer-good-c']);
    expect(consoleError).toHaveBeenCalledWith(
      'Unable to materialize durable layer layer-bad; skipping layer',
      expect.objectContaining({ message: expect.stringContaining('CanvasRenderingContext2D.filter') })
    );
    result.release();
    result.release();
    expect(releaseSpies).toHaveLength(2);
    for (const release of releaseSpies) expect(release).toHaveBeenCalledTimes(1);
    registry.shutdown();
  });

  it('refuses composition when a visible layer cannot materialize, without publishing a partial bitmap', async () => {
    overrideCanvasFilterSupport(false);
    vi.stubGlobal('OffscreenCanvas', RecordingCanvas);
    vi.stubGlobal('createImageBitmap', undefined);
    const registry = new AssetRegistry();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The same four layers the salvaged version of this test composed, with one change in
    // what is CLAIMED rather than in what is arranged: this compositor does not skip a
    // refused layer, it refuses the document. `durable-compositor.ts` says so in its own
    // docstring — "never substitutes an unfiltered source for a refused layer" — and a
    // published document missing a layer the user can see is a different document from the
    // one the history records, which is the failure this file exists to prevent.
    const layers = {
      'layer-hidden': layer('layer-hidden', 0, { visible: false }),
      'layer-screen': layer('layer-screen', 1, {
        opacity: 0.75,
        blendMode: 'screen',
        pos: { x: 10, y: 12, width: 30, height: 18 },
      }),
      'layer-multiply': layer('layer-multiply', 2, { opacity: 0.5, blendMode: 'multiply' }),
      'layer-bad': layer('layer-bad', 3, { operations: [refusedFilter('layer-bad')] }),
    };
    const durableDocumentBefore = Object.keys(layers);

    await expect(composeDurableDocument(replay(layers), request(registry))).rejects.toThrow(
      'Unable to compose durable layer layer-bad'
    );

    // The refusal is reported by layer id, with the cause, rather than silently dropped.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Unable to materialize durable layer layer-bad; skipping layer',
      expect.objectContaining({ message: expect.stringContaining('CanvasRenderingContext2D.filter') })
    );

    // The guarantee is the REJECTION, not an untouched surface: the compositor draws the
    // layers below the refused one and only then throws, so the frame surface does receive
    // two blits. What makes that safe is that the canvas is local and is dropped with the
    // throw — a partial composite reaches no caller. Asserting "nothing was drawn" here
    // would pin a claim about the internals that the failure path does not make.
    expect(recordingContexts.at(-1)?.drawImage).toHaveBeenCalledTimes(2);

    // A refusal is a rendering outcome, not an edit: the DURABLE DOCUMENT it was composed
    // from still carries the refused layer and its operation, unchanged. Both are frozen, so
    // this would be a `TypeError` rather than a mismatch if composition had mutated them.
    expect(Object.keys(layers)).toEqual(durableDocumentBefore);
    expect(layers['layer-bad'].operations).toHaveLength(1);
    registry.shutdown();
  });

  it('composes the surviving layers in ASCENDING ORDER, not in the order the record is keyed', async () => {
    overrideCanvasFilterSupport(false);
    vi.stubGlobal('OffscreenCanvas', RecordingCanvas);
    vi.stubGlobal('createImageBitmap', undefined);
    const registry = new AssetRegistry();
    // The record is keyed in an order that CONTRADICTS `snapshot.order`: `layer-screen`
    // is declared first but is order 1, `layer-multiply` second but is order 0. A
    // compositor that iterated the record instead of sorting by order draws them the
    // other way round, and the alpha/composite/blit assertions below all read reversed.
    const layers = {
      'layer-screen': layer('layer-screen', 1, {
        opacity: 0.75,
        blendMode: 'screen',
        pos: { x: 10, y: 12, width: 30, height: 18 },
      }),
      'layer-multiply': layer('layer-multiply', 0, { opacity: 0.5, blendMode: 'multiply' }),
      'layer-hidden': layer('layer-hidden', 2, { visible: false }),
    };

    const result = await composeDurableDocument(replay(layers), request(registry));

    // The visible document holds the two visible layers, in ASCENDING ORDER — positionally,
    // not as a count and not as a membership set. The alpha and the composite operation are
    // the cheapest witnesses of it, because they are read back off the context in the order
    // the compositor wrote them.
    const output = recordingContexts.at(-1);
    expect(output).toBeDefined();
    expect(output?.alphaValues).toEqual([0.5, 0.75]);
    expect(output?.compositeValues).toEqual(['multiply', 'screen']);
    expect(output?.drawImage.mock.calls.map(([, x, y, width, height]) => [x, y, width, height])).toEqual([
      [0 - frame.x, 0 - frame.y, 20, 20],
      [10 - frame.x, 12 - frame.y, 30, 18],
    ]);

    // The hidden layer is not in the published set, and that is `materializeDocument`'s
    // decision rather than the compositor's: it `continue`s past an invisible layer before
    // any processor runs, so no hidden layer bitmap is ever taken or leased. The salvaged
    // version of this case asserted the opposite — that the hidden layer materialized and
    // contributed no pixels — which would pin a wasted materialization as the contract.
    expect(result.layers).not.toHaveProperty('layer-hidden');
    expect(Object.keys(result.layers).sort()).toEqual(['layer-multiply', 'layer-screen']);

    result.release();
    registry.shutdown();
  });

  it('refuses the whole document when EVERY layer is refused, rather than publishing an empty frame', async () => {
    // The salvaged version of this case asserted the opposite — that zero surviving layers
    // is a boundary rather than an error, and that the compositor hands back a frame-sized
    // surface containing nothing. That is the same defect as skipping ONE refused layer, at
    // its limit: an empty document published as if it were the user's, with no indication
    // that anything failed. So the refusal is asserted here instead, and the two refusals
    // are named individually so one lost layer cannot hide behind another.
    overrideCanvasFilterSupport(false);
    vi.stubGlobal('OffscreenCanvas', RecordingCanvas);
    vi.stubGlobal('createImageBitmap', undefined);
    const registry = new AssetRegistry();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const layers = {
      'layer-bad-a': layer('layer-bad-a', 0, { operations: [refusedFilter('layer-bad-a')] }),
      'layer-bad-b': layer('layer-bad-b', 1, { operations: [refusedFilter('layer-bad-b')] }),
    };

    await expect(composeDurableDocument(replay(layers), request(registry))).rejects.toThrow(
      'Unable to compose durable layer layer-bad-a'
    );

    // Both are reported even though the first one already ended the composition, because
    // `materializeDocument` refuses them independently and names each.
    expect(consoleError.mock.calls.map(([message]) => message)).toEqual([
      'Unable to materialize durable layer layer-bad-a; skipping layer',
      'Unable to materialize durable layer layer-bad-b; skipping layer',
    ]);

    // And no empty frame was handed back for the caller to publish.
    expect(recordingContexts.at(-1)?.drawImage).not.toHaveBeenCalled();
    registry.shutdown();
  });

  it('releases every materialized lease and rethrows when its own composition surface fails', async () => {
    // The fail-closed half of the refusal contract: when the compositor cannot build
    // the document frame it must not hand back a partial composite, and it must not
    // strand the per-layer leases it already took.
    vi.stubGlobal('OffscreenCanvas', RefusingRecordingCanvas);
    vi.stubGlobal('createImageBitmap', undefined);
    const registry = new AssetRegistry();
    const releaseSpies: ReturnType<typeof vi.fn>[] = [];
    const originalMaterialize = registry.materialize.bind(registry);
    vi.spyOn(registry, 'materialize').mockImplementation(async (input) => {
      const lease = await originalMaterialize(input);
      const wrapped = vi.fn(lease.release);
      releaseSpies.push(wrapped);
      return { ...lease, release: wrapped };
    });
    const layers = { 'layer-good': layer('layer-good', 0) };

    // One blank layer consumes exactly two surfaces before composition: the synthesized
    // blank and its retained-segment presentation. The third is the compositor's.
    RefusingRecordingCanvas.refuseAfter(2);
    await expect(composeDurableDocument(replay(layers), request(registry))).rejects.toThrow(
      'compositor surface refused'
    );

    // The materialized lease was taken and then handed back — a composite that was
    // never returned must not keep a layer bitmap alive.
    expect(releaseSpies).toHaveLength(1);
    expect(releaseSpies[0]).toHaveBeenCalledTimes(1);
    registry.shutdown();
  });
});
