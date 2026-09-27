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
   * Node reports an unhandled rejection at the microtask checkpoint after the
   * rejecting tick, so one macrotask boundary is not enough; drain several
   * deterministically instead of polling with a timeout.
   */
  const drain = async () => {
    for (let tick = 0; tick < 4; tick += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  };

  describe('saveToFile disk-write rejection (src/contexts/saveToFile.ts:13)', () => {
    it('rejects into the void with the writer error when the caller drops the promise', async () => {
      void saveImage(canvasStub(null), 'drawing.png');

      await drain();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/Failed to create blob from canvas/);
    });

    it('reports the identical failure through the returned promise when the caller awaits', async () => {
      await expect(saveImage(canvasStub(null), 'drawing.png')).rejects.toThrow(/Failed to create blob from canvas/);

      await drain();
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

      await drain();
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0])).toMatch(/Unsupported image format/);
    });

    it('surfaces the same encoder failure through the awaited promise', async () => {
      encodeTiff.mockResolvedValue(undefined);

      await expect(saveImage(canvasStub(null), 'drawing', 'image/tiff')).rejects.toThrow(/Unsupported image format/);

      await drain();
      expect(rejections).toHaveLength(0);
    });

    it('gets past the encoder check when the encoder does produce a blob', async () => {
      encodeTiff.mockResolvedValue(new Blob(['tiff'], { type: 'image/tiff' }));

      // The blob reaches `downloadBlob`, which needs `URL.createObjectURL` and a
      // user-gesture anchor; jsdom has neither, so the failure surfaces from the
      // download step instead of from the `Unsupported image format` guard.
      await expect(saveImage(canvasStub(new Blob(['png'])), 'drawing', 'image/tiff')).rejects.not.toThrow(
        /Unsupported image format/
      );

      await drain();
    });

    it('rejects into the void with the encoder error when the encoder itself throws', async () => {
      encodeTiff.mockRejectedValue(new Error('TIFF encoder exploded'));

      void saveImage(canvasStub(null), 'drawing', 'image/tiff');

      await drain();
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

      await drain();
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

      await drain();
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

      await drain();
      expect(rejections).toHaveLength(0);

      registry.shutdown();
    });

    it('reports the abort through the awaited promise and never through the void', async () => {
      const registry = new AssetRegistry();
      const assetId = registry.registerBaseline('document-a', fakeBitmap(), { ownership: 'adopt' });
      const controller = new AbortController();
      controller.abort();

      await expect(registry.resolve(assetId, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

      await drain();
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
      await drain();
      expect(rejections).toHaveLength(0);

      registry.shutdown();
    });
  });
});
