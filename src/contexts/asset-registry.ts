import { v4 as uuidv4 } from 'uuid';

import type { AssetId } from './history-model.ts';
import type { BitmapSource } from './general-types.ts';

export type AssetOwnership = 'adopt' | 'borrow';

export type AssetRecord = Readonly<{
  id: AssetId;
  documentId: string;
  generation: number;
  width: number;
  height: number;
  byteSize: number;
  sourceType: 'image-bitmap' | 'html-image' | 'html-canvas' | 'offscreen-canvas' | 'unknown';
  ownership: AssetOwnership;
  disposed: boolean;
}>;

export type AssetLease = Readonly<{
  assetId: AssetId;
  generation: number;
  bitmap: BitmapSource;
  record: AssetRecord;
  release: () => void;
}>;

export type MaterializationLease = Readonly<{
  key: string;
  bitmap: BitmapSource;
  byteSize: number;
  release: () => void;
}>;

type AssetEntry = {
  record: AssetRecord;
  bitmap: BitmapSource;
  baselineDocuments: Set<string>;
  retainCount: number;
  disposed: boolean;
};

type CacheEntry = {
  key: string;
  documentId?: string;
  bitmap: BitmapSource;
  byteSize: number;
  retainCount: number;
  lastUsed: number;
};

export type AssetRegistryOptions = Readonly<{
  maxCacheBytes?: number;
  maxCacheEntries?: number;
}>;

const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 64;

function bitmapDimension(bitmap: BitmapSource, dimension: 'width' | 'height'): number {
  const value = bitmap[dimension];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : 1;
}

function sourceType(bitmap: BitmapSource): AssetRecord['sourceType'] {
  if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) return 'image-bitmap';
  if (typeof HTMLImageElement !== 'undefined' && bitmap instanceof HTMLImageElement) return 'html-image';
  if (typeof HTMLCanvasElement !== 'undefined' && bitmap instanceof HTMLCanvasElement) return 'html-canvas';
  if (typeof OffscreenCanvas !== 'undefined' && bitmap instanceof OffscreenCanvas) return 'offscreen-canvas';
  return typeof (bitmap as { close?: unknown }).close === 'function' ? 'image-bitmap' : 'unknown';
}

function isOwnedImageBitmap(bitmap: BitmapSource): bitmap is ImageBitmap {
  return typeof (bitmap as { close?: unknown }).close === 'function';
}

function disposeOwnedBitmap(bitmap: BitmapSource) {
  if (isOwnedImageBitmap(bitmap)) bitmap.close();
}

/**
 * Runtime-only owner for external raster data and derived materializations.
 *
 * `registerBaseline` is synchronous and therefore does not copy mutable DOM
 * sources. Callers passing a canvas or HTMLImageElement must use
 * `registerBaselineAsync`, which creates an adopted ImageBitmap first. The
 * explicit `adopt`/`borrow` option makes transfer of ownership observable.
 */
export class AssetRegistry {
  private readonly assets = new Map<AssetId, AssetEntry>();
  private readonly externalIds = new WeakMap<object, AssetId>();
  private readonly documentGenerations = new Map<string, number>();
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private clock = 0;
  private readonly maxCacheBytes: number;
  private readonly maxCacheEntries: number;

  constructor(options: AssetRegistryOptions = {}) {
    this.maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  }

  private nextGeneration(documentId: string): number {
    const next = (this.documentGenerations.get(documentId) ?? 0) + 1;
    this.documentGenerations.set(documentId, next);
    return next;
  }

  getDocumentGeneration(documentId: string): number {
    return this.documentGenerations.get(documentId) ?? 0;
  }

  registerBaseline(
    documentId: string,
    bitmap: BitmapSource,
    options: Readonly<{ ownership?: AssetOwnership }> = {}
  ): AssetId {
    const ownership = options.ownership ?? (sourceType(bitmap) === 'image-bitmap' ? 'adopt' : 'borrow');
    const external = bitmap as unknown as object;
    const existingId = this.externalIds.get(external);
    if (existingId) {
      const existing = this.assets.get(existingId);
      if (existing && !existing.disposed) {
        if (!existing.baselineDocuments.has(documentId)) {
          existing.baselineDocuments.add(documentId);
          existing.retainCount += 1;
          this.nextGeneration(documentId);
        }
        return existingId;
      }
      this.externalIds.delete(external);
    }

    const id = uuidv4() as AssetId;
    const width = bitmapDimension(bitmap, 'width');
    const height = bitmapDimension(bitmap, 'height');
    const record: AssetRecord = Object.freeze({
      id,
      documentId,
      generation: this.nextGeneration(documentId),
      width,
      height,
      byteSize: width * height * 4,
      sourceType: sourceType(bitmap),
      ownership,
      disposed: false,
    });
    this.assets.set(id, {
      record,
      bitmap,
      baselineDocuments: new Set([documentId]),
      retainCount: 1,
      disposed: false,
    });
    this.externalIds.set(external, id);
    return id;
  }

  registerBorrowed(documentId: string, bitmap: BitmapSource): AssetId {
    return this.registerBaseline(documentId, bitmap, { ownership: 'borrow' });
  }

  async registerBaselineAsync(
    documentId: string,
    bitmap: BitmapSource,
    options: Readonly<{ ownership?: AssetOwnership }> = {}
  ): Promise<AssetId> {
    // ImageBitmap is already immutable with explicit close semantics. Other
    // drawable sources must be copied before entering a durable descriptor.
    if (sourceType(bitmap) === 'image-bitmap') {
      return this.registerBaseline(documentId, bitmap, options);
    }
    const create = globalThis.createImageBitmap;
    if (!create) throw new Error('createImageBitmap is required to adopt a mutable raster source');
    const immutable = await create(bitmap as never);
    return this.registerBaseline(documentId, immutable, { ownership: 'adopt' });
  }

  getRecord(assetId: AssetId): AssetRecord | undefined {
    const entry = this.assets.get(assetId);
    return entry && !entry.disposed ? entry.record : undefined;
  }

  retain(assetId: AssetId): void {
    const entry = this.assets.get(assetId);
    if (!entry || entry.disposed) throw new Error(`Unknown or disposed asset: ${assetId}`);
    entry.retainCount += 1;
  }

  release(assetId: AssetId): void {
    const entry = this.assets.get(assetId);
    if (!entry || entry.disposed) return;
    entry.retainCount = Math.max(0, entry.retainCount - 1);
    if (entry.retainCount !== 0 || entry.baselineDocuments.size !== 0) return;
    entry.disposed = true;
    if (entry.record.ownership === 'adopt') disposeOwnedBitmap(entry.bitmap);
    this.assets.delete(assetId);
  }

  async resolve(assetId: AssetId, signal?: AbortSignal): Promise<AssetLease> {
    const entry = this.assets.get(assetId);
    if (!entry || entry.disposed) throw new Error(`Unknown or disposed asset: ${assetId}`);
    if (signal?.aborted) throw new DOMException('Asset resolution aborted', 'AbortError');
    this.retain(assetId);
    let released = false;
    let abortHandler: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      this.release(assetId);
    };
    if (signal) {
      abortHandler = () => release();
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    return {
      assetId,
      generation: entry.record.generation,
      bitmap: entry.bitmap,
      record: entry.record,
      release,
    };
  }

  async materialize(
    input: Readonly<{
      key: string;
      documentId?: string;
      producer: () => Promise<BitmapSource> | BitmapSource;
      byteSize?: number;
    }>
  ): Promise<MaterializationLease> {
    const cached = this.cache.get(input.key);
    if (cached) {
      cached.retainCount += 1;
      cached.lastUsed = ++this.clock;
      return this.cacheLease(cached);
    }

    const bitmap = await input.producer();
    const entry: CacheEntry = {
      key: input.key,
      documentId: input.documentId,
      bitmap,
      byteSize: input.byteSize ?? bitmapDimension(bitmap, 'width') * bitmapDimension(bitmap, 'height') * 4,
      retainCount: 1,
      lastUsed: ++this.clock,
    };
    this.cache.set(entry.key, entry);
    this.cacheBytes += entry.byteSize;
    this.evictCache();
    return this.cacheLease(entry);
  }

  disposeDocument(documentId: string): void {
    for (const entry of this.assets.values()) {
      if (!entry.baselineDocuments.delete(documentId)) continue;
      this.release(entry.record.id);
    }
    for (const [key, entry] of this.cache) {
      if (entry.documentId !== documentId || entry.retainCount !== 0) continue;
      this.removeCacheEntry(key, entry);
    }
    this.nextGeneration(documentId);
  }

  /** Releases every document baseline while respecting active leases. */
  shutdown(): void {
    for (const documentId of this.documentGenerations.keys()) this.disposeDocument(documentId);
    this.clearMaterializations();
  }

  clearMaterializations(): void {
    for (const [key, entry] of this.cache) {
      if (entry.retainCount === 0) this.removeCacheEntry(key, entry);
    }
  }

  private cacheLease(entry: CacheEntry): MaterializationLease {
    let released = false;
    return {
      key: entry.key,
      bitmap: entry.bitmap,
      byteSize: entry.byteSize,
      release: () => {
        if (released) return;
        released = true;
        entry.retainCount = Math.max(0, entry.retainCount - 1);
        entry.lastUsed = ++this.clock;
        this.evictCache();
      },
    };
  }

  private removeCacheEntry(key: string, entry: CacheEntry) {
    this.cache.delete(key);
    this.cacheBytes -= entry.byteSize;
    disposeOwnedBitmap(entry.bitmap);
  }

  private evictCache() {
    while (this.cache.size > this.maxCacheEntries || this.cacheBytes > this.maxCacheBytes) {
      const candidate = [...this.cache.values()]
        .filter((entry) => entry.retainCount === 0)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) break;
      this.removeCacheEntry(candidate.key, candidate);
    }
  }
}

let defaultRegistry: AssetRegistry | undefined;

export function getAssetRegistry(): AssetRegistry {
  defaultRegistry ??= new AssetRegistry();
  return defaultRegistry;
}
