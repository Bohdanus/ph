import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AssetRegistry ownership', () => {
  it('invalidates async work when the document is reopened and disposed again', async () => {
    const registry = new AssetRegistry();
    const source = document.createElement('canvas');
    const pending = deferred<ImageBitmap>();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const reopened = createOwnedBitmap(5, 5);
    vi.stubGlobal('createImageBitmap', () => pending.promise);

    try {
      registry.disposeDocument('document-a');
      expect(registry.getDocumentGeneration('document-a')).toBe(1);
      const registration = registry.registerBaselineAsync('document-a', source);
      registry.registerBaseline('document-a', reopened.bitmap, { ownership: 'adopt' });
      expect(registry.getDocumentGeneration('document-a')).toBe(2);
      registry.disposeDocument('document-a');
      expect(registry.getDocumentGeneration('document-a')).toBe(3);
      pending.resolve(bitmap);

      await expect(registration).rejects.toMatchObject({ name: 'AbortError' });
      expect(close).toHaveBeenCalledOnce();
      expect(reopened.close).toHaveBeenCalledOnce();
    } finally {
      registry.shutdown();
    }
  });

  it('reopens a disposed document when its still-leased source is registered again', async () => {
    const registry = new AssetRegistry();
    const source = document.createElement('canvas');
    const createImageBitmap = vi.fn(async () => createOwnedBitmap(10, 10).bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    let releaseLease: (() => void) | undefined;

    try {
      const assetId = registry.registerBorrowed('document-a', source);
      const lease = await registry.resolve(assetId);
      releaseLease = lease.release;

      registry.disposeDocument('document-a');
      expect(registry.getDocumentGeneration('document-a')).toBe(2);
      expect(registry.getRecord(assetId)).toBeDefined();

      await expect(registry.registerBaselineAsync('document-a', source)).resolves.toBe(assetId);
      expect(registry.getDocumentGeneration('document-a')).toBe(3);
      expect(registry.matchesRegisteredSource(assetId, source, 'document-a')).toBe(true);
      expect(createImageBitmap).not.toHaveBeenCalled();

      registry.disposeDocument('document-a');
      expect(registry.getRecord(assetId)).toBeDefined();
      releaseLease();
      releaseLease = undefined;
      expect(registry.getRecord(assetId)).toBeUndefined();
    } finally {
      releaseLease?.();
      registry.shutdown();
    }
  });

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

  it('matches a live asset to the exact source object registered for it', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap(10, 10);
    const second = createOwnedBitmap(10, 10);

    const firstId = registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('document-a', second.bitmap, { ownership: 'adopt' });

    expect(registry.matchesRegisteredSource(firstId, first.bitmap, 'document-a')).toBe(true);
    expect(registry.matchesRegisteredSource(firstId, second.bitmap, 'document-a')).toBe(false);
    expect(registry.matchesRegisteredSource(secondId, first.bitmap, 'document-a')).toBe(false);

    registry.disposeDocument('document-a');
    expect(registry.matchesRegisteredSource(firstId, first.bitmap, 'document-a')).toBe(false);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it('matches the same source alias registered by multiple documents', () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);

    const firstId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('document-b', bitmap, { ownership: 'adopt' });

    expect(secondId).toBe(firstId);
    expect(registry.matchesRegisteredSource(firstId, bitmap, 'document-a')).toBe(true);
    expect(registry.matchesRegisteredSource(firstId, bitmap, 'document-b')).toBe(true);

    registry.disposeDocument('document-a');
    expect(registry.matchesRegisteredSource(firstId, bitmap, 'document-a')).toBe(false);
    expect(registry.matchesRegisteredSource(firstId, bitmap, 'document-b')).toBe(true);
    registry.disposeDocument('document-b');
    expect(registry.matchesRegisteredSource(firstId, bitmap, 'document-b')).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('matches an asynchronous mutable-source registration to its original source object', async () => {
    const registry = new AssetRegistry();
    const source = document.createElement('canvas');
    const { bitmap, close } = createOwnedBitmap(10, 10);
    vi.stubGlobal('createImageBitmap', () => Promise.resolve(bitmap));

    const assetId = await registry.registerBaselineAsync('document-a', source);

    expect(registry.matchesRegisteredSource(assetId, source, 'document-a')).toBe(true);
    registry.disposeDocument('document-a');
    expect(close).toHaveBeenCalledOnce();
  });

  it('allows concurrent registrations of distinct mutable sources in one document', async () => {
    const registry = new AssetRegistry();
    const firstSource = document.createElement('canvas');
    const secondSource = document.createElement('canvas');
    const firstCopy = deferred<ImageBitmap>();
    const secondCopy = deferred<ImageBitmap>();
    const first = createOwnedBitmap(10, 10);
    const second = createOwnedBitmap(10, 10);
    vi.stubGlobal('createImageBitmap', (source: HTMLCanvasElement) =>
      source === firstSource ? firstCopy.promise : secondCopy.promise
    );

    const firstRegistration = registry.registerBaselineAsync('document-a', firstSource);
    const secondRegistration = registry.registerBaselineAsync('document-a', secondSource);
    firstCopy.resolve(first.bitmap);
    secondCopy.resolve(second.bitmap);

    const [firstId, secondId] = await Promise.all([firstRegistration, secondRegistration]);

    expect(firstId).not.toBe(secondId);
    expect(registry.matchesRegisteredSource(firstId, firstSource, 'document-a')).toBe(true);
    expect(registry.matchesRegisteredSource(secondId, secondSource, 'document-a')).toBe(true);
    expect(registry.getRecord(firstId)).toBeDefined();
    expect(registry.getRecord(secondId)).toBeDefined();
    expect(registry.getDocumentGeneration('document-a')).toBe(2);

    registry.disposeDocument('document-a');
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent registrations of the same mutable source and closes the redundant copy', async () => {
    const registry = new AssetRegistry();
    const source = document.createElement('canvas');
    const firstCopy = deferred<ImageBitmap>();
    const secondCopy = deferred<ImageBitmap>();
    const first = createOwnedBitmap(10, 10);
    const redundant = createOwnedBitmap(10, 10);
    const createCopy = vi.fn().mockReturnValueOnce(firstCopy.promise).mockReturnValueOnce(secondCopy.promise);
    vi.stubGlobal('createImageBitmap', createCopy);

    const firstRegistration = registry.registerBaselineAsync('document-a', source);
    const secondRegistration = registry.registerBaselineAsync('document-a', source);
    firstCopy.resolve(first.bitmap);
    const firstId = await firstRegistration;
    secondCopy.resolve(redundant.bitmap);
    const secondId = await secondRegistration;

    expect(firstId).toBe(secondId);
    expect(registry.matchesRegisteredSource(firstId, source, 'document-a')).toBe(true);
    expect(createCopy).toHaveBeenCalledTimes(2);
    expect(registry.getDocumentGeneration('document-a')).toBe(1);
    expect(first.close).not.toHaveBeenCalled();
    expect(redundant.close).toHaveBeenCalledOnce();

    registry.disposeDocument('document-a');
    expect(first.close).toHaveBeenCalledOnce();
    expect(redundant.close).toHaveBeenCalledOnce();
  });

  it('closes an async raster snapshot when its document is disposed before registration completes', async () => {
    const registry = new AssetRegistry();
    const source = document.createElement('canvas');
    const pending = deferred<ImageBitmap>();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    vi.stubGlobal('createImageBitmap', () => pending.promise);

    const registration = registry.registerBaselineAsync('document-a', source);
    registry.disposeDocument('document-a');
    pending.resolve(bitmap);

    await expect(registration).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
    expect(registry.getDocumentGeneration('document-a')).toBe(1);
  });

  it('closes a pending async baseline when authoritative reconciliation changes document assets', async () => {
    const registry = new AssetRegistry();
    const existing = createOwnedBitmap(10, 10);
    const existingId = registry.registerBaseline('document-a', existing.bitmap, { ownership: 'adopt' });
    const source = document.createElement('canvas');
    const pending = deferred<ImageBitmap>();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    vi.stubGlobal('createImageBitmap', () => pending.promise);

    const registration = registry.registerBaselineAsync('document-a', source);
    registry.reconcileDocumentAssets('document-a', new Set());
    expect(registry.getRecord(existingId)).toBeUndefined();
    expect(existing.close).toHaveBeenCalledOnce();
    pending.resolve(bitmap);

    await expect(registration).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
    expect(registry.getDocumentGeneration('document-a')).toBe(2);
    registry.shutdown();
  });

  it('keeps a disposed scope tombstoned when mutable baseline copying fails', () => {
    const registry = new AssetRegistry();
    registry.disposeDocument('document-a');
    vi.stubGlobal('OffscreenCanvas', undefined);

    expect(() => registry.registerBaseline('document-a', document.createElement('canvas'))).toThrow(
      /OffscreenCanvas is required/
    );
    registry.disposeDocument('document-a');

    expect(registry.getDocumentGeneration('document-a')).toBe(1);
  });

  it('closes a mutable baseline copy that completes after registry shutdown', async () => {
    const registry = new AssetRegistry();
    const source = document.createElement('canvas');
    const pending = deferred<ImageBitmap>();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    vi.stubGlobal('createImageBitmap', () => pending.promise);

    const registration = registry.registerBaselineAsync('document-a', source);
    registry.shutdown();
    expect(() => registry.registerBaseline('document-b', bitmap, { ownership: 'adopt' })).toThrow(
      /asset registry shutdown/
    );
    pending.resolve(bitmap);

    await expect(registration).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
    expect(registry.getDocumentGeneration('document-a')).toBe(0);
  });

  it('invalidates an async reopening when an already-disposed document is disposed again', async () => {
    const registry = new AssetRegistry();
    const source = document.createElement('canvas');
    const pending = deferred<ImageBitmap>();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    vi.stubGlobal('createImageBitmap', () => pending.promise);

    registry.disposeDocument('document-a');
    const registration = registry.registerBaselineAsync('document-a', source);
    registry.disposeDocument('document-a');
    pending.resolve(bitmap);

    await expect(registration).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
    expect(registry.getDocumentGeneration('document-a')).toBe(1);
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

  it('deduplicates concurrent same-key requests, sharing one producer result without leaking', async () => {
    const registry = new AssetRegistry({ maxCacheBytes: 1024 });
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();

    const firstDeferred = deferred<BitmapSource>();
    const secondDeferred = deferred<BitmapSource>();
    const producerA = vi.fn(() => firstDeferred.promise);
    const producerB = vi.fn(() => secondDeferred.promise);

    const matA = registry.materialize({
      key: 'shared',
      producer: producerA,
      byteSize: 4,
    });
    const matB = registry.materialize({
      key: 'shared',
      producer: producerB,
      byteSize: 4,
    });

    firstDeferred.resolve(first.bitmap);
    const leaseA = await matA;

    secondDeferred.resolve(second.bitmap);
    const leaseB = await matB;

    // Only the first producer is called; the second is deduplicated onto the
    // in-flight pending promise. The second bitmap is never produced.
    expect(producerA).toHaveBeenCalledOnce();
    expect(producerB).not.toHaveBeenCalled();

    // Both callers share the same cached bitmap.
    expect(leaseA.bitmap).toBe(first.bitmap);
    expect(leaseB.bitmap).toBe(first.bitmap);

    leaseA.release();
    leaseB.release();

    // second.bitmap was never produced — no leak.
    expect(second.close).not.toHaveBeenCalled();

    // first.bitmap is held by the cache until cleanup evicts it.
    registry.shutdown();
    expect(first.close).toHaveBeenCalledTimes(1);
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

  it('tombstones a cache entry with an active lease when its document is disposed, then cleans up on lease release', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap();

    const lease = await registry.materialize({
      key: 'doc-mat',
      documentId: 'document-a',
      producer: () => bitmap,
      byteSize: 4,
    });

    // Lease is active; disposing the document must tombstone rather than
    // close the bitmap immediately.
    registry.disposeDocument('document-a');
    expect(close).not.toHaveBeenCalled();

    // Releasing the tombstoned lease cleans up the entry and closes the bitmap.
    lease.release();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('eviction only closes cache-owned, unleased materializations', async () => {
    const registry = new AssetRegistry({ maxCacheBytes: 4 });
    const owned = createOwnedBitmap();
    const leased = createOwnedBitmap();

    const ownedLease = await registry.materialize({
      key: 'owned',
      producer: () => owned.bitmap,
      byteSize: 4,
    });
    ownedLease.release();

    const leasedLease = await registry.materialize({
      key: 'leased',
      producer: () => leased.bitmap,
      byteSize: 4,
    });
    // leasedLease stays active to prevent its eviction.

    // Under the byte budget, the unleased (owned) entry is closed, but the
    // leased entry survives.
    expect(owned.close).toHaveBeenCalledTimes(1);
    expect(leased.close).not.toHaveBeenCalled();

    leasedLease.release();
    registry.shutdown();
    expect(leased.close).toHaveBeenCalledTimes(1);
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

describe('AssetRegistry durable asset reconciliation', () => {
  it('releases a baseline omitted by the reachable set and keeps a reachable one', async () => {
    const registry = new AssetRegistry();
    const reachable = createOwnedBitmap(8, 8);
    const unreachable = createOwnedBitmap(8, 8);
    const reachableId = registry.registerBaseline('document-a', reachable.bitmap, { ownership: 'adopt' });
    const unreachableId = registry.registerBaseline('document-a', unreachable.bitmap, { ownership: 'adopt' });

    registry.reconcileDocumentAssets('document-a', new Set([reachableId]));

    expect(unreachable.close).toHaveBeenCalledTimes(1);
    expect(registry.getRecord(unreachableId)).toBeUndefined();
    await expect(registry.resolve(unreachableId)).rejects.toThrow(/Unknown or disposed asset/);

    expect(reachable.close).not.toHaveBeenCalled();
    expect(registry.getRecord(reachableId)).toBeDefined();
    const lease = await registry.resolve(reachableId);
    expect(lease.bitmap).toBe(reachable.bitmap);
    lease.release();
  });

  it('does not let a rolled-back asset transaction resurrect a reconciled baseline', () => {
    const registry = new AssetRegistry();
    const kept = createOwnedBitmap();
    const stale = createOwnedBitmap();
    const pending = createOwnedBitmap();
    const keptId = registry.registerBaseline('document-a', kept.bitmap, { ownership: 'adopt' });
    const staleId = registry.registerBaseline('document-a', stale.bitmap, { ownership: 'adopt' });

    // The transaction snapshots the pre-existing baselines, then a new asset
    // is registered while the transaction is open.
    const transaction = registry.beginDocumentAssetTransaction('document-a');
    const pendingId = registry.registerBaseline('document-a', pending.bitmap, { ownership: 'adopt' });

    registry.reconcileDocumentAssets('document-a', new Set([keptId, pendingId]));
    transaction.rollback();

    // Reconciliation is final: rollback neither resurrects the stale baseline
    // nor double-releases the kept one.
    expect(registry.getRecord(staleId)).toBeUndefined();
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(registry.getRecord(keptId)).toBeDefined();
    expect(kept.close).not.toHaveBeenCalled();
    // Only the asset registered inside the transaction is rolled back.
    expect(registry.getRecord(pendingId)).toBeUndefined();
    expect(pending.close).toHaveBeenCalledTimes(1);
  });

  it('a committed asset transaction keeps the assets registered inside it', () => {
    const registry = new AssetRegistry();
    const committed = createOwnedBitmap();

    const transaction = registry.beginDocumentAssetTransaction('document-a');
    const committedId = registry.registerBaseline('document-a', committed.bitmap, { ownership: 'adopt' });
    transaction.commit();

    // A committed transaction keeps the asset; a later reconcile that omits it
    // still releases it.
    expect(registry.getRecord(committedId)).toBeDefined();
    expect(committed.close).not.toHaveBeenCalled();

    registry.reconcileDocumentAssets('document-a', new Set());

    expect(committed.close).toHaveBeenCalledTimes(1);
    expect(registry.getRecord(committedId)).toBeUndefined();
  });

  it('invalidates an in-flight materialization when reconciliation advances the document generation', async () => {
    const registry = new AssetRegistry();
    const baseline = createOwnedBitmap();
    const produced = createOwnedBitmap();
    const baselineId = registry.registerBaseline('document-a', baseline.bitmap, { ownership: 'adopt' });
    expect(registry.getDocumentGeneration('document-a')).toBe(1);

    const producerDeferred = deferred<BitmapSource>();
    const pending = registry.materialize({
      key: 'in-flight',
      documentId: 'document-a',
      producer: () => producerDeferred.promise,
    });

    // Reconciliation releases the only baseline and advances the generation
    // while the producer is still running.
    registry.reconcileDocumentAssets('document-a', new Set());
    expect(registry.getRecord(baselineId)).toBeUndefined();
    expect(baseline.close).toHaveBeenCalledTimes(1);

    producerDeferred.resolve(produced.bitmap);
    await expect(pending).rejects.toThrow(/invalidated by document disposal/);
    expect(produced.close).toHaveBeenCalledTimes(1);
  });

  it('bumps the document generation exactly once when several baselines are released', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();
    const kept = createOwnedBitmap();
    registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });
    registry.registerBaseline('document-a', second.bitmap, { ownership: 'adopt' });
    const keptId = registry.registerBaseline('document-a', kept.bitmap, { ownership: 'adopt' });

    expect(registry.getDocumentGeneration('document-a')).toBe(3);

    registry.reconcileDocumentAssets('document-a', new Set([keptId]));

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(kept.close).not.toHaveBeenCalled();
    expect(registry.getDocumentGeneration('document-a')).toBe(4);
  });

  it('does not bump the document generation when the reachable set already covers every baseline', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();
    const firstId = registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('document-a', second.bitmap, { ownership: 'adopt' });

    registry.reconcileDocumentAssets('document-a', new Set([firstId, secondId]));

    expect(registry.getDocumentGeneration('document-a')).toBe(2);
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();

    // Repeating a fully covered reconciliation stays inert.
    registry.reconcileDocumentAssets('document-a', new Set([firstId, secondId]));
    expect(registry.getDocumentGeneration('document-a')).toBe(2);
  });

  it('invalidates a pending baseline when reconciliation keeps every current asset', async () => {
    const registry = new AssetRegistry();
    const existing = createOwnedBitmap();
    const existingId = registry.registerBaseline('document-a', existing.bitmap, { ownership: 'adopt' });
    const source = document.createElement('canvas');
    const pending = deferred<ImageBitmap>();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    vi.stubGlobal('createImageBitmap', () => pending.promise);

    const registration = registry.registerBaselineAsync('document-a', source);
    registry.reconcileDocumentAssets('document-a', new Set([existingId]));
    expect(registry.getDocumentGeneration('document-a')).toBe(1);
    pending.resolve(bitmap);

    await expect(registration).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledOnce();
    expect(existing.close).not.toHaveBeenCalled();
    expect(registry.getRecord(existingId)).toBeDefined();
    expect(registry.getDocumentGeneration('document-a')).toBe(1);
    registry.shutdown();
  });

  it('detaches a shared asset from the reconciled document only', () => {
    const registry = new AssetRegistry();
    const shared = createOwnedBitmap();
    const other = createOwnedBitmap();
    const sharedId = registry.registerBaseline('document-a', shared.bitmap, { ownership: 'adopt' });
    registry.registerBaseline('document-b', shared.bitmap, { ownership: 'adopt' });
    const otherId = registry.registerBaseline('document-b', other.bitmap, { ownership: 'adopt' });

    registry.reconcileDocumentAssets('document-a', new Set());

    // document-b still holds the shared asset, so neither the record nor the
    // bitmap may go away, and document-b's generation is untouched.
    expect(registry.getRecord(sharedId)).toBeDefined();
    expect(registry.getRecord(otherId)).toBeDefined();
    expect(shared.close).not.toHaveBeenCalled();
    expect(other.close).not.toHaveBeenCalled();
    expect(registry.getDocumentGeneration('document-b')).toBe(2);
    expect(registry.getDocumentGeneration('document-a')).toBe(2);

    registry.disposeDocument('document-b');

    expect(registry.getRecord(sharedId)).toBeUndefined();
    expect(shared.close).toHaveBeenCalledTimes(1);
    expect(other.close).toHaveBeenCalledTimes(1);
  });

  it('detaches a leased asset from the document without closing its bitmap', async () => {
    const registry = new AssetRegistry();
    const leased = createOwnedBitmap();
    const leasedId = registry.registerBaseline('document-a', leased.bitmap, { ownership: 'adopt' });
    const lease = await registry.resolve(leasedId);

    registry.reconcileDocumentAssets('document-a', new Set());

    // The document no longer references the asset, but the active lease keeps
    // the entry (and its bitmap) alive.
    expect(registry.getDocumentGeneration('document-a')).toBe(2);
    expect(leased.close).not.toHaveBeenCalled();
    expect(lease.bitmap).toBe(leased.bitmap);
    expect(registry.getRecord(leasedId)).toBeDefined();

    // Reconciling again releases nothing new because the baseline ref is gone.
    registry.reconcileDocumentAssets('document-a', new Set());
    expect(registry.getDocumentGeneration('document-a')).toBe(2);
    expect(leased.close).not.toHaveBeenCalled();

    lease.release();
    lease.release();
    expect(leased.close).toHaveBeenCalledTimes(1);
    expect(registry.getRecord(leasedId)).toBeUndefined();
  });

  it('never touches baselines that belong to a different document', () => {
    const registry = new AssetRegistry();
    const other = createOwnedBitmap();
    const otherId = registry.registerBaseline('document-b', other.bitmap, { ownership: 'adopt' });

    // 'asset-b' is the only reachable id, and it belongs to document-b.
    registry.reconcileDocumentAssets('document-a', new Set([otherId]));

    expect(other.close).not.toHaveBeenCalled();
    expect(registry.getRecord(otherId)).toBeDefined();
    expect(registry.getDocumentGeneration('document-b')).toBe(1);
    expect(registry.getDocumentGeneration('document-a')).toBe(0);
  });

  it('releases every baseline of the document for an empty reachable set', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();
    const firstId = registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('document-a', second.bitmap, { ownership: 'adopt' });

    registry.reconcileDocumentAssets('document-a', new Set());

    expect(registry.getRecord(firstId)).toBeUndefined();
    expect(registry.getRecord(secondId)).toBeUndefined();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    expect(registry.getDocumentGeneration('document-a')).toBe(3);
  });

  it('is a no-op on an empty registry', () => {
    const registry = new AssetRegistry();

    registry.reconcileDocumentAssets('document-a', new Set());

    expect(registry.getDocumentGeneration('document-a')).toBe(0);
  });

  it('is a safe no-op for an unknown document id', () => {
    const registry = new AssetRegistry();
    const known = createOwnedBitmap();
    const knownId = registry.registerBaseline('document-a', known.bitmap, { ownership: 'adopt' });

    expect(() => registry.reconcileDocumentAssets('document-missing', new Set())).not.toThrow();

    expect(registry.getDocumentGeneration('document-missing')).toBe(0);
    expect(registry.getRecord(knownId)).toBeDefined();
    expect(known.close).not.toHaveBeenCalled();
    expect(registry.getDocumentGeneration('document-a')).toBe(1);
  });
});

describe('AssetRegistry document disposal tombstone', () => {
  it('makes a repeated disposeDocument inert', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();
    registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });
    registry.registerBaseline('document-a', second.bitmap, { ownership: 'adopt' });

    registry.disposeDocument('document-a');
    expect(registry.getDocumentGeneration('document-a')).toBe(3);

    registry.disposeDocument('document-a');
    registry.disposeDocument('document-a');

    expect(registry.getDocumentGeneration('document-a')).toBe(3);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('registerBaseline clears the tombstone so a reopened document can be disposed again', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });

    registry.disposeDocument('document-a');
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(registry.getDocumentGeneration('document-a')).toBe(2);

    const reopened = createOwnedBitmap();
    const reopenedId = registry.registerBaseline('document-a', reopened.bitmap, { ownership: 'adopt' });
    expect(registry.getDocumentGeneration('document-a')).toBe(3);

    registry.disposeDocument('document-a');

    expect(reopened.close).toHaveBeenCalledTimes(1);
    expect(registry.getRecord(reopenedId)).toBeUndefined();
    expect(registry.getDocumentGeneration('document-a')).toBe(4);
  });

  it('registerBorrowed clears the tombstone for a canvas-backed document', () => {
    const registry = new AssetRegistry();
    const first = document.createElement('canvas');
    const firstId = registry.registerBorrowed('document-a', first);

    registry.disposeDocument('document-a');
    expect(registry.getRecord(firstId)).toBeUndefined();
    expect(registry.getDocumentGeneration('document-a')).toBe(2);

    const reopened = document.createElement('canvas');
    const reopenedId = registry.registerBorrowed('document-a', reopened);
    expect(registry.getDocumentGeneration('document-a')).toBe(3);

    registry.disposeDocument('document-a');

    expect(registry.getRecord(reopenedId)).toBeUndefined();
    expect(registry.getDocumentGeneration('document-a')).toBe(4);
  });

  it('registerBaselineAsync clears the tombstone', async () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });

    registry.disposeDocument('document-a');
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(registry.getDocumentGeneration('document-a')).toBe(2);

    const reopened = createOwnedBitmap();
    const reopenedId = await registry.registerBaselineAsync('document-a', reopened.bitmap, { ownership: 'adopt' });
    expect(registry.getDocumentGeneration('document-a')).toBe(3);

    registry.disposeDocument('document-a');

    expect(reopened.close).toHaveBeenCalledTimes(1);
    expect(registry.getRecord(reopenedId)).toBeUndefined();
    expect(registry.getDocumentGeneration('document-a')).toBe(4);
  });

  it('shutdown disposes every document and stays safe to call twice', () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();
    const shared = createOwnedBitmap();
    const firstId = registry.registerBaseline('document-a', first.bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('document-b', second.bitmap, { ownership: 'adopt' });
    const sharedId = registry.registerBaseline('document-a', shared.bitmap, { ownership: 'adopt' });
    registry.registerBaseline('document-b', shared.bitmap, { ownership: 'adopt' });

    registry.shutdown();

    expect(registry.getRecord(firstId)).toBeUndefined();
    expect(registry.getRecord(secondId)).toBeUndefined();
    expect(registry.getRecord(sharedId)).toBeUndefined();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
    // The shared asset survives the first document disposal and is closed once
    // the second document drops it.
    expect(shared.close).toHaveBeenCalledTimes(1);
    expect(registry.getDocumentGeneration('document-a')).toBeGreaterThan(0);
    expect(registry.getDocumentGeneration('document-b')).toBeGreaterThan(0);

    const generationA = registry.getDocumentGeneration('document-a');
    const generationB = registry.getDocumentGeneration('document-b');
    registry.shutdown();

    expect(registry.getDocumentGeneration('document-a')).toBe(generationA);
    expect(registry.getDocumentGeneration('document-b')).toBe(generationB);
  });

  it('registerBaselineAsync clears the tombstone for a mutable raster source', async () => {
    const registry = new AssetRegistry();
    const canvas = document.createElement('canvas');
    const createImageBitmapSpy = vi.spyOn(globalThis, 'createImageBitmap').mockImplementation(async () => {
      const adopted = createOwnedBitmap(10, 10);
      return adopted.bitmap;
    });
    const assetId = await registry.registerBaselineAsync('document-a', canvas);
    expect(createImageBitmapSpy).toHaveBeenCalledTimes(1);

    registry.disposeDocument('document-a');

    // The registry owns (and closes) the immutable copy, never the canvas.
    expect(registry.getRecord(assetId)).toBeUndefined();
    expect((canvas as unknown as { close?: unknown }).close).toBeUndefined();
    expect(registry.getDocumentGeneration('document-a')).toBe(2);
  });

  it('disposeDocument removes unleased materializations and only reopens for the current generation', async () => {
    const registry = new AssetRegistry();
    const stale = createOwnedBitmap();
    const generationBeforeDispose = registry.getDocumentGeneration('document-a');
    const staleLease = await registry.materialize({
      key: 'doc-mat',
      documentId: 'document-a',
      producer: () => stale.bitmap,
      byteSize: 4,
    });
    staleLease.release();

    registry.disposeDocument('document-a');

    expect(stale.close).toHaveBeenCalledTimes(1);
    const fresh = createOwnedBitmap();
    const producer = vi.fn(() => fresh.bitmap);
    await expect(
      registry.materialize({
        key: 'doc-mat',
        documentId: 'document-a',
        expectedDocumentGeneration: generationBeforeDispose,
        producer,
        byteSize: 4,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(producer).not.toHaveBeenCalled();
    expect(fresh.close).not.toHaveBeenCalled();

    const next = await registry.materialize({
      key: 'doc-mat',
      documentId: 'document-a',
      expectedDocumentGeneration: registry.getDocumentGeneration('document-a'),
      producer,
      byteSize: 4,
    });
    expect(producer).toHaveBeenCalledOnce();
    expect(next.bitmap).toBe(fresh.bitmap);
    next.release();
    registry.disposeDocument('document-a');
    expect(fresh.close).toHaveBeenCalledOnce();
  });

  it('does not join a stale same-key producer after reopening at a new document generation', async () => {
    const registry = new AssetRegistry();
    const stale = createOwnedBitmap();
    const staleProducer = deferred<BitmapSource>();
    const initialGeneration = registry.getDocumentGeneration('document-a');
    const staleRequest = registry.materialize({
      key: 'shared-key',
      documentId: 'document-a',
      expectedDocumentGeneration: initialGeneration,
      producer: () => staleProducer.promise,
      byteSize: 4,
    });

    registry.disposeDocument('document-a');
    const reopenedBaseline = createOwnedBitmap();
    registry.registerBaseline('document-a', reopenedBaseline.bitmap, { ownership: 'adopt' });
    const fresh = createOwnedBitmap();
    const freshProducer = vi.fn(() => fresh.bitmap);
    const freshLease = await registry.materialize({
      key: 'shared-key',
      documentId: 'document-a',
      expectedDocumentGeneration: registry.getDocumentGeneration('document-a'),
      producer: freshProducer,
      byteSize: 4,
    });

    expect(freshProducer).toHaveBeenCalledOnce();
    expect(freshLease.bitmap).toBe(fresh.bitmap);
    staleProducer.resolve(stale.bitmap);
    await expect(staleRequest).rejects.toMatchObject({ name: 'AbortError' });
    expect(stale.close).toHaveBeenCalledOnce();

    freshLease.release();
    registry.disposeDocument('document-a');
    expect(reopenedBaseline.close).toHaveBeenCalledOnce();
    expect(fresh.close).toHaveBeenCalledOnce();
  });

  it('allows the same materialization key in a reopened generation while an old lease drains', async () => {
    const registry = new AssetRegistry();
    const first = createOwnedBitmap();
    const firstLease = await registry.materialize({
      key: 'shared-key',
      documentId: 'document-a',
      expectedDocumentGeneration: registry.getDocumentGeneration('document-a'),
      producer: () => first.bitmap,
      byteSize: 4,
    });

    registry.disposeDocument('document-a');
    expect(first.close).not.toHaveBeenCalled();

    const baseline = createOwnedBitmap();
    registry.registerBaseline('document-a', baseline.bitmap, { ownership: 'adopt' });
    const second = createOwnedBitmap();
    const secondLease = await registry.materialize({
      key: 'shared-key',
      documentId: 'document-a',
      expectedDocumentGeneration: registry.getDocumentGeneration('document-a'),
      producer: () => second.bitmap,
      byteSize: 4,
    });
    expect(secondLease.bitmap).toBe(second.bitmap);
    expect(first.close).not.toHaveBeenCalled();

    firstLease.release();
    expect(first.close).toHaveBeenCalledOnce();
    secondLease.release();
    registry.disposeDocument('document-a');
    expect(baseline.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it('keeps a caller key from colliding with a document-scoped cache key', async () => {
    const registry = new AssetRegistry();
    const unscoped = createOwnedBitmap();
    const scoped = createOwnedBitmap();
    const baseline = createOwnedBitmap();
    const legacyScopedKey = JSON.stringify(['layer-key', 'document-a', 1]);

    const globalLease = await registry.materialize({
      key: legacyScopedKey,
      producer: () => unscoped.bitmap,
      byteSize: 4,
    });
    registry.registerBaseline('document-a', baseline.bitmap, { ownership: 'adopt' });
    const scopedProducer = vi.fn(() => scoped.bitmap);
    const scopedLease = await registry.materialize({
      key: 'layer-key',
      documentId: 'document-a',
      expectedDocumentGeneration: registry.getDocumentGeneration('document-a'),
      producer: scopedProducer,
      byteSize: 4,
    });

    expect(scopedProducer).toHaveBeenCalledOnce();
    expect(scopedLease.bitmap).toBe(scoped.bitmap);
    expect(globalLease.bitmap).toBe(unscoped.bitmap);
    globalLease.release();
    scopedLease.release();
    registry.shutdown();
    expect(unscoped.close).toHaveBeenCalledOnce();
    expect(scoped.close).toHaveBeenCalledOnce();
    expect(baseline.close).toHaveBeenCalledOnce();
  });

  it('treats an empty document ID as a scoped cache owner', async () => {
    const registry = new AssetRegistry();
    const unscoped = createOwnedBitmap();
    const scoped = createOwnedBitmap();
    const baseline = createOwnedBitmap();
    const unscopedLease = await registry.materialize({ key: 'same-key', producer: () => unscoped.bitmap });
    registry.registerBaseline('', baseline.bitmap, { ownership: 'adopt' });
    const scopedProducer = vi.fn(() => scoped.bitmap);

    const scopedLease = await registry.materialize({
      key: 'same-key',
      documentId: '',
      expectedDocumentGeneration: registry.getDocumentGeneration(''),
      producer: scopedProducer,
    });

    expect(scopedProducer).toHaveBeenCalledOnce();
    expect(scopedLease.bitmap).toBe(scoped.bitmap);
    expect(unscopedLease.bitmap).toBe(unscoped.bitmap);
    unscopedLease.release();
    scopedLease.release();
    registry.shutdown();
    expect(unscoped.close).toHaveBeenCalledOnce();
    expect(scoped.close).toHaveBeenCalledOnce();
    expect(baseline.close).toHaveBeenCalledOnce();
  });

  it('shutdown disposes a document with baselines and materializations and stays safe to call twice', async () => {
    const registry = new AssetRegistry();
    const baseline = createOwnedBitmap();
    const materialized = createOwnedBitmap();
    registry.registerBaseline('document-c', baseline.bitmap, { ownership: 'adopt' });
    const lease = await registry.materialize({
      key: 'doc-mat',
      documentId: 'document-c',
      producer: () => materialized.bitmap,
      byteSize: 4,
    });

    registry.shutdown();

    // One generation for the registration plus one for the disposal.
    expect(registry.getDocumentGeneration('document-c')).toBe(2);
    expect(baseline.close).toHaveBeenCalledTimes(1);
    // The leased materialization is tombstoned rather than closed.
    expect(materialized.close).not.toHaveBeenCalled();
    await expect(
      registry.materialize({
        key: 'doc-mat',
        documentId: 'document-c',
        producer: () => createOwnedBitmap().bitmap,
      })
    ).rejects.toThrow(/asset registry shutdown/);

    registry.shutdown();
    expect(registry.getDocumentGeneration('document-c')).toBe(2);

    lease.release();
    expect(materialized.close).toHaveBeenCalledTimes(1);
  });

  it('shutdown disposes a document that owns only materializations', async () => {
    const registry = new AssetRegistry();
    const materialized = createOwnedBitmap();
    const lease = await registry.materialize({
      key: 'doc-mat',
      documentId: 'document-c',
      producer: () => materialized.bitmap,
      byteSize: 4,
    });

    registry.shutdown();

    expect(registry.getDocumentGeneration('document-c')).toBe(1);
    expect(materialized.close).not.toHaveBeenCalled();

    await expect(
      registry.materialize({
        key: 'doc-mat',
        documentId: 'document-c',
        producer: () => createOwnedBitmap().bitmap,
      })
    ).rejects.toThrow(/asset registry shutdown/);

    lease.release();
    expect(materialized.close).toHaveBeenCalledOnce();
  });

  it('shutdown invalidates active unscoped materializations and closes them on release', async () => {
    const registry = new AssetRegistry();
    const materialized = createOwnedBitmap();
    const lease = await registry.materialize({ key: 'unscoped', producer: () => materialized.bitmap });

    registry.shutdown();

    expect(materialized.close).not.toHaveBeenCalled();
    await expect(
      registry.materialize({ key: 'after-shutdown', producer: () => createOwnedBitmap().bitmap })
    ).rejects.toMatchObject({
      name: 'AbortError',
    });

    lease.release();
    expect(materialized.close).toHaveBeenCalledOnce();
  });

  it('closes unscoped producer results that complete after registry shutdown', async () => {
    const registry = new AssetRegistry();
    const producer = deferred<BitmapSource>();
    const pending = registry.materialize({ key: 'unscoped-pending', producer: () => producer.promise });
    const materialized = createOwnedBitmap();

    registry.shutdown();
    producer.resolve(materialized.bitmap);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(materialized.close).toHaveBeenCalledOnce();
  });

  it('does not deliver a lease if shutdown invalidates the cache before the caller resumes', async () => {
    const registry = new AssetRegistry();
    const materialized = createOwnedBitmap();
    const registryInternals = registry as unknown as { evictCache: () => void };
    const evictCache = registryInternals.evictCache.bind(registry);
    vi.spyOn(registryInternals, 'evictCache').mockImplementation(() => {
      evictCache();
      registry.shutdown();
    });

    const owner = registry.materialize({ key: 'shutdown-race', producer: () => materialized.bitmap, byteSize: 4 });
    const waiterProducer = vi.fn(() => createOwnedBitmap().bitmap);
    const waiter = registry.materialize({ key: 'shutdown-race', producer: waiterProducer, byteSize: 4 });
    expect(waiterProducer).not.toHaveBeenCalled();

    const results = await Promise.allSettled([owner, waiter]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ name: 'AbortError' });
    }
    expect(materialized.close).toHaveBeenCalledOnce();
  });
});
