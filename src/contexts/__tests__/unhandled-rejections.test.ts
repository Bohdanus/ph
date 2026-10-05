/**
 * HANDOFF §28 / §17: the repo had ZERO tests asserting an unhandled promise
 * rejection, which is exactly why `SaveDialog.tsx:18-25` (a `try/finally` with
 * no `catch`) is untestable. These suites pin both halves of the contract for
 * every async asset/store path in `src/contexts`:
 *
 *  1. a fire-and-forget call DOES reject into the void, with a named reason, and
 *  2. a caller that awaits observes the SAME failure through the returned
 *     promise instead, so the failure is never reported twice.
 *
 * Nothing here asserts that a rejection is acceptable; it asserts that a
 * rejection is *visible* to a test. Production code is not modified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `saveImageToDisk` lazily imports the TIFF encoder, so mocking that module is
// enough to reach the `Unsupported image format` throw at line 179 without
// replacing the module under test.
const { encodeTiff } = vi.hoisted(() => ({ encodeTiff: vi.fn() }));
vi.mock('../tiff-utils.ts', () => ({ encodeTiff }));

import { AssetRegistry } from '../asset-registry.ts';
import { documentFrameSize } from '../document-frame.ts';
import { materializeDocument } from '../materialization.ts';
import type { DurableReplayLayer, DurableReplayResult } from '../durable-replay.ts';
import type { DurableLayerSnapshot } from '../history-model.ts';
import { saveImage } from '../saveToFile.ts';

function fakeBitmap(width = 8, height = 8) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

type RejectionHook = {
  listeners(event: 'unhandledRejection'): Array<(...args: never[]) => void>;
  removeAllListeners(event: 'unhandledRejection'): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  removeListener(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
};

/**
 * The app tsconfig intentionally ships without `@types/node` (HANDOFF §27), so
 * the Node-level rejection hook is reached through `globalThis` with a local
 * structural type rather than a bare `any` or a `process` ambient declaration.
 */
const rejectionHook = (globalThis as Record<string, unknown>).process as RejectionHook;

/** A canvas whose `toBlob` outcome is scripted by the test. */
function canvasStub(blob: Blob | null) {
  return {
    width: 8,
    height: 8,
    getContext: vi.fn(() => ({})),
    toBlob: vi.fn((callback: (value: Blob | null) => void) => {
      callback(blob);
    }),
  } as unknown as HTMLCanvasElement;
}

describe('unhandled rejection visibility', () => {
  let rejections: unknown[];
  /**
   * Node emits `unhandledRejection` on `process`, not on `window`, and Vitest
   * installs its own listener that turns any such event into a file-level
   * error. The suites below are deliberately provoking those events, so the
   * runner's listeners are lifted for the duration of each test and restored
   * afterwards. Having *no* listener at all is never the case: `onNodeRejection`
   * is always installed, which is also what keeps Node from crashing.
   */
  let runnerListeners: Array<(...args: never[]) => void>;
  let onNodeRejection: (reason: unknown) => void;

  beforeEach(() => {
    rejections = [];
    runnerListeners = rejectionHook.listeners('unhandledRejection');
    rejectionHook.removeAllListeners('unhandledRejection');
    onNodeRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    rejectionHook.on('unhandledRejection', onNodeRejection);
  });

  afterEach(() => {
    rejectionHook.removeListener('unhandledRejection', onNodeRejection);
    for (const listener of runnerListeners) {
      rejectionHook.on('unhandledRejection', listener as (reason: unknown) => void);
    }
    vi.clearAllMocks();
  });

  /**
   * Resolves on the FIRST real `unhandledRejection` this suite observes.
   *
   * A fixed drain of `setTimeout(0)` cannot be the thing that decides a
   * positive case: Node reports an unhandled rejection at the microtask
   * checkpoint of the rejecting turn, and `saveImage` performs two further
   * async hops before it can reject (the dynamic `import('./tiff-utils.ts')`
   * and the encoder call), so how many turns the signal needs depends on the
   * call path rather than on a constant. A count that is too short does not
   * pass quietly — `toHaveLength(1)` reads the empty array and fails — which is
   * a red that only appears under load, i.e. a flake rather than a defect.
   *
   * Waiting on the signal removes the guess entirely: however many hops the
   * chain needs, the event arrives, and a chain that never rejects parks here
   * until the per-test timeout, which is a visible failure rather than a pass.
   */
  const nextRejection = () =>
    new Promise<unknown>((resolve) => {
      const listener = (reason: unknown) => resolve(reason);
      rejectionHook.on('unhandledRejection', listener);
      // The suite's own `beforeEach` listener pushes into `rejections` first —
      // it was registered earlier — so the array is already filled by the time
      // this continuation runs, and the assertions below need no extra await.
    });

  /**
   * The negative half: prove nothing reaches the void. There is no signal to
   * wait for when the expected outcome is silence, so this is a bounded wait
   * and the bound is stated rather than assumed. Every caller has already
   * AWAITED the promise under test and attached a handler, so the rejection is
   * already handled; what remains is Node's reporting checkpoint, which runs at
   * the end of the microtask drain of the next turn. One macrotask boundary is
   * therefore the whole requirement, and a second is kept only so the wait
   * cannot end inside the same checkpoint.
   */
  const settleVoid = async () => {
    for (let turn = 0; turn < 2; turn += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  };

  describe('saveToFile disk-write rejection (src/contexts/saveToFile.ts:13)', () => {
    it('rejects into the void with the writer error when the caller drops the promise', async () => {
      void saveImage(canvasStub(null), 'drawing.png');

      await nextRejection();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/Failed to create blob from canvas/);
    });

    it('reports the identical failure through the returned promise when the caller awaits', async () => {
      await expect(saveImage(canvasStub(null), 'drawing.png')).rejects.toThrow(/Failed to create blob from canvas/);

      await settleVoid();
      // Awaiting is the documented channel: nothing must ALSO reach the void.
      expect(rejections).toHaveLength(0);
    });

    it('never resolves to true when the disk write fails', async () => {
      const settled = saveImage(canvasStub(null), 'drawing.png').then(
        () => 'resolved',
        () => 'rejected'
      );

      await expect(settled).resolves.toBe('rejected');
    });
  });

  describe('image-load-save-utils encoder failure (src/contexts/image-load-save-utils.ts:179)', () => {
    it('rejects into the void when a non-canvas encoder yields no blob', async () => {
      // The TIFF encoder resolves undefined, so the `switch` leaves `blob`
      // unset and line 179 raises `Unsupported image format`.
      encodeTiff.mockResolvedValue(undefined);

      void saveImage(canvasStub(null), 'drawing', 'image/tiff');

      await nextRejection();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/Unsupported image format/);
    });

    it('surfaces the same encoder failure through the awaited promise', async () => {
      encodeTiff.mockResolvedValue(undefined);

      await expect(saveImage(canvasStub(null), 'drawing', 'image/tiff')).rejects.toThrow(/Unsupported image format/);

      await settleVoid();
      expect(rejections).toHaveLength(0);
    });

    it('gets past the encoder check when the encoder does produce a blob', async () => {
      encodeTiff.mockResolvedValue(new Blob(['tiff'], { type: 'image/tiff' }));
      const canvas = canvasStub(new Blob(['png']));
      // The blob is real, so control passes the `if (!blob) throw` guard in
      // `saveImageToDisk` and reaches `downloadBlob`. The host is what cannot
      // finish the download: the runner's jsdom `URL.createObjectURL` shim throws
      // a `TypeError` on a Blob from this realm, and nothing about that message
      // is a contract worth asserting. Stubbing the primitive makes the download
      // step complete, so this asserts the encoder's blob actually ARRIVES
      // instead of only that it did not trip the guard.
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe-url');
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      try {
        await expect(saveImage(canvas, 'drawing', 'image/tiff')).resolves.toBe(true);
        // The positive half of "gets past the check": the canvas is the source,
        // so a blob the encoder never saw cannot be the one that was downloaded.
        // Asserted inside the try because `mockRestore` discards the call record.
        expect(encodeTiff).toHaveBeenCalledWith(canvas);
        expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      } finally {
        createObjectURL.mockRestore();
        revokeObjectURL.mockRestore();
      }

      await settleVoid();
      expect(rejections).toHaveLength(0);
    });

    it('rejects into the void with the encoder error when the encoder itself throws', async () => {
      encodeTiff.mockRejectedValue(new Error('TIFF encoder exploded'));

      void saveImage(canvasStub(null), 'drawing', 'image/tiff');

      await nextRejection();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/TIFF encoder exploded/);
    });
  });

  describe('asset-registry abort paths (src/contexts/asset-registry.ts:268,312)', () => {
    it('rejects into the void when asset resolution is given an already-aborted signal', async () => {
      const registry = new AssetRegistry();
      const assetId = registry.registerBaseline('document-a', fakeBitmap(), { ownership: 'adopt' });
      const controller = new AbortController();
      controller.abort();

      void registry.resolve(assetId, controller.signal);

      await nextRejection();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/Asset resolution aborted/);

      registry.shutdown();
    });

    it('rejects into the void when an in-flight materialization outlives its document', async () => {
      const registry = new AssetRegistry();
      registry.registerBaseline('document-a', fakeBitmap(), { ownership: 'adopt' });

      let release!: (value: ImageBitmap) => void;
      // Deliberately not awaited and not `.catch`-ed: the promise is dropped
      // exactly the way a fire-and-forget `void materialize(...)` would be.
      void registry.materialize({
        key: 'inflight',
        documentId: 'document-a',
        producer: () =>
          new Promise<ImageBitmap>((resolve) => {
            release = resolve;
          }),
        byteSize: 4,
      });

      // The document is replaced while the producer is still pending; when the
      // producer finally resumes, the generation guard at
      // `asset-registry.ts:328` rejects the pending materialization.
      registry.disposeDocument('document-a');
      release(fakeBitmap());

      await nextRejection();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/invalidated by document disposal/);

      registry.shutdown();
    });

    it('reports the in-flight invalidation through the awaited promise and never through the void', async () => {
      const registry = new AssetRegistry();
      registry.registerBaseline('document-a', fakeBitmap(), { ownership: 'adopt' });

      let release!: (value: ImageBitmap) => void;
      const settled = expect(
        registry.materialize({
          key: 'inflight-awaited',
          documentId: 'document-a',
          producer: () =>
            new Promise<ImageBitmap>((resolve) => {
              release = resolve;
            }),
          byteSize: 4,
        })
      ).rejects.toThrow(/invalidated by document disposal/);

      registry.disposeDocument('document-a');
      release(fakeBitmap());
      await settled;

      await settleVoid();
      expect(rejections).toHaveLength(0);

      registry.shutdown();
    });

    it('reports the abort through the awaited promise and never through the void', async () => {
      const registry = new AssetRegistry();
      const assetId = registry.registerBaseline('document-a', fakeBitmap(), { ownership: 'adopt' });
      const controller = new AbortController();
      controller.abort();

      await expect(registry.resolve(assetId, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

      await settleVoid();
      expect(rejections).toHaveLength(0);

      registry.shutdown();
    });

    it('suppresses the void rejection when a handler is attached before the reporting checkpoint', async () => {
      const registry = new AssetRegistry();
      const assetId = registry.registerBaseline('document-a', fakeBitmap(), { ownership: 'adopt' });
      const controller = new AbortController();
      controller.abort();

      const handled = registry.resolve(assetId, controller.signal).catch((error: unknown) => error);

      expect(await handled).toMatchObject({ name: 'AbortError' });
      await settleVoid();
      expect(rejections).toHaveLength(0);

      registry.shutdown();
    });
  });

  /**
   * The store-side half the suites above leave out. Every rejection tested so far is
   * reached through `AssetRegistry` or a file writer, so a caller reading this file
   * could conclude the void is covered — but `materializeDocument` is the one store
   * path that walks the WHOLE document and can reject on a layer the registry never
   * sees, and it was untested here.
   *
   * The rejection is scripted with an already-aborted signal because that is the one
   * abort `materializeDocument` checks before it touches a layer: `request.signal?.aborted`
   * throws `AbortError` at the top of the loop, so the outcome does not depend on which
   * of the three `try` arms swallows what, and the assertion is about VISIBILITY rather
   * than about which layer failed.
   */
  describe('materializeDocument document walk', () => {
    const snapshot: DurableLayerSnapshot = {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      locked: false,
      pos: { x: 0, y: 0, width: 8, height: 8 },
      source: {
        kind: 'blank',
        color: '#ffffff',
        opacity: 1,
        isBedrock: false,
        pos: { x: 0, y: 0, width: 8, height: 8 },
      },
      operations: [],
    } as unknown as DurableLayerSnapshot;

    const layer: DurableReplayLayer = { snapshot, operations: [] };

    const replay: DurableReplayResult = {
      documentId: 'document-a',
      documentRevision: 1,
      branchRevision: 0,
      durableRevision: 0,
      cursor: 0,
      frame: { x: 0, y: 0, width: 8, height: 8 },
      // Read through `documentFrameSize` rather than written as a literal, because the
      // whole point of the field is that it is derived by the shared rule: a literal here
      // would pass whether or not the rule still produced this size.
      totalSize: documentFrameSize({ x: 0, y: 0, width: 8, height: 8 }),
      layers: { 'layer-1': layer },
      selections: { selections: {}, activeSelectionId: null },
    } as unknown as DurableReplayResult;

    function request(signal?: AbortSignal) {
      const assetRegistry = new AssetRegistry();
      assetRegistry.registerBaseline('document-a', fakeBitmap(), { ownership: 'adopt' });
      return {
        assetRegistry,
        payload: {
          documentId: 'document-a',
          baselineAssetGeneration: 0,
          operationSetRevision: 0,
          frame: { x: 0, y: 0, width: 8, height: 8 },
          assetRegistry,
          ...(signal ? { signal } : {}),
        },
      };
    }

    it('rejects into the void when the document walk is given an already-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      const { assetRegistry, payload } = request(controller.signal);

      void materializeDocument(replay, payload);

      await nextRejection();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/Materialization aborted/);

      assetRegistry.shutdown();
    });

    it('reports the same abort through the awaited promise and never through the void', async () => {
      const controller = new AbortController();
      controller.abort();
      const { assetRegistry, payload } = request(controller.signal);

      const handled = materializeDocument(replay, payload).catch((error: unknown) => error);

      expect(await handled).toMatchObject({ name: 'AbortError' });
      await settleVoid();
      expect(rejections).toHaveLength(0);

      assetRegistry.shutdown();
    });

    it('is not vacuous: the same request without the abort does not reject at all', async () => {
      // The two tests above would both stay green if `materializeDocument` rejected
      // unconditionally for any input, so the negative arm is what makes the abort
      // signal load-bearing rather than incidental.
      const { assetRegistry, payload } = request();

      await expect(materializeDocument(replay, payload)).resolves.toBeDefined();
      await settleVoid();
      expect(rejections).toHaveLength(0);

      assetRegistry.shutdown();
    });
  });
});
