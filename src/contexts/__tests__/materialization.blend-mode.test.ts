import { afterEach, describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { composeDurableDocument } from '../durable-compositor.ts';
import { documentFrameSize, type DocumentFrame } from '../document-frame.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { DurableLayerSnapshot, DurableLayerSource, DurableOperation } from '../history-model.ts';
import { materializeLayer, type MaterializationRequest } from '../materialization.ts';

/**
 * The compositing boundary has to apply `snapshot.blendMode`, and these are the assertions that
 * can actually observe it.
 *
 * The globally installed context in `src/test/setup.ts` is a `vi.fn()` shell: `drawImage` computes
 * nothing and `globalCompositeOperation` is a plain data property, so a test that only records the
 * WRITE proves only that an assignment happened — the exact mistake the comment on `filter` in that
 * file records having shipped. Nothing in jsdom can compare blended pixels, because there are no
 * blended pixels. What is observable, and what a real canvas would be obliged to honour, is the
 * state IN FORCE at the moment of the draw: the operation and alpha the context actually held when
 * the layer's image reached it.
 *
 * So `BlendingCanvas` models a genuine save/restore stack and samples the accessors from inside
 * `drawImage`. Every layer in these tests is a blank source whose `source.opacity` is 1 and whose
 * snapshot opacity varies independently, which is what lets "the alpha came from the layer" be
 * distinguished from "the alpha came from the source".
 */

const frame: DocumentFrame = { x: 0, y: 0, width: 60, height: 40 };

type DrawState = Readonly<{ composite: GlobalCompositeOperation; alpha: number }>;

class BlendingCanvas {
  readonly width: number;
  readonly height: number;
  readonly draws: DrawState[] = [];
  readonly compositeWrites: GlobalCompositeOperation[] = [];
  readonly smoothingAtDraw: boolean[] = [];

  private readonly state = { composite: 'source-over' as GlobalCompositeOperation, alpha: 1, smoothing: true };
  private readonly stack: Array<{ composite: GlobalCompositeOperation; alpha: number; smoothing: boolean }> = [];
  private readonly context: CanvasRenderingContext2D;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const { state, stack, draws, compositeWrites, smoothingAtDraw } = this;
    const context = {
      filter: 'none',
      save: () => {
        stack.push({ composite: state.composite, alpha: state.alpha, smoothing: state.smoothing });
      },
      restore: () => {
        const previous = stack.pop();
        if (!previous) return;
        state.composite = previous.composite;
        state.alpha = previous.alpha;
        state.smoothing = previous.smoothing;
      },
      clearRect: () => undefined,
      fillRect: () => undefined,
      setTransform: () => undefined,
      translate: () => undefined,
      transform: () => undefined,
      // Sampled through the accessors below, so what lands in `draws` is the state in force for
      // THIS draw rather than the sequence of writes that preceded it.
      drawImage: () => {
        draws.push({ composite: state.composite, alpha: state.alpha });
        smoothingAtDraw.push(state.smoothing);
      },
    } as unknown as Record<string, unknown>;
    Object.defineProperties(context, {
      globalAlpha: {
        get: () => state.alpha,
        set: (value: number) => {
          state.alpha = value;
        },
      },
      globalCompositeOperation: {
        get: () => state.composite,
        set: (value: GlobalCompositeOperation) => {
          state.composite = value;
          compositeWrites.push(value);
        },
      },
      imageSmoothingEnabled: {
        get: () => state.smoothing,
        set: (value: boolean) => {
          state.smoothing = value;
        },
      },
    });
    this.context = context as unknown as CanvasRenderingContext2D;
    createdCanvases.push(this);
  }

  getContext(): CanvasRenderingContext2D {
    return this.context;
  }
}

let createdCanvases: BlendingCanvas[] = [];

function blankSource(width: number, height: number): DurableLayerSource {
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
    source: blankSource(pos.width, pos.height),
  });
  return Object.freeze({ snapshot, operations: Object.freeze([...(options.operations ?? [])]) });
}

function replay(layers: Record<string, DurableReplayLayer>): DurableReplayResult {
  return Object.freeze({
    documentId: 'blend-document',
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
    documentId: 'blend-document',
    baselineAssetGeneration: registry.getDocumentGeneration('blend-document'),
    operationSetRevision: 0,
    assetRegistry: registry,
  };
}

function installBlendingCanvas() {
  createdCanvases = [];
  vi.stubGlobal('OffscreenCanvas', BlendingCanvas);
  vi.stubGlobal('createImageBitmap', undefined);
  return createdCanvases;
}

function documentSurface(canvases: readonly BlendingCanvas[] = createdCanvases): BlendingCanvas | undefined {
  return canvases.find((canvas) => canvas.width === frame.width && canvas.height === frame.height);
}

afterEach(() => {
  vi.unstubAllGlobals();
  createdCanvases = [];
});

describe('a materialized layer carries its own compositing parameters', () => {
  it('copies visible, opacity and blendMode off the snapshot it materialized', async () => {
    // The boundary is what a cutover has to honour, and a boundary value that omits the blend
    // mode leaves the consumer with a second, independent lookup into the replay. That lookup is
    // what gets forgotten: the layer still composites, as plain source-over, looking plausible
    // rather than broken.
    installBlendingCanvas();
    const registry = new AssetRegistry();
    try {
      const result = await materializeLayer(
        layer('layer-1', 0, { visible: false, opacity: 0.375, blendMode: 'multiply' }),
        request(registry)
      );

      expect(result.visible).toBe(false);
      expect(result.opacity).toBe(0.375);
      expect(result.blendMode).toBe('multiply');
      result.lease.release();
    } finally {
      registry.shutdown();
    }
  });

  it('reads them from the snapshot rather than from the source it drew', async () => {
    // `blankSource()` pins `source.opacity` to 1. So an alpha of 0.375 on the result cannot have
    // come from the source paint — it came from the layer, which is the whole claim.
    installBlendingCanvas();
    const registry = new AssetRegistry();
    try {
      const result = await materializeLayer(layer('layer-1', 0, { opacity: 0.375 }), request(registry));

      expect(result.opacity).toBe(0.375);
      // The source it drew was painted at alpha 1, so a value other than 1 here is not the paint.
      expect(result.opacity).not.toBe(1);
      result.lease.release();
    } finally {
      registry.shutdown();
    }
  });
});

describe('the compositing boundary', () => {
  it('composites fractional layer bounds without introducing smoothing', async () => {
    const canvases = installBlendingCanvas();
    const registry = new AssetRegistry();
    try {
      const result = await composeDurableDocument(
        replay({ layer: layer('layer', 0, { pos: { x: 0, y: 0, width: 40.5, height: 20 } }) }),
        request(registry)
      );

      expect(documentSurface(canvases)?.smoothingAtDraw).toEqual([false]);
      result.release();
    } finally {
      registry.shutdown();
    }
  });

  it('holds the snapshot blend mode in force for the draw, beside the snapshot opacity', async () => {
    // This is legacy `drawLayer()`'s contract, and the durable boundary has to match it: alpha and
    // the composite operation are set TOGETHER, inside one save/restore pair, on the shared
    // document surface. Sampled at the draw rather than as a write sequence, so it fails both if
    // the mode is never applied and if it is applied and then restored before the image lands.
    const canvases = installBlendingCanvas();
    const registry = new AssetRegistry();
    try {
      const result = await composeDurableDocument(
        replay({
          'bed-multiply': layer('bed-multiply', 0),
          'top-multiply': layer('top-multiply', 1, { opacity: 0.375, blendMode: 'multiply' }),
        }),
        request(registry)
      );

      const composite = documentSurface(canvases);
      expect(composite?.draws).toHaveLength(2);
      // The multiply layer's image reached the surface under `multiply`; the Normal layer above and
      // below it under its own mode. One list, so the second entry also proves the first layer's
      // mode did not outlive it.
      expect(composite?.draws).toEqual([
        { composite: 'source-over', alpha: 1 },
        { composite: 'multiply', alpha: 0.375 },
      ]);
      result.release();
    } finally {
      registry.shutdown();
    }
  });

  it('differs from a normal layer in exactly the composite operation', async () => {
    // "Uses the blend mode" and "blends differently from Normal" are different claims, and only the
    // second one is about pixels. Everything else about the two compositions is held identical —
    // same layers, same order, same opacity, same geometry, same number of draws — so the single
    // differing field is the composite operation and nothing else drifted alongside it.
    const compose = async (blendMode: GlobalCompositeOperation) => {
      const canvases = installBlendingCanvas();
      const registry = new AssetRegistry();
      try {
        const result = await composeDurableDocument(
          replay({
            bed: layer('bed', 0),
            subject: layer('subject', 1, { opacity: 0.375, blendMode }),
          }),
          request(registry)
        );
        result.release();
        return documentSurface(canvases)?.draws ?? [];
      } finally {
        registry.shutdown();
      }
    };

    const multiply = await compose('multiply');
    const normal = await compose('source-over');

    expect(multiply).toHaveLength(2);
    // Same shape, same alpha, same count — the pair differs on the composite operation alone.
    expect(normal).toHaveLength(multiply.length);
    expect(multiply.map((draw) => draw.alpha)).toEqual(normal.map((draw) => draw.alpha));
    expect(multiply).not.toEqual(normal);
    expect(multiply[1]?.composite).toBe('multiply');
    expect(normal[1]?.composite).toBe('source-over');
  });

  it('writes a non-normal mode onto the document surface and onto no other surface it allocates', async () => {
    // The per-layer outputs stay tight, but affine materialization temporarily reuses the document
    // surface as a frame-sized scratch. That pass must remain source-over; the snapshot blend mode
    // is applied only during the final layer composite, after the scratch has been cleared.
    const canvases = installBlendingCanvas();
    const registry = new AssetRegistry();
    try {
      const result = await composeDurableDocument(
        replay({
          bed: layer('bed', 0),
          subject: layer('subject', 1, {
            blendMode: 'multiply',
            operations: [
              Object.freeze({
                kind: 'apply-affine-transform' as const,
                layerId: 'subject',
                transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 }),
              }),
            ],
          }),
        }),
        request(registry)
      );

      const compositingSurface = documentSurface(canvases);
      expect(canvases.filter((canvas) => canvas.compositeWrites.some((write) => write !== 'source-over'))).toEqual([
        compositingSurface,
      ]);
      expect(compositingSurface?.draws.at(-1)).toEqual({ composite: 'multiply', alpha: 1 });
      expect(compositingSurface?.draws.slice(0, -1).every(({ composite }) => composite === 'source-over')).toBe(true);
      expect(canvases.length).toBeGreaterThan(1);
      result.release();
    } finally {
      registry.shutdown();
    }
  });

  it('leaves a hidden layer out of the composite entirely', async () => {
    // The hidden multiply layer carries an affine operation too, so none of its work may reach the
    // document surface as a draw or blend-mode write.
    const canvases = installBlendingCanvas();
    const registry = new AssetRegistry();
    try {
      const result = await composeDurableDocument(
        replay({
          'hidden-multiply': layer('hidden-multiply', 0, {
            visible: false,
            blendMode: 'multiply',
            operations: [
              Object.freeze({
                kind: 'apply-affine-transform' as const,
                layerId: 'hidden-multiply',
                transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 }),
              }),
            ],
          }),
          normal: layer('normal', 1),
        }),
        request(registry)
      );

      const composite = documentSurface(canvases);
      expect(composite?.draws).toEqual([{ composite: 'source-over', alpha: 1 }]);
      expect(composite?.compositeWrites).not.toContain('multiply');
      result.release();
    } finally {
      registry.shutdown();
    }
  });
});
