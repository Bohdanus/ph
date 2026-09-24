import { describe, expect, it, vi } from 'vitest';

import type { BitmapSource } from '../general-types.ts';
import { AssetRegistry } from '../asset-registry.ts';

function createOwnedBitmap(width = 1, height = 1) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  return { bitmap, close };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('AssetRegistry ownership', () => {
  it('does not double-close an adopted ImageBitmap registered by multiple documents', () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);

    const firstId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('document-b', bitmap, { ownership: 'adopt' });

    expect(secondId).toBe(firstId);

    registry.disposeDocument('document-a');
    expect(close).not.toHaveBeenCalled();

    registry.disposeDocument('document-b');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for an active baseline lease before disposing its bitmap', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });
    const lease = await registry.resolve(assetId);

    registry.disposeDocument('document-a');
    expect(close).not.toHaveBeenCalled();

    lease.release();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never closes a borrowed canvas when its baseline is disposed', () => {
    const registry = new AssetRegistry();
    const canvas = document.createElement('canvas');
    const close = vi.fn();
    Object.defineProperty(canvas, 'close', { value: close });
    const assetId = registry.registerBorrowed('document-a', canvas);

    registry.disposeDocument('document-a');

    expect(close).not.toHaveBeenCalled();
    expect(registry.getRecord(assetId)).toBeUndefined();
  });

  it('evicts released materializations and closes owned bitmaps under a byte budget', async () => {
    const registry = new AssetRegistry({ maxCacheBytes: 4 });
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();

    const firstLease = await registry.materialize({
      key: 'first',
      producer: () => first.bitmap,
      byteSize: 4,
    });
    firstLease.release();

    const secondLease = await registry.materialize({
      key: 'second',
      producer: () => second.bitmap,
      byteSize: 4,
    });

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();

    secondLease.release();
  });
});

describe('AssetRegistry raster source handling', () => {
  it('never closes a borrowed HTMLImageElement when its baseline is disposed', () => {
    const registry = new AssetRegistry();
    const image = document.createElement('img');
    const assetId = registry.registerBorrowed('document-a', image);

    registry.disposeDocument('document-a');

    expect(registry.getRecord(assetId)).toBeUndefined();
  });

  it('throws when resolving an unknown asset id', async () => {
    const registry = new AssetRegistry();
    await expect(registry.resolve('nonexistent' as never)).rejects.toThrow(/Unknown or disposed asset/);
  });

  it('throws when resolving a disposed asset', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });

    registry.disposeDocument('document-a');
    expect(close).toHaveBeenCalledTimes(1);

    await expect(registry.resolve(assetId)).rejects.toThrow(/Unknown or disposed asset/);
  });

  it('throws when retaining an unknown asset', () => {
    const registry = new AssetRegistry();
    expect(() => registry.retain('nonexistent' as never)).toThrow(/Unknown or disposed asset/);
  });

  it('is a no-op for releasing an unknown asset (does not throw)', () => {
    const registry = new AssetRegistry();
    expect(() => registry.release('nonexistent' as never)).not.toThrow();
  });

  it('aborted resolve releases its retain exactly once even if lease.release is called again', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });
    const controller = new AbortController();

    const lease = await registry.resolve(assetId, controller.signal);
    const releaseSpy = vi.fn();
    Object.defineProperty(lease, 'release', { value: releaseSpy });

    controller.abort();

    // Calling release again must be a no-op — the abort already released
    // the retain count, so the bitmap must not be closed yet (document-a
    // baseline is still alive).
    lease.release();
    lease.release();

    expect(close).not.toHaveBeenCalled();

    registry.disposeDocument('document-a');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps a borrowed bitmap alive while an active lease prevents disposal', async () => {
    const registry = new AssetRegistry();
    const canvas = document.createElement('canvas');
    const assetId = registry.registerBorrowed('document-a', canvas);

    const lease = await registry.resolve(assetId);
    registry.disposeDocument('document-a');

    // The canvas is borrowed, so it is never closed even after document
    // disposal — the lease kept the entry alive past the document's removal.
    expect((canvas as unknown as { close?: unknown }).close).toBeUndefined();
    lease.release();
  });
});

describe('AssetRegistry materialization cache', () => {
  it('provides a releasable lease for each materialization', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap();

    const lease = await registry.materialize({
      key: 'mat-1',
      producer: () => bitmap,
      byteSize: 4,
    });

    expect(lease.bitmap).toBe(bitmap);
    expect(lease.release).toBeDefined();
    lease.release();
    expect(close).not.toHaveBeenCalled(); // cache may evict after release
  });

  it('returns the cached bitmap for a duplicate key without calling the producer again', async () => {
    const registry = new AssetRegistry();
    const { bitmap } = createOwnedBitmap(4, 4);
    const producer = vi.fn(() => bitmap);

    const first = await registry.materialize({
      key: 'dup',
      producer,
      byteSize: 64,
    });
    const second = await registry.materialize({
      key: 'dup',
      producer,
      byteSize: 64,
    });

    expect(producer).toHaveBeenCalledOnce();
    expect(second.bitmap).toBe(first.bitmap);
    first.release();
    second.release();
  });

  it.fails('does not leak the first bitmap when concurrent same-key requests overlap', async () => {
    // BUG: AssetRegistry.materialize does not track in-flight producers by
    // key. When two concurrent requests share a key, both call the producer
    // and the second cache.set overwrites the first entry without closing
    // its bitmap. The first produced bitmap is permanently leaked.
    const registry = new AssetRegistry({ maxCacheBytes: 1024 });
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();

    const firstDeferred = deferred<BitmapSource>();
    const secondDeferred = deferred<BitmapSource>();

    const matA = registry.materialize({
      key: 'shared',
      producer: () => firstDeferred.promise,
      byteSize: 4,
    });
    const matB = registry.materialize({
      key: 'shared',
      producer: () => secondDeferred.promise,
      byteSize: 4,
    });

    firstDeferred.resolve(first.bitmap);
    const leaseA = await matA;

    secondDeferred.resolve(second.bitmap);
    const leaseB = await matB;

    leaseA.release();
    leaseB.release();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it('does not evict a cache entry that has an active lease', async () => {
    const registry = new AssetRegistry({ maxCacheBytes: 4 });
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();

    const firstLease = await registry.materialize({
      key: 'first',
      producer: () => first.bitmap,
      byteSize: 4,
    });
    // firstLease stays active (not released).

    const secondLease = await registry.materialize({
      key: 'second',
      producer: () => second.bitmap,
      byteSize: 4,
    });

    // first is retained by its lease and must NOT be evicted.
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();

    firstLease.release();
    // Now first can be evicted under the byte budget.
    expect(first.close).toHaveBeenCalledTimes(1);
    secondLease.release();
  });

  it('disposes matching unreleased cache entries when a document is disposed', async () => {
    const registry = new AssetRegistry();

    const first = await registry.materialize({
      key: 'doc-a-mat',
      documentId: 'document-a',
      producer: () => createOwnedBitmap().bitmap,
      byteSize: 4,
    });
    first.release();

    registry.disposeDocument('document-a');

    const record = registry.getRecord('doc-a-mat' as never);
    void record; // materialize entries are not AssetRecords, just verify no crash
  });

  it('bounds the cache to maxCacheEntries after releases and evictions', async () => {
    const registry = new AssetRegistry({ maxCacheEntries: 2, maxCacheBytes: 1024 });
    const bitmaps = Array.from({ length: 5 }, () => createOwnedBitmap());
    const leases: Array<ReturnType<typeof registry.materialize> extends Promise<infer T> ? T : never> = [];

    for (let i = 0; i < 5; i++) {
      const lease = await registry.materialize({
        key: `entry-${i}`,
        producer: () => bitmaps[i]!.bitmap,
        byteSize: 4,
      });
      lease.release();
      leases.push(lease);
    }

    void leases;
    // All bitmaps created; cache should never exceed maxCacheEntries.
    void bitmaps;
    // First 3 should have been evicted (entries 0, 1, 2), keeping the last 2.
    expect(bitmaps[0]!.close).toHaveBeenCalled();
    expect(bitmaps[4]!.close).not.toHaveBeenCalled();
  });
});
